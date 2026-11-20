import { Injectable } from '@nestjs/common';
import { Browser, BrowserContext, Page, Response } from 'playwright';
import {
  buildHostProfileUrl,
  buildRoomUrl,
  buildSearchUrl,
  calculateNights,
  parseProxyUrl,
  randomDelay,
  sleep,
} from '../../common/helpers';
import {
  CrawlJobInput,
  CrawlJobResult,
  HostListingRecord,
  RoomRecord,
  SearchCombination,
} from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
import { AIRBNB_BASE_URL, SHORT_VERSION } from '../../config/constants';
import { DatabaseService } from '../database/database.service';
import { ExporterService } from '../exporter/exporter.service';
import { HostParserService } from '../parser/host-parser.service';
import { PdpParserService } from '../parser/pdp-parser.service';
import { BrowserService } from './browser.service';
import { buildSearchCombinations } from './query-matrix';

export type PauseMode = 'running' | 'paused' | 'paused_503';

export interface PauseStatePayload {
  status: PauseMode;
  countdownSeconds: number;
  reason?: string;
}

export interface ManualInterventionHandlers {
  pause: () => void;
  resume: () => void;
  updateProxy: (proxyUrl?: string) => Promise<void>;
  resetSession: () => Promise<void>;
  skipCurrent: () => void;
}

export interface JobControl {
  signal: AbortSignal;
  onLog: (message: string, level?: 'info' | 'success' | 'warn' | 'error' | 'step') => void;
  onProgress: (percent: number, label: string) => void;
  onPauseStateChange?: (state: PauseStatePayload) => void;
  onHandlersReady?: (handlers: ManualInterventionHandlers) => void;
}

class Blocked503Error extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = 'Blocked503Error';
  }
}

class SkipCurrentItemError extends Error {
  constructor() {
    super('SKIP_CURRENT_ITEM');
    this.name = 'SkipCurrentItemError';
  }
}

class ContextRecreatedError extends Error {
  constructor() {
    super('CONTEXT_RECREATED');
    this.name = 'ContextRecreatedError';
  }
}

@Injectable()
export class ScraperService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly db: DatabaseService,
    private readonly pdpParser: PdpParserService,
    private readonly hostParser: HostParserService,
    private readonly browserService: BrowserService,
    private readonly exporter: ExporterService,
  ) {}

  private isStopRequested(signal?: AbortSignal): boolean {
    return Boolean(signal?.aborted);
  }

  private isTargetClosedError(err: any): boolean {
    const msg = String(err?.message || err || '').toLowerCase();
    const name = String(err?.name || '').toLowerCase();
    return (
      name.includes('targetclosederror') ||
      msg.includes('target page, context or browser has been closed') ||
      msg.includes('browser has been closed') ||
      msg.includes('target closed')
    );
  }

  private isWatchdogError(err: any): boolean {
    return String(err?.message || '').startsWith('WATCHDOG_TIMEOUT:');
  }

  private async runWithWatchdog<T>(
    promiseFactory: () => Promise<T>,
    timeoutMs = 45000,
    timeoutLabel = 'Tab',
    isPausedFn?: () => boolean,
  ): Promise<T> {
    let activeElapsedMs = 0;
    let lastTick = Date.now();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promiseFactory(),
        new Promise<never>((_, reject) => {
          timer = setInterval(() => {
            const now = Date.now();
            const delta = now - lastTick;
            lastTick = now;
            if (!isPausedFn?.()) {
              activeElapsedMs += delta;
            }
            if (activeElapsedMs >= timeoutMs) {
              clearInterval(timer);
              reject(
                new Error(`WATCHDOG_TIMEOUT: ${timeoutLabel} vượt quá ${Math.round(timeoutMs / 1000)}s`),
              );
            }
          }, 500);
        }),
      ]);
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  /**
   * Điều hướng với waitUntil: 'commit' (timeout 60s) và tự động thử lại tối đa 2 lần
   * nếu mạng chậm — trả về Response chính để kiểm tra 503/429.
   */
  private async gotoWithRetry(
    page: Page,
    url: string,
    tabLabel: string,
    control: JobControl,
    maxRetries = 2,
  ): Promise<{ ok: boolean; response: Response | null }> {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (this.isStopRequested(control.signal)) return { ok: false, response: null };
      try {
        let resp: Response | null = null;
        if (attempt === 0) {
          resp = await page.goto(url, { timeout: 60000, waitUntil: 'commit' });
        } else {
          control.onLog(`[${tabLabel}] Mạng chậm (Timeout), đang tải lại lần ${attempt}/${maxRetries}...`, 'warn');
          resp = await page
            .reload({ timeout: 45000, waitUntil: 'commit' })
            .catch(async () => page.goto(url, { timeout: 60000, waitUntil: 'commit' }));
        }
        return { ok: true, response: resp };
      } catch (err: any) {
        if (this.isStopRequested(control.signal)) return { ok: false, response: null };
        if (attempt >= maxRetries) {
          control.onLog(
            `[${tabLabel}] Bỏ qua URL do lỗi mạng sau ${maxRetries} lần thử: ${err?.message || err}`,
            'warn',
          );
          return { ok: false, response: null };
        }
        await sleep(3000);
      }
    }
    return { ok: false, response: null };
  }

  /**
   * Mô phỏng thao tác cuộn chuột người dùng thật (smooth scroll 4-6 nhịp).
   */
  private async humanSmoothScroll(page: Page, signal?: AbortSignal) {
    const steps = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < steps; i++) {
      if (this.isStopRequested(signal)) return;
      const deltaY = 450 + Math.floor(Math.random() * 250);
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), deltaY).catch(() => {});

      if (Math.random() > 0.45) {
        const mx = 220 + Math.floor(Math.random() * 880);
        const my = 180 + Math.floor(Math.random() * 450);
        await page.mouse.move(mx, my, { steps: 5 }).catch(() => {});
      }
      await randomDelay(350, 750);
    }
  }

  private async dismissPopups(page: Page) {
    const selectors = [
      'button[aria-label="Đóng"]',
      'button[aria-label="Close"]',
      'button:has-text("Chấp nhận tất cả")',
      'button:has-text("Accept all")',
    ];
    for (const sel of selectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 150 }).catch(() => false)) {
          await btn.click({ timeout: 400 }).catch(() => {});
        }
      } catch {
        // Ignore
      }
    }
  }

  private async extractDeferredJson(page: Page): Promise<any | null> {
    try {
      const loc = page.locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]').first();
      if ((await loc.count()) > 0) {
        const raw = await loc.innerText();
        if (raw) return JSON.parse(raw);
      }
    } catch {
      // Ignore
    }
    return null;
  }

  /**
   * Nhận diện chính xác trang chặn 503 ("Stay tuned / Airbnb is temporarily unavailable"),
   * 429 Too Many Requests, Pardon Our Interruption và khung xác minh Captcha/Robot.
   */
  async isBlockedOr503(
    page: Page,
    response?: Response | null,
  ): Promise<{ blocked: boolean; status: number; reason: string }> {
    const status = response?.status() ?? 0;
    if (status === 503) {
      return { blocked: true, status: 503, reason: 'HTTP 503 Service Unavailable' };
    }
    if (status === 429) {
      return { blocked: true, status: 429, reason: 'HTTP 429 Too Many Requests' };
    }

    try {
      const [titleText, bodyText, captchaFrameCount] = await Promise.all([
        page.title().catch(() => ''),
        page.locator('body').innerText({ timeout: 1200 }).catch(() => ''),
        page
          .locator('iframe[src*="arkose"], iframe[src*="captcha"], iframe[title*="challenge"], iframe[src*="recaptcha"]')
          .count()
          .catch(() => 0),
      ]);

      const combined = `${titleText}\n${bodyText}`.toLowerCase();

      if (
        combined.includes('error code: 503') ||
        combined.includes('airbnb is temporarily unavailable') ||
        combined.includes('pardon our interruption') ||
        (combined.includes('stay tuned') && (combined.includes('airbnb') || combined.includes('unavailable')))
      ) {
        return {
          blocked: true,
          status: 503,
          reason: 'Trang giả lập bảo trì 503 (Stay tuned / Temporarily unavailable)',
        };
      }

      if (combined.includes('429 too many requests')) {
        return { blocked: true, status: 429, reason: '429 Too Many Requests' };
      }

      if (
        captchaFrameCount > 0 ||
        combined.includes('verify you are human') ||
        combined.includes('arkose') ||
        combined.includes('please complete the security check') ||
        combined.includes('are you a robot')
      ) {
        return { blocked: true, status: 429, reason: 'Phát hiện khung xác minh Captcha / Robot' };
      }
    } catch {
      // Ignore transient DOM evaluation error during navigation
    }

    return { blocked: false, status, reason: '' };
  }

  private async scrapeRoomDetail(params: {
    page: Page;
    roomId: string;
    url: string;
    locationQuery: string;
    checkIn: string;
    checkOut: string;
    nights: number;
    tabLabel: string;
    control: JobControl;
  }): Promise<RoomRecord | null> {
    const { page, roomId, url, locationQuery, checkIn, checkOut, nights, tabLabel, control } = params;
    let bookItData: any = null;
    const pdpAmenities: string[] = [];
    let apiBlockError: Blocked503Error | null = null;

    const onResponse = (resp: Response) => {
      try {
        const respUrl = resp.url();
        const st = resp.status();
        if (st === 503 || st === 429) {
          if (!apiBlockError) {
            apiBlockError = new Blocked503Error(st, `HTTP ${st} từ API PDP`);
          }
          return;
        }
        if (st !== 200) return;

        if (respUrl.includes('StaysPdpBookItQuery')) {
          void resp
            .json()
            .then((j) => {
              bookItData = j;
            })
            .catch(() => null);
        } else if (respUrl.includes('StaysPdpSections') || respUrl.includes('AMENITIES_DEFAULT')) {
          void resp
            .json()
            .then((json) => {
              if (json) {
                const rawStr = JSON.stringify(json);
                const matches = rawStr.match(/"title"\s*:\s*"([^"]{2,60})"/g);
                if (matches) {
                  for (const m of matches.slice(0, 60)) {
                    const val = m.replace(/^"title"\s*:\s*"/, '').replace(/"$/, '');
                    if (val && !val.includes('__typename')) pdpAmenities.push(val);
                  }
                }
              }
            })
            .catch(() => null);
        }
      } catch {
        // Ignore
      }
    };

    page.on('response', onResponse);
    try {
      const { ok, response } = await this.gotoWithRetry(page, url, tabLabel, control, 2);
      if (!ok) return null;

      if (apiBlockError) throw apiBlockError;
      const blockCheck = await this.isBlockedOr503(page, response);
      if (blockCheck.blocked) {
        throw new Blocked503Error(blockCheck.status, blockCheck.reason);
      }

      try {
        await page.waitForSelector('h1', { timeout: 15000 });
      } catch {
        // Ignore
      }

      if (apiBlockError) throw apiBlockError;
      const postWaitCheck = await this.isBlockedOr503(page);
      if (postWaitCheck.blocked) {
        throw new Blocked503Error(postWaitCheck.status, postWaitCheck.reason);
      }

      await page.evaluate(() => window.scrollBy({ top: 800, behavior: 'smooth' })).catch(() => {});
      for (let i = 0; i < 6; i++) {
        if (bookItData || apiBlockError) break;
        await sleep(400);
      }
      if (apiBlockError) throw apiBlockError;

      const record = await this.pdpParser.extractFromPage({
        page,
        listingId: roomId,
        url,
        locationQuery,
        checkIn,
        checkOut,
        nights,
        bookItData,
      });

      if (record && record.amenities.length === 0 && pdpAmenities.length > 0) {
        record.amenities = Array.from(new Set(pdpAmenities));
        const detected = this.pdpParser.detectBuildingAndHighRise({
          title: record.title,
          subtitle: record.subtitle,
          description: record.description,
          amenities: record.amenities,
        });
        record.building_name = record.building_name || detected.buildingName;
        record.is_high_rise = Math.max(record.is_high_rise || 0, detected.isHighRise);
      }
      return record;
    } finally {
      page.off('response', onResponse);
    }
  }

  /**
   * Toàn bộ quy trình Multi-Tab Human-Like + Stop & Export Anytime:
   * - Bước 1: Multi-Tab quét theo phân khúc giá (Price-Range Slicing + Dynamic Split)
   * - Bước 2: Multi-Tab đọc PDP & AMENITIES_DEFAULT (Smart Incremental Crawl)
   * - Bước 3: Multi-Tab mở rộng danh mục Host (IN_TARGET / OUT_OF_TARGET)
   * - Bước 4: Đồng bộ cụm tòa nhà & Tự động xuất 2 file Excel (City Summary + Master_City_Comparison.xlsx)
   */
  async runCleanPipeline(
    input: CrawlJobInput,
    control: JobControl,
    onBrowserReady?: (browser: Browser | null) => void,
  ): Promise<CrawlJobResult> {
    const {
      cityName,
      checkIn,
      checkOut,
      maxPages = 15,
      tabsCount = 2,
      humanLikeMode = true,
      enablePriceSlicing = true,
      priceBucketsText,
      entireHomeOnly = true,
      includeHostRooms = true,
      proxyUrl,
      useWarpProxy = false,
    } = input;

    const nights = calculateNights(checkIn, checkOut);
    const warpProxy = useWarpProxy ? { server: 'socks5://127.0.0.1:40000' } : undefined;
    const proxyConfig = parseProxyUrl(proxyUrl) || warpProxy || this.appConfig.proxy;
    const safeTabs = Math.max(1, Math.min(6, tabsCount));

    let currentStep = 1;
    let stoppedEarly = false;

    control.onLog(
      `Khởi chạy ${SHORT_VERSION} (${humanLikeMode ? 'Trình duyệt thật Persistent VPN Profile' : 'Headless'}) | "${cityName}" | ${safeTabs} Tab x ${maxPages} trang | WARP 1.1.1.1: ${useWarpProxy ? 'BẬT' : 'TẮT'} | Chia khoảng giá: ${enablePriceSlicing ? 'BẬT' : 'TẮT'}`,
      'step',
    );
    control.onProgress(4, 'Đang mở trình duyệt Chrome Persistent VPN Profile...');

    const launched = await this.browserService.launchPersistentBrowserContext({
      proxyOverride: proxyConfig,
      humanLikeMode,
    });
    let browser: Browser | null = launched.browser;
    let context: BrowserContext = launched.context;
    const channelUsed = launched.channelUsed;

    onBrowserReady?.(browser);
    control.onLog(`[Browser] Đã mở trình duyệt thành công (${safeTabs} Tab) — ${channelUsed}`, 'success');

    const existingDbIds = this.db.getAllRoomIds();
    const discoveredIds = new Set<string>();
    const discoveredUrls = new Map<
      string,
      { url: string; checkIn: string; checkOut: string; nights: number }
    >();
    let totalHostRoomsSaved = 0;

    // Trạng thái Tạm dừng / Hạ nhiệt 503 / Can thiệp thủ công đồng bộ giữa các Tab
    let manualPaused = false;
    let pauseUntilMs = 0;
    let pauseReason = '';
    let consecutive503Count = 0;
    let isSwitchingContext = false;
    let contextGeneration = 0;
    let skipVersion = 0;
    let sessionResetPromise: Promise<void> | null = null;
    let needsSessionResetOnResume = false;
    let lastEmittedPauseKey = '';

    const isPausedOrSwitching = () =>
      isSwitchingContext || manualPaused || Date.now() < pauseUntilMs;

    const emitPauseState = (force = false) => {
      if (!control.onPauseStateChange) return;
      let status: PauseMode = 'running';
      let countdownSeconds = 0;
      if (manualPaused) {
        status = 'paused';
      } else if (Date.now() < pauseUntilMs) {
        status = 'paused_503';
        countdownSeconds = Math.max(1, Math.ceil((pauseUntilMs - Date.now()) / 1000));
      }
      const key = `${status}:${countdownSeconds}:${pauseReason}`;
      if (force || key !== lastEmittedPauseKey) {
        lastEmittedPauseKey = key;
        control.onPauseStateChange({
          status,
          countdownSeconds,
          reason: status === 'running' ? undefined : pauseReason || undefined,
        });
      }
    };

    const performSessionResetOnce = async () => {
      if (sessionResetPromise) return sessionResetPromise;
      sessionResetPromise = (async () => {
        try {
          await this.browserService.resetSession(context);
        } finally {
          sessionResetPromise = null;
        }
      })();
      return sessionResetPromise;
    };

    const waitIfPaused = async (myGen?: number, mySkipVersion?: number) => {
      while (!this.isStopRequested(control.signal)) {
        if (mySkipVersion !== undefined && skipVersion !== mySkipVersion) {
          throw new SkipCurrentItemError();
        }
        if (myGen !== undefined && contextGeneration !== myGen) {
          throw new ContextRecreatedError();
        }
        if (isPausedOrSwitching()) {
          emitPauseState();
          await sleep(400);
          continue;
        }
        emitPauseState();
        break;
      }
    };

    const trigger503Cooldown = async (
      tabLabel: string,
      reason: string,
      myGen?: number,
      mySkipVersion?: number,
    ) => {
      const alreadyPaused503 = Date.now() < pauseUntilMs || manualPaused;
      if (!alreadyPaused503) {
        consecutive503Count++;
        const cooldownSec = consecutive503Count >= 2 ? 60 : 35;
        pauseUntilMs = Date.now() + cooldownSec * 1000;
        pauseReason = reason;
        needsSessionResetOnResume = true;
        control.onLog(
          `[Cảnh báo 503] Dính giới hạn lưu lượng (${tabLabel}: ${reason}) — Toàn bộ Tab tạm nghỉ ${cooldownSec}s. Hãy bấm vào biểu tượng VPN Extension trên góc trình duyệt (hoặc bật/tắt 1.1.1.1 WARP) để đổi IP khác, sau đó bấm 'Tiếp tục ngay'!`,
          'warn',
        );
        emitPauseState(true);
      }

      await waitIfPaused(myGen, mySkipVersion);

      if (needsSessionResetOnResume && !this.isStopRequested(control.signal)) {
        needsSessionResetOnResume = false;
        control.onLog(
          '[Session Reset] Đang xóa Cookie (_airbed_session_id) & ghé trang chủ Airbnb lấy phiên mới...',
          'step',
        );
        await performSessionResetOnce();
        control.onLog(
          '[Session Reset] Đã làm mới phiên thành công — Tiếp tục thử lại URL...',
          'success',
        );
      }
    };

    const pauseTicker = setInterval(() => {
      if (manualPaused || Date.now() < pauseUntilMs) {
        emitPauseState();
      }
    }, 1000);

    control.onHandlersReady?.({
      pause: () => {
        manualPaused = true;
        pauseUntilMs = 0;
        pauseReason = 'Tạm dừng thủ công';
        emitPauseState(true);
        control.onLog(
          '[Can thiệp thủ công] Đã tạm dừng toàn bộ Tab — Giữ nguyên trình duyệt để bạn thao tác tay / đổi mạng / đổi Proxy.',
          'warn',
        );
      },
      resume: () => {
        manualPaused = false;
        pauseUntilMs = 0;
        pauseReason = '';
        emitPauseState(true);
        control.onLog(
          '[Can thiệp thủ công] Tiếp tục chạy ngay! Hủy đếm ngược và đánh thức toàn bộ Tab.',
          'success',
        );
      },
      resetSession: async () => {
        control.onLog(
          '[Can thiệp thủ công] Đang xóa Cookie & Storage và làm mới phiên Airbnb...',
          'step',
        );
        await performSessionResetOnce();
        needsSessionResetOnResume = false;
        control.onLog(
          '[Session Reset] Đã xóa Cookie & lấy phiên Airbnb mới thành công.',
          'success',
        );
      },
      skipCurrent: () => {
        skipVersion++;
        if (Date.now() < pauseUntilMs) {
          pauseUntilMs = 0;
          pauseReason = '';
          emitPauseState(true);
        }
        control.onLog(
          '[Can thiệp thủ công] Đã nhận lệnh Bỏ qua mục/trang đang kẹt — Các Tab sẽ chuyển sang mục tiếp theo.',
          'warn',
        );
      },
      updateProxy: async (newProxyUrl?: string) => {
        const parsed = parseProxyUrl(newProxyUrl);
        isSwitchingContext = true;
        control.onLog(
          parsed
            ? `[Đổi Proxy nóng] Đang áp dụng Proxy mới (${parsed.server}) & tái tạo BrowserContext...`
            : '[Đổi Proxy nóng] Đang chuyển về Wi-Fi trực tiếp (Direct) & tái tạo BrowserContext...',
          'step',
        );
        try {
          const recreated = await this.browserService.recreateBrowserWithProxy({
            currentContext: context,
            currentBrowser: browser,
            proxyOverride: parsed,
            humanLikeMode,
          });
          browser = recreated.browser;
          context = recreated.context;
          onBrowserReady?.(browser);
          contextGeneration++;
          consecutive503Count = 0;
          needsSessionResetOnResume = false;
          manualPaused = false;
          pauseUntilMs = 0;
          pauseReason = '';
          control.onLog(
            `[Đổi Proxy nóng] Đã khởi tạo lại trình duyệt (${recreated.channelUsed}) & tiếp tục chạy!`,
            'success',
          );
        } finally {
          isSwitchingContext = false;
          emitPauseState(true);
        }
      },
    });

    try {

      // =========================================================================
      // BƯỚC 1: Multi-Tab Quét Tổ Hợp Đa Chiều (Từ khóa × Khung ngày × Mức giá)
      // =========================================================================
      currentStep = 1;
      const matrix = buildSearchCombinations(input);
      const comboQueue: SearchCombination[] = [...matrix.combinations];
      const totalInitialCombos = comboQueue.length;
      let completedCombos = 0;

      control.onLog(
        `[QueryMatrix] Khởi tạo ${totalInitialCombos} tổ hợp quét (${matrix.keywordsCount} từ khóa × ${matrix.dateWindowsCount} khung ngày × ${matrix.priceBucketsCount} mức giá) — Đã xáo trộn ngẫu nhiên chống 503.`,
        'step',
      );
      control.onProgress(
        6,
        `Bước 1/4: Đang quét ${totalInitialCombos} tổ hợp với ${safeTabs} Tab...`,
      );

      const step1Workers = Array.from({ length: safeTabs }, async (_, tabIdx) => {
        // Staggered Tab Launch: giãn cách 1500ms - 2500ms giữa các Tab
        if (tabIdx > 0) {
          await sleep(tabIdx * (1500 + Math.floor(Math.random() * 1000)));
        }
        if (this.isStopRequested(control.signal)) return;

        const tabLabel = `Tab ${tabIdx + 1}/${safeTabs} | Bước 1`;
        let myGen = contextGeneration;
        let page = await this.browserService.newHumanPage(context);
        let apiBlockError: Blocked503Error | null = null;
        let activeCombo: SearchCombination | null = null;
        let newIdsThisPage = 0;

        const recordDiscoveredRoom = (
          rid: string,
          roomUrl: string,
          comboRef: SearchCombination,
        ) => {
          const isBrandNew = !existingDbIds.has(rid) && !discoveredIds.has(rid);
          if (!discoveredIds.has(rid)) {
            discoveredIds.add(rid);
            discoveredUrls.set(rid, {
              url: roomUrl,
              checkIn: comboRef.checkIn,
              checkOut: comboRef.checkOut,
              nights: comboRef.nights,
            });
            if (isBrandNew) {
              newIdsThisPage++;
            }
          }
        };

        const onSearchResponse = (resp: Response) => {
          try {
            const st = resp.status();
            if (st === 503 || st === 429) {
              if (!apiBlockError) {
                apiBlockError = new Blocked503Error(st, `HTTP ${st} từ API Tìm kiếm`);
              }
              return;
            }
            const rUrl = resp.url();
            if (st !== 200) return;
            if (!rUrl.includes('StaysSearch') && !rUrl.includes('ExploreLayout')) return;

            const comboSnapshot = activeCombo;
            if (!comboSnapshot) return;

            void resp
              .json()
              .then((json) => {
                if (!json) return;
                const parsed = this.pdpParser.extractSearchListingsFromJson(json, {
                  locationQuery: cityName,
                  checkIn: comboSnapshot.checkIn,
                  checkOut: comboSnapshot.checkOut,
                  nights: comboSnapshot.nights,
                });
                for (const rec of parsed) {
                  this.db.upsertRoom(rec);
                  recordDiscoveredRoom(rec.listing_id, rec.url, comboSnapshot);
                }
              })
              .catch(() => null);
          } catch {
            // Ignore
          }
        };

        page.on('response', onSearchResponse);

        const recreateStep1Page = async () => {
          page.off('response', onSearchResponse);
          await page.close().catch(() => {});
          myGen = contextGeneration;
          page = await this.browserService.newHumanPage(context);
          page.on('response', onSearchResponse);
        };

        const replaceStep1Tab = async (reason: string) => {
          control.onLog(
            `[${tabLabel}] Watchdog 45s (${reason}) — Đang đóng Tab cũ và mở Tab mới thay thế...`,
            'warn',
          );
          await recreateStep1Page();
        };

        try {
          try {
            await page.goto(AIRBNB_BASE_URL, { timeout: 30000, waitUntil: 'commit' });
            await randomDelay(1000, 1800);
            await this.dismissPopups(page);
          } catch {
            // Continue straight to search
          }

          while (comboQueue.length > 0) {
            if (this.isStopRequested(control.signal)) break;
            try {
              await waitIfPaused(myGen);
            } catch (err) {
              if (err instanceof ContextRecreatedError) {
                await recreateStep1Page();
                continue;
              }
              throw err;
            }
            if (this.isStopRequested(control.signal)) break;

            const combo = comboQueue.shift();
            if (!combo) break;

            activeCombo = combo;
            const comboTag = `[Tổ hợp ${combo.index}/${combo.total} | Từ khóa: "${combo.keyword}" | Ngày: ${combo.dateLabel} | Giá: ${combo.bucket.label}]`;
            const mySkipVersion = skipVersion;
            let comboCompleted = false;

            for (let retry503 = 0; retry503 < 3; retry503++) {
              if (this.isStopRequested(control.signal)) break;
              try {
                await waitIfPaused(myGen, mySkipVersion);

                control.onLog(
                  `[${tabLabel}] ${comboTag} — Đang mở Trang 1${retry503 > 0 ? ` (thử lại ${retry503 + 1}/3)` : ''}...`,
                  'info',
                );

                const searchUrl = buildSearchUrl({
                  cityName: combo.keyword,
                  checkIn: combo.checkIn,
                  checkOut: combo.checkOut,
                  minPrice: combo.bucket.min,
                  maxPrice: combo.bucket.max,
                  entireHomeOnly,
                  currency: 'VND',
                });

                apiBlockError = null;
                newIdsThisPage = 0;
                const navRes = await this.runWithWatchdog(
                  () => this.gotoWithRetry(page, searchUrl, tabLabel, control, 2),
                  45000,
                  `Mở ${comboTag}`,
                  isPausedOrSwitching,
                );
                if (!navRes.ok) {
                  comboCompleted = true;
                  break;
                }

                if (apiBlockError) throw apiBlockError;
                const navBlock = await this.isBlockedOr503(page, navRes.response);
                if (navBlock.blocked) {
                  throw new Blocked503Error(navBlock.status, navBlock.reason);
                }

                consecutive503Count = 0;
                let pagesVisitedInCombo = 0;
                let consecutiveNoNewPages = 0;

                for (let p = 1; p <= maxPages; p++) {
                  if (this.isStopRequested(control.signal)) break;
                  await waitIfPaused(myGen, mySkipVersion);
                  if (this.isStopRequested(control.signal)) break;

                  const pageResult = await this.runWithWatchdog(async () => {
                    if (apiBlockError) throw apiBlockError;
                    const blk = await this.isBlockedOr503(page);
                    if (blk.blocked) {
                      throw new Blocked503Error(blk.status, blk.reason);
                    }

                    const cardFound = await page
                      .waitForSelector('a[href*="/rooms/"], [data-testid="card-container"]', {
                        timeout: 25000,
                      })
                      .catch(() => null);

                    if (!cardFound) {
                      if (apiBlockError) throw apiBlockError;
                      const blkEmpty = await this.isBlockedOr503(page);
                      if (blkEmpty.blocked) {
                        throw new Blocked503Error(blkEmpty.status, blkEmpty.reason);
                      }
                      if (p === 1) {
                        control.onLog(`[${tabLabel}] ${comboTag}: Không thấy thẻ phòng nào.`, 'info');
                      }
                      return 'stop_combo' as const;
                    }

                    consecutive503Count = 0;
                    pagesVisitedInCombo = p;

                    const deferred = await this.extractDeferredJson(page);
                    if (deferred) {
                      const parsed = this.pdpParser.extractSearchListingsFromJson(deferred, {
                        locationQuery: cityName,
                        checkIn: combo.checkIn,
                        checkOut: combo.checkOut,
                        nights: combo.nights,
                      });
                      for (const rec of parsed) {
                        this.db.upsertRoom(rec);
                        recordDiscoveredRoom(rec.listing_id, rec.url, combo);
                      }
                    }

                    await this.humanSmoothScroll(page, control.signal);

                    const hrefs = await page
                      .locator('a[href*="/rooms/"]')
                      .evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''))
                      .catch(() => []);

                    for (const href of hrefs) {
                      if (!href.includes('/rooms/')) continue;
                      const rid = href.split('/rooms/')[1]?.split('?')[0] || '';
                      if (/^\d+$/.test(rid)) {
                        recordDiscoveredRoom(
                          rid,
                          buildRoomUrl(rid, combo.checkIn, combo.checkOut),
                          combo,
                        );
                      }
                    }

                    if (newIdsThisPage === 0) {
                      consecutiveNoNewPages++;
                    } else {
                      consecutiveNoNewPages = 0;
                    }

                    control.onLog(
                      `[${tabLabel}] ${comboTag} — Trang ${p}/${maxPages}: Phát hiện +${newIdsThisPage} căn MỚI (Tổng duy nhất: ${discoveredIds.size} căn)`,
                      newIdsThisPage > 0 ? 'success' : 'info',
                    );

                    if (consecutiveNoNewPages >= 2) {
                      control.onLog(
                        `[Smart Early-Stop] [${tabLabel}] ${comboTag}: 2 trang liên tiếp không có căn mới → dừng sớm chuyển tổ hợp tiếp theo!`,
                        'step',
                      );
                      return 'stop_combo' as const;
                    }

                    if (p >= maxPages) return 'stop_combo' as const;

                    const nextBtn = page
                      .locator('a[aria-label="Tiếp theo"], a[aria-label="Next"]')
                      .first();
                    if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible().catch(() => false))) {
                      control.onLog(
                        `[${tabLabel}] Đang chuyển sang Trang ${p + 1}/${maxPages}...`,
                        'info',
                      );
                      await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
                      await nextBtn.hover().catch(() => {});
                      await randomDelay(300, 650);
                      apiBlockError = null;
                      newIdsThisPage = 0;
                      await nextBtn.click({ timeout: 10000 }).catch(() => {});
                      await randomDelay(2000, 4000);
                      if (apiBlockError) throw apiBlockError;
                      const blkNext = await this.isBlockedOr503(page);
                      if (blkNext.blocked) {
                        throw new Blocked503Error(blkNext.status, blkNext.reason);
                      }
                      return 'next_page' as const;
                    }
                    return 'stop_combo' as const;
                  }, 45000, `${comboTag} Trang ${p}`, isPausedOrSwitching);

                  if (pageResult === 'stop_combo') break;
                }

                // Dynamic Split: Chỉ chẻ đôi tối đa 1 lần khi chạm maxPages và vẫn đang có căn mới
                if (
                  !this.isStopRequested(control.signal) &&
                  enablePriceSlicing &&
                  pagesVisitedInCombo >= maxPages &&
                  consecutiveNoNewPages < 2 &&
                  (combo.bucket.splitDepth ?? 0) < 1 &&
                  combo.bucket.max !== null &&
                  combo.bucket.max - combo.bucket.min >= 300000
                ) {
                  const mid = Math.round((combo.bucket.min + combo.bucket.max) / 2);
                  const nextDepth = (combo.bucket.splitDepth ?? 0) + 1;
                  comboQueue.push(
                    {
                      ...combo,
                      bucket: {
                        min: combo.bucket.min,
                        max: mid,
                        label: `${Math.round(combo.bucket.min / 1000)}k - ${Math.round(mid / 1000)}k`,
                        splitDepth: nextDepth,
                      },
                    },
                    {
                      ...combo,
                      bucket: {
                        min: mid,
                        max: combo.bucket.max,
                        label: `${Math.round(mid / 1000)}k - ${Math.round(combo.bucket.max / 1000)}k`,
                        splitDepth: nextDepth,
                      },
                    },
                  );
                  control.onLog(
                    `[Dynamic Split] ${comboTag} chạm ${maxPages} trang → chẻ đôi (1/1) để vét cạn!`,
                    'step',
                  );
                }

                comboCompleted = true;
                break;
              } catch (bucketErr: any) {
                if (this.isStopRequested(control.signal)) break;

                if (bucketErr instanceof SkipCurrentItemError) {
                  control.onLog(
                    `[${tabLabel}] Đã bỏ qua ${comboTag} theo lệnh người dùng.`,
                    'warn',
                  );
                  comboCompleted = true;
                  break;
                }

                if (
                  bucketErr instanceof ContextRecreatedError ||
                  (this.isTargetClosedError(bucketErr) && contextGeneration !== myGen)
                ) {
                  await recreateStep1Page();
                  retry503--; // Không tính vào số lần thử 503 khi đổi Proxy nóng
                  continue;
                }

                if (this.isTargetClosedError(bucketErr)) {
                  break;
                }

                if (bucketErr instanceof Blocked503Error) {
                  try {
                    await trigger503Cooldown(tabLabel, bucketErr.reason, myGen, mySkipVersion);
                  } catch (waitErr) {
                    if (waitErr instanceof SkipCurrentItemError) {
                      control.onLog(
                        `[${tabLabel}] Đã bỏ qua ${comboTag} theo lệnh người dùng.`,
                        'warn',
                      );
                      comboCompleted = true;
                      break;
                    }
                    if (waitErr instanceof ContextRecreatedError) {
                      await recreateStep1Page();
                      retry503--;
                      continue;
                    }
                  }
                  if (retry503 >= 2) {
                    control.onLog(
                      `[${tabLabel}] Bỏ qua ${comboTag} sau 3 lần gặp 503/chặn.`,
                      'warn',
                    );
                    comboCompleted = true;
                  }
                  continue;
                }

                if (this.isWatchdogError(bucketErr)) {
                  comboCompleted = true;
                  await replaceStep1Tab(comboTag);
                  break;
                }

                control.onLog(
                  `[${tabLabel}] Lỗi tại ${comboTag}: ${bucketErr?.message || bucketErr} — chuyển sang tổ hợp tiếp theo.`,
                  'warn',
                );
                comboCompleted = true;
                break;
              }
            }

            if (comboCompleted) {
              completedCombos++;
              const pct = 6 + Math.min(28, Math.round((completedCombos / Math.max(1, totalInitialCombos)) * 28));
              control.onProgress(
                pct,
                `Bước 1/4: Đã gom ${discoveredIds.size} căn (${completedCombos}/${totalInitialCombos} tổ hợp)`,
              );
            }
          }
        } finally {
          page.off('response', onSearchResponse);
          await page.close().catch(() => {});
        }
      });

      await Promise.all(step1Workers);

      if (this.isStopRequested(control.signal)) {
        stoppedEarly = true;
      }

      // =========================================================================
      // BƯỚC 2: Multi-Tab Đọc Chi Tiết Phòng & Tiện Nghi (PDP & AMENITIES_DEFAULT)
      // =========================================================================
      if (!stoppedEarly) {
        currentStep = 2;
        const allIds = Array.from(discoveredIds);
        const completedIds = this.db.getCompletedRoomIds();
        const pendingIds = allIds.filter((id) => !completedIds.has(id));

        control.onLog(
          `[Bước 2 | Smart Incremental] Tổng ${allIds.length} căn • Bỏ qua ${allIds.length - pendingIds.length} căn đã có đủ dữ liệu • Cần đọc PDP: ${pendingIds.length} căn.`,
          'step',
        );

        if (pendingIds.length > 0) {
          let cursor = 0;
          let pdpDone = 0;
          const pdpWorkersCount = Math.min(safeTabs, pendingIds.length);

          const step2Workers = Array.from({ length: pdpWorkersCount }, async (_, tabIdx) => {
            if (tabIdx > 0) {
              await sleep(tabIdx * (1500 + Math.floor(Math.random() * 1000)));
            }
            if (this.isStopRequested(control.signal)) return;

            const tabLabel = `Tab ${tabIdx + 1}/${safeTabs} | Bước 2`;
            let myGen = contextGeneration;
            let page = await this.browserService.newHumanPage(context);
            const recreateStep2Page = async () => {
              await page.close().catch(() => {});
              myGen = contextGeneration;
              page = await this.browserService.newHumanPage(context);
            };

            try {
              while (true) {
                if (this.isStopRequested(control.signal)) break;
                try {
                  await waitIfPaused(myGen);
                } catch (err) {
                  if (err instanceof ContextRecreatedError) {
                    await recreateStep2Page();
                    continue;
                  }
                  throw err;
                }
                if (this.isStopRequested(control.signal)) break;

                const idx = cursor++;
                if (idx >= pendingIds.length) break;

                const rid = pendingIds[idx];
                const urlInfo = discoveredUrls.get(rid);
                const url = urlInfo?.url || buildRoomUrl(rid, checkIn, checkOut);
                const itemCheckIn = urlInfo?.checkIn ?? checkIn;
                const itemCheckOut = urlInfo?.checkOut ?? checkOut;
                const itemNights = urlInfo?.nights ?? nights;
                const mySkipVersion = skipVersion;

                try {
                  for (let retry503 = 0; retry503 < 3; retry503++) {
                    if (this.isStopRequested(control.signal)) break;
                    await waitIfPaused(myGen, mySkipVersion);

                    control.onLog(
                      `[${tabLabel}] Đang đọc PDP căn #${rid}... (${idx + 1}/${pendingIds.length}${retry503 > 0 ? ` — thử lại ${retry503 + 1}/3` : ''})`,
                      'info',
                    );
                    try {
                      const room = await this.runWithWatchdog(
                        () =>
                          this.scrapeRoomDetail({
                            page,
                            roomId: rid,
                            url,
                            locationQuery: cityName,
                            checkIn: itemCheckIn,
                            checkOut: itemCheckOut,
                            nights: itemNights,
                            tabLabel,
                            control,
                          }),
                        45000,
                        `Đọc PDP #${rid}`,
                        isPausedOrSwitching,
                      );
                      consecutive503Count = 0;
                      if (room) {
                        this.db.upsertRoom(room);
                      }
                      break;
                    } catch (err: any) {
                      if (this.isStopRequested(control.signal)) break;

                      if (err instanceof SkipCurrentItemError) {
                        control.onLog(
                          `[${tabLabel}] Đã bỏ qua căn #${rid} theo lệnh người dùng.`,
                          'warn',
                        );
                        break;
                      }

                      if (
                        err instanceof ContextRecreatedError ||
                        (this.isTargetClosedError(err) && contextGeneration !== myGen)
                      ) {
                        await recreateStep2Page();
                        retry503--;
                        continue;
                      }

                      if (this.isTargetClosedError(err)) {
                        throw err;
                      }

                      if (err instanceof Blocked503Error) {
                        await trigger503Cooldown(tabLabel, err.reason, myGen, mySkipVersion);
                        if (retry503 >= 2) {
                          control.onLog(
                            `[${tabLabel}] Bỏ qua căn #${rid} sau 3 lần gặp 503/chặn.`,
                            'warn',
                          );
                        }
                        continue;
                      }

                      if (this.isWatchdogError(err)) {
                        control.onLog(
                          `[${tabLabel}] Watchdog 45s: Tab đọc PDP #${rid} bị treo — Đang đóng Tab cũ và mở Tab mới thay thế...`,
                          'warn',
                        );
                        await recreateStep2Page();
                        break;
                      }

                      control.onLog(`[${tabLabel}] Lỗi PDP ${rid}: ${err?.message || err}`, 'warn');
                      break;
                    }
                  }
                } catch (err: any) {
                  if (err instanceof SkipCurrentItemError) {
                    control.onLog(`[${tabLabel}] Đã bỏ qua căn #${rid} theo lệnh người dùng.`, 'warn');
                  } else if (
                    err instanceof ContextRecreatedError ||
                    (this.isTargetClosedError(err) && contextGeneration !== myGen)
                  ) {
                    await recreateStep2Page();
                  } else if (this.isStopRequested(control.signal) || this.isTargetClosedError(err)) {
                    break;
                  }
                } finally {
                  pdpDone++;
                  if (pdpDone % 5 === 0 || pdpDone === pendingIds.length) {
                    control.onLog(
                      `[${tabLabel}] Đã đọc PDP ${pdpDone}/${pendingIds.length} căn...`,
                      'info',
                    );
                  }
                  const pct = 35 + Math.round((pdpDone / pendingIds.length) * (includeHostRooms ? 35 : 55));
                  control.onProgress(pct, `Bước 2/4: Đã đọc chi tiết ${pdpDone}/${pendingIds.length} căn`);
                }

                await randomDelay(2000, 4000);
              }
            } finally {
              await page.close().catch(() => {});
            }
          });

          await Promise.all(step2Workers);
        }

        if (this.isStopRequested(control.signal)) {
          stoppedEarly = true;
        }
      }

      // =========================================================================
      // BƯỚC 3: Multi-Tab Mở Rộng Danh Mục Chủ Nhà (Host Portfolio Expansion)
      // =========================================================================
      if (!stoppedEarly && includeHostRooms) {
        currentStep = 3;
        const dbRooms = this.db.getAllRoomsForCity(cityName);
        const hostCounts = new Map<string, { name: string; count: number }>();
        for (const r of dbRooms) {
          if (!r.host_id) continue;
          const cur = hostCounts.get(r.host_id) || { name: r.host_name || `Host ${r.host_id}`, count: 0 };
          cur.count++;
          hostCounts.set(r.host_id, cur);
        }

        const hostList = Array.from(hostCounts.entries())
          .sort((a, b) => b[1].count - a[1].count)
          .slice(0, 60); // Ưu tiên tối đa 60 Host lớn nhất để đảm bảo tốc độ

        if (hostList.length > 0) {
          control.onLog(
            `[Bước 3] Mở rộng danh mục cho ${hostList.length} Host bằng ${safeTabs} Tab...`,
            'step',
          );

          let hostCursor = 0;
          let hostsDone = 0;
          const hostWorkersCount = Math.min(safeTabs, hostList.length);
          const cityLower = cityName.toLowerCase();

          const step3Workers = Array.from({ length: hostWorkersCount }, async (_, tabIdx) => {
            if (tabIdx > 0) {
              await sleep(tabIdx * (1500 + Math.floor(Math.random() * 1000)));
            }
            if (this.isStopRequested(control.signal)) return;

            const tabLabel = `Tab ${tabIdx + 1}/${safeTabs} | Bước 3`;
            let myGen = contextGeneration;
            let page = await this.browserService.newHumanPage(context);
            const recreateStep3Page = async () => {
              await page.close().catch(() => {});
              myGen = contextGeneration;
              page = await this.browserService.newHumanPage(context);
            };

            try {
              while (true) {
                if (this.isStopRequested(control.signal)) break;
                try {
                  await waitIfPaused(myGen);
                } catch (err) {
                  if (err instanceof ContextRecreatedError) {
                    await recreateStep3Page();
                    continue;
                  }
                  throw err;
                }
                if (this.isStopRequested(control.signal)) break;

                const idx = hostCursor++;
                if (idx >= hostList.length) break;

                const [hostId, info] = hostList[idx];
                const mySkipVersion = skipVersion;
                try {
                  let roomIds: string[] = [];
                  for (let retry503 = 0; retry503 < 3; retry503++) {
                    if (this.isStopRequested(control.signal)) break;
                    await waitIfPaused(myGen, mySkipVersion);

                    control.onLog(
                      `[${tabLabel}] Đang mở hồ sơ Host ${info.name || hostId}... (${idx + 1}/${hostList.length}${retry503 > 0 ? ` — thử lại ${retry503 + 1}/3` : ''})`,
                      'info',
                    );
                    try {
                      roomIds = await this.runWithWatchdog(
                        () =>
                          this.hostParser.collectHostRoomIds(
                            page,
                            buildHostProfileUrl(hostId),
                            async (resp) => {
                              const blk = await this.isBlockedOr503(page, resp);
                              if (blk.blocked) {
                                throw new Blocked503Error(blk.status, blk.reason);
                              }
                            },
                          ),
                        45000,
                        `Mở hồ sơ Host ${hostId}`,
                        isPausedOrSwitching,
                      );
                      consecutive503Count = 0;
                      break;
                    } catch (err: any) {
                      if (this.isStopRequested(control.signal)) break;
                      if (err instanceof SkipCurrentItemError) throw err;
                      if (
                        err instanceof ContextRecreatedError ||
                        (this.isTargetClosedError(err) && contextGeneration !== myGen)
                      ) {
                        await recreateStep3Page();
                        retry503--;
                        continue;
                      }
                      if (err instanceof Blocked503Error) {
                        await trigger503Cooldown(tabLabel, err.reason, myGen, mySkipVersion);
                        continue;
                      }
                      throw err;
                    }
                  }

                  for (const rid of roomIds) {
                    if (this.isStopRequested(control.signal)) break;
                    if (discoveredIds.has(rid)) continue;

                    const roomSkipVersion = skipVersion;
                    for (let retry503 = 0; retry503 < 3; retry503++) {
                      if (this.isStopRequested(control.signal)) break;
                      await waitIfPaused(myGen, roomSkipVersion);

                      control.onLog(
                        `[${tabLabel}] Đang đọc PDP phòng #${rid} của Host ${info.name || hostId}...`,
                        'info',
                      );
                      try {
                        const detail = await this.runWithWatchdog(
                          () =>
                            this.scrapeRoomDetail({
                              page,
                              roomId: rid,
                              url: buildRoomUrl(rid, checkIn, checkOut),
                              locationQuery: cityName,
                              checkIn,
                              checkOut,
                              nights,
                              tabLabel,
                              control,
                            }),
                          45000,
                          `Đọc PDP phòng #${rid} của Host ${hostId}`,
                          isPausedOrSwitching,
                        );
                        consecutive503Count = 0;
                        if (detail) {
                          const locTxt = `${detail.title} ${detail.location_text || ''} ${detail.description}`.toLowerCase();
                          const isInTarget =
                            locTxt.includes(cityLower) ||
                            (cityLower.includes('ho chi minh') && (locTxt.includes('hcm') || locTxt.includes('saigon') || locTxt.includes('hồ chí minh')))
                              ? 1
                              : 0;

                          const rec: HostListingRecord = {
                            ...detail,
                            owner_host_id: hostId,
                            owner_host_name: info.name || detail.host_name,
                            is_in_target: isInTarget,
                          };
                          this.db.upsertHostRoom(rec);
                          if (isInTarget === 1) {
                            this.db.upsertRoom(detail);
                          }
                          totalHostRoomsSaved++;
                        }
                        break;
                      } catch (roomErr: any) {
                        if (this.isStopRequested(control.signal)) break;
                        if (roomErr instanceof SkipCurrentItemError) {
                          control.onLog(`[${tabLabel}] Đã bỏ qua phòng #${rid} theo lệnh người dùng.`, 'warn');
                          break;
                        }
                        if (
                          roomErr instanceof ContextRecreatedError ||
                          (this.isTargetClosedError(roomErr) && contextGeneration !== myGen)
                        ) {
                          await recreateStep3Page();
                          retry503--;
                          continue;
                        }
                        if (roomErr instanceof Blocked503Error) {
                          await trigger503Cooldown(tabLabel, roomErr.reason, myGen, roomSkipVersion);
                          continue;
                        }
                        throw roomErr;
                      }
                    }
                    await randomDelay(2000, 4000);
                  }
                } catch (err: any) {
                  if (err instanceof SkipCurrentItemError) {
                    control.onLog(`[${tabLabel}] Đã bỏ qua Host ${hostId} theo lệnh người dùng.`, 'warn');
                  } else if (
                    err instanceof ContextRecreatedError ||
                    (this.isTargetClosedError(err) && contextGeneration !== myGen)
                  ) {
                    await recreateStep3Page();
                  } else if (this.isStopRequested(control.signal) || this.isTargetClosedError(err)) {
                    break;
                  } else if (this.isWatchdogError(err)) {
                    control.onLog(
                      `[${tabLabel}] Watchdog 45s: Tab mở rộng Host ${hostId} bị treo — Đang đóng Tab cũ và mở Tab mới thay thế...`,
                      'warn',
                    );
                    await recreateStep3Page();
                  } else {
                    control.onLog(`[${tabLabel}] Lỗi Host ${hostId}: ${err?.message || err}`, 'warn');
                  }
                } finally {
                  hostsDone++;
                  const pct = 70 + Math.round((hostsDone / hostList.length) * 22);
                  control.onProgress(pct, `Bước 3/4: Đã mở rộng ${hostsDone}/${hostList.length} Host`);
                }
              }
            } finally {
              await page.close().catch(() => {});
            }
          });

          await Promise.all(step3Workers);
        }

        if (this.isStopRequested(control.signal)) {
          stoppedEarly = true;
        }
      }
    } catch (pipelineErr: any) {
      if (!this.isStopRequested(control.signal) && !this.isTargetClosedError(pipelineErr)) {
        throw pipelineErr;
      }
      stoppedEarly = true;
    } finally {
      clearInterval(pauseTicker);
      // Đóng gọn trình duyệt ngay để giải phóng RAM trước khi xuất Excel
      await this.browserService.forceClose();
      await context.close().catch(() => {});
      await browser?.close().catch(() => {});
    }

    // =========================================================================
    // BƯỚC 4: STOP & EXPORT ANYTIME — Luôn xuất cả 2 file Excel dữ liệu hiện có
    // =========================================================================
    if (stoppedEarly || this.isStopRequested(control.signal)) {
      stoppedEarly = true;
      control.onLog(
        `[Hệ thống] Đã nhận lệnh dừng tại Bước ${currentStep} — Đang xuất Excel toàn bộ dữ liệu đã thu được...`,
        'warn',
      );
    } else {
      currentStep = 4;
    }

    control.onProgress(95, 'Bước 4/4: Đang tổng hợp cụm tòa nhà & xuất 2 file Excel...');
    const { cityReport, masterReport } = await this.exporter.exportAllReports(cityName);
    control.onLog(`[Excel] Đã xuất ${cityReport.fileName}`, 'success');
    control.onLog(`[Excel] Đã cập nhật ${masterReport.fileName}`, 'success');

    const finalRooms = this.db.getAllRoomsForCity(cityName);
    const uniqueHosts = new Set(finalRooms.map((r) => r.host_id).filter(Boolean)).size;

    control.onProgress(100, stoppedEarly ? `Đã dừng tại Bước ${currentStep} & Xuất Excel xong!` : 'Hoàn tất toàn bộ quy trình!');

    return {
      cityName,
      stoppedEarly,
      stoppedAtStep: stoppedEarly ? currentStep : undefined,
      totalUrls: discoveredIds.size,
      totalRooms: finalRooms.length,
      totalHosts: uniqueHosts,
      totalHostRooms: totalHostRoomsSaved,
      cityReportFile: cityReport.fileName,
      masterReportFile: masterReport.fileName,
    };
  }
}
