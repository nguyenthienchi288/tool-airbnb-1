import { Injectable } from '@nestjs/common';
import { Browser, BrowserContext, Page, Response } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { Response as ExpressResponse } from 'express';
import {
  cleanControlChars,
  parseProxyUrl,
  randomDelay,
  sleep,
} from '../../common/helpers';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { PdpParserService } from '../parser/pdp-parser.service';
import { HostParserService } from '../parser/host-parser.service';
import { BrowserService } from '../scraper/browser.service';
import { AiEnrichmentService } from './ai-enrichment.service';
import { buildSevenNightsPreview, exportSevenNightsBundle } from './bundle-exporter';
import {
  extractBuildingNameFromText,
  isBlacklistedBuildingName,
  reverseGeocodeCoords,
  searchAddressByBuildingName,
} from './geo-enrichment';
import {
  extractStructuredPdpFromJson,
  isValidHostName,
  normalizeUnicodeSpaces,
} from './pdp-json-extractor';
import {
  DeepExtractedRoom,
  DeepExtractBundleResult,
  DeepExtractJobInput,
  ParsedAirbnbUrl,
  SevenNightsPreviewData,
} from './types';
import { checkBoundingBox, parseAirbnbSearchUrl } from './url-parser';

export interface DeepJobState {
  jobId: string;
  status: 'running' | 'completed' | 'stopped' | 'error';
  percent: number;
  label: string;
  logs: Array<{ timestamp: string; level: string; message: string }>;
  preview: SevenNightsPreviewData;
  result?: DeepExtractBundleResult;
  error?: string;
  abortController: AbortController;
  isStopRequested: boolean;
  activeBrowser?: Browser | null;
  clients: Set<ExpressResponse>;
  pauseState: { status: 'running' | 'paused' | 'paused_503'; countdownSeconds: number; reason?: string };
  handlers?: {
    pause: () => void;
    resume: () => void;
    resetSession: () => Promise<void>;
    skipCurrent: () => void;
    updateProxy: (proxyUrl?: string) => Promise<void>;
  };
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

class SkipCurrentError extends Error {
  constructor() {
    super('SKIP_CURRENT');
    this.name = 'SkipCurrentError';
  }
}

class ContextRecreatedError extends Error {
  constructor() {
    super('CONTEXT_RECREATED');
    this.name = 'ContextRecreatedError';
  }
}

@Injectable()
export class DeepLinkExtractorService {
  private readonly jobs = new Map<string, DeepJobState>();
  private keptBrowser: Browser | null = null;
  private keptContext: BrowserContext | null = null;

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly db: DatabaseService,
    private readonly browserService: BrowserService,
    private readonly pdpParser: PdpParserService,
    private readonly hostParser: HostParserService,
    private readonly aiEnrichment: AiEnrichmentService,
  ) {}

  async closeKeptBrowser() {
    if (this.keptContext) {
      await this.keptContext.close().catch(() => {});
      this.keptContext = null;
    }
    if (this.keptBrowser) {
      await this.keptBrowser.close().catch(() => {});
      this.keptBrowser = null;
    }
  }

  parseUrl(rawUrl: string): ParsedAirbnbUrl {
    return parseAirbnbSearchUrl(rawUrl);
  }

  getJob(jobId: string): DeepJobState | undefined {
    return this.jobs.get(jobId);
  }

  getActiveJob(): DeepJobState | undefined {
    for (const j of this.jobs.values()) {
      if (j.status === 'running') return j;
    }
    return undefined;
  }

  sendSse(res: ExpressResponse, event: string, data: unknown) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Ignore closed stream
    }
  }

  private broadcast(job: DeepJobState, event: string, data: unknown) {
    for (const c of job.clients) {
      this.sendSse(c, event, data);
    }
  }

  private pushLog(
    job: DeepJobState,
    message: string,
    level: 'info' | 'success' | 'warn' | 'error' | 'step' = 'info',
  ) {
    const entry = {
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      level,
      message,
    };
    job.logs.push(entry);
    if (job.logs.length > 500) job.logs.shift();
    this.broadcast(job, 'log', entry);
  }

  private pushProgress(job: DeepJobState, percent: number, label: string) {
    job.percent = Math.min(100, Math.max(0, Math.round(percent)));
    job.label = label;
    this.broadcast(job, 'progress', {
      status: job.status,
      percent: job.percent,
      label: job.label,
    });
  }

  startJob(input: DeepExtractJobInput): DeepJobState {
    const parsed = parseAirbnbSearchUrl(input.url);
    const job: DeepJobState = {
      jobId: uuidv4(),
      status: 'running',
      percent: 3,
      label: 'Đang khởi chạy trình duyệt Single-Tab (Chế độ chính xác 100%)...',
      logs: [],
      preview: { buildings: [], hosts: [], rooms: [] },
      abortController: new AbortController(),
      isStopRequested: false,
      clients: new Set(),
      pauseState: { status: 'running', countdownSeconds: 0 },
    };
    this.jobs.set(job.jobId, job);

    this.pushLog(
      job,
      `[Deep Extractor] Địa điểm: ${parsed.platformLocation.locationDisplay} | Khung tọa độ: ${parsed.mapBounds.hasBounds ? 'CÓ' : 'KHÔNG'} | Tải ảnh: ${input.downloadPhotos ? 'BẬT' : 'TẮT'}`,
      'step',
    );

    void this.runPipeline(job, parsed, input).catch((err) => {
      job.status = 'error';
      job.error = err?.message || 'Lỗi không xác định';
      this.pushLog(job, `[FAILED] ${job.error}`, 'error');
      this.broadcast(job, 'error', { status: 'error', error: job.error });
    });

    return job;
  }

  async stopJob(jobId?: string): Promise<DeepJobState | undefined> {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job) return undefined;
    job.isStopRequested = true;
    job.abortController.abort();
    this.pushLog(job, '[Hệ thống] Đang dừng & đóng gói dữ liệu đã thu thập...', 'warn');
    await this.browserService.forceClose();
    if (job.activeBrowser) {
      await job.activeBrowser.close().catch(() => {});
      job.activeBrowser = undefined;
    }
    return job;
  }

  pauseJob(jobId?: string) {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (job && job.status === 'running') job.handlers?.pause();
    return job;
  }

  resumeJob(jobId?: string) {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (job && job.status === 'running') job.handlers?.resume();
    return job;
  }

  skipCurrent(jobId?: string) {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (job && job.status === 'running') job.handlers?.skipCurrent();
    return job;
  }

  async resetSession(jobId?: string) {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (job && job.status === 'running') await job.handlers?.resetSession();
    return job;
  }

  async updateProxy(proxyUrl?: string, jobId?: string) {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (job && job.status === 'running') await job.handlers?.updateProxy(proxyUrl);
    return job;
  }

  private async isBlockedOr503(
    page: Page,
    response?: Response | null,
  ): Promise<{ blocked: boolean; status: number; reason: string }> {
    const st = response?.status() ?? 0;
    if (st === 503) return { blocked: true, status: 503, reason: 'HTTP 503 Service Unavailable' };
    if (st === 429) return { blocked: true, status: 429, reason: 'HTTP 429 Too Many Requests' };
    try {
      const [title, body, captchaCount] = await Promise.all([
        page.title().catch(() => ''),
        page.locator('body').innerText({ timeout: 1000 }).catch(() => ''),
        page
          .locator('iframe[src*="arkose"], iframe[src*="captcha"], iframe[title*="challenge"], iframe[src*="recaptcha"]')
          .count()
          .catch(() => 0),
      ]);
      const combined = `${title}\n${body}`.toLowerCase();
      if (
        combined.includes('error code: 503') ||
        combined.includes('airbnb is temporarily unavailable') ||
        combined.includes('pardon our interruption') ||
        (combined.includes('stay tuned') && (combined.includes('airbnb') || combined.includes('unavailable')))
      ) {
        return { blocked: true, status: 503, reason: 'Trang 503 (Stay tuned / Temporarily unavailable)' };
      }
      if (captchaCount > 0 || combined.includes('verify you are human') || combined.includes('arkose')) {
        return { blocked: true, status: 429, reason: 'Phát hiện Captcha / Robot check' };
      }
    } catch {
      // Ignore
    }
    return { blocked: false, status: st, reason: '' };
  }

  private extractAmenityFlags(amenities: string[], description: string, houseRules: string) {
    const joined = amenities.join(' | ').toLowerCase();
    const fullText = `${joined}\n${description}\n${houseRules}`.toLowerCase();
    const hasExactOrSub = (kws: string[]) =>
      (amenities.some((a) => {
        const al = a.toLowerCase();
        return kws.some((k) => al.includes(k));
      })
        ? 'YES'
        : 'NO') as 'YES' | 'NO';

    const poolYes = hasExactOrSub(['pool', 'hồ bơi', 'bể bơi', '泳池', '수영장']) === 'YES';
    const gymYes =
      hasExactOrSub(['gym', 'fitness', 'phòng tập', '健身房', '헬스', '피트니스']) === 'YES' ||
      /(?:피트니스|헬스장|fitness\s+center|gym\s+access)/i.test(description);

    let gymStr = gymYes ? 'YES' : 'NO';
    let gymFee = '';
    if (gymYes) {
      const gymSentenceMatch = `${description}\n${houseRules}`.match(
        /[^\n.]*(?:gym|fitness|헬스장|피트니스)[^\n.]*/i,
      );
      if (gymSentenceMatch) {
        const sentence = normalizeUnicodeSpaces(gymSentenceMatch[0]);
        const hoursMatch = sentence.match(
          /(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*[-–~to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/,
        );
        if (hoursMatch) {
          gymStr = `YES, ${normalizeUnicodeSpaces(hoursMatch[1])}`;
        }
      }
      if (/(paid|fee|charge|extra\s*cost|pay\b|유료|별도\s*요금|결제|이용료|付费)/i.test(fullText)) {
        gymFee = 'Have to pay';
      } else if (/(free\s*gym|gym\s*is\s*free|complimentary\s*gym|무료\s*헬스|무료\s*피트니스|免费健身)/i.test(fullText)) {
        gymFee = 'Free';
      } else {
        gymFee = 'Check with host';
      }
    }

    let parking = 'NO';
    if (
      hasExactOrSub(['free parking', '무료 주차', '免费停车', 'miễn phí đỗ xe']) === 'YES' ||
      /(?:free\s*parking|무료\s*주차)/i.test(description)
    ) {
      parking = 'yes, free parking';
    } else if (
      hasExactOrSub(['paid parking', 'parking', '유료 주차', '收费停车', '주차']) === 'YES' ||
      /(?:paid\s*parking|유료\s*주차|주차\s*가능)/i.test(description)
    ) {
      parking = 'yes, payable parking';
    }

    return {
      airConditioner: hasExactOrSub([
        'air conditioning',
        'central air conditioning',
        'ac',
        '에어컨',
        '空调',
        'điều hòa',
      ]),
      hairDryer: hasExactOrSub(['hair dryer', '헤어드라이어', '吹风机', 'máy sấy tóc']),
      shampooBodyWash: hasExactOrSub([
        'shampoo',
        'body soap',
        'shower gel',
        '샴푸',
        '바디워시',
        '洗发水',
        '沐浴露',
      ]),
      towel: hasExactOrSub(['essentials', 'towels', 'towel', '수건', '毛巾', 'khăn tắm']),
      tv: hasExactOrSub(['tv', 'hdtv', 'television', '텔레비전', '电视', 'tivi']),
      wifi: hasExactOrSub(['wifi', 'wi-fi', 'pocket wifi', '무선 인터넷', '와이파이', '无线网络']),
      washingMachine: hasExactOrSub([
        'washer',
        'free washer',
        'paid washer',
        'washing machine',
        '세탁기',
        '洗衣机',
        'máy giặt',
      ]),
      kitchen: hasExactOrSub(['kitchen', 'kitchenette', '주방', '厨房', 'bếp']),
      basicCookingStaff: hasExactOrSub([
        'cooking basics',
        '기본 조리도구',
        '취사도구',
        '基本厨具',
        'dụng cụ nấu ăn',
      ]),
      swimmingPool: poolYes ? 'YES' : 'NO',
      gym: gymStr,
      gymFee,
      parking,
    };
  }

  private inferRoomType(bedrooms: number, title: string): string {
    if (bedrooms <= 0 || /\bstudio\b|원룸|one[\s-]?room/i.test(title)) {
      return bedrooms > 0 ? `${bedrooms}BR` : 'Studio';
    }
    return `${bedrooms}BR`;
  }

  private extractDistrict(address: string, locationText: string, description: string): string {
    const combined = `${address} ${locationText} ${description}`;
    const guMatch = combined.match(/\b([A-Za-z-]+-gu)\b/i);
    if (guMatch) return guMatch[1];
    const dongMatch = combined.match(/\b([A-Za-z-]+-dong)\b/i);
    if (dongMatch) return dongMatch[1];
    const quanMatch = combined.match(/\b(District\s+\d+|Quận\s+\d+|Bình Thạnh|Thảo Điền|Phú Nhuận|Tân Bình)\b/i);
    if (quanMatch) return quanMatch[1];
    return '';
  }

  private extractSupplierAptCode(title: string, description: string): string {
    const text = `${title} ${description}`;
    const match = text.match(
      /(?:#|Unit\s+|Apt\s+|Room\s+|\[)([A-Z]?-?\d{3,4}[A-Z]?)\]?\b|(\d{3,4}호)/i,
    );
    return match ? match[0].replace(/[\[\]]/g, '').trim() : '';
  }

  private async humanBrowseScroll(page: Page, steps = 4) {
    for (let s = 0; s < steps; s++) {
      const dy = 450 + Math.floor(Math.random() * 250);
      await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy).catch(() => {});
      const mx = 220 + Math.floor(Math.random() * 900);
      const my = 180 + Math.floor(Math.random() * 500);
      await page.mouse.move(mx, my, { steps: 6 }).catch(() => {});
      await randomDelay(400, 800);
    }
  }

  private collectPhotosFromObject(obj: unknown, out: Set<string>, depth = 0) {
    if (!obj || depth > 10 || out.size > 30) return;
    if (typeof obj === 'string') {
      if (/^https?:\/\/[^"'\s]*muscache\.com\/im\/pictures\//i.test(obj)) {
        const clean = obj.replace(/im_w=\d+/i, 'im_w=1200');
        out.add(clean);
      }
      return;
    }
    if (Array.isArray(obj)) {
      for (const item of obj) this.collectPhotosFromObject(item, out, depth + 1);
      return;
    }
    if (typeof obj === 'object') {
      for (const v of Object.values(obj as Record<string, unknown>)) {
        this.collectPhotosFromObject(v, out, depth + 1);
      }
    }
  }

  private parseHouseRulesDetails(text: string, fallbackDescription = ''): {
    checkInTime: string;
    checkOutTime: string;
    childPolicy: string;
  } {
    const lineSafe = (text || '').replace(/[\u202f\u00a0\u2009]/g, ' ');
    let checkInTime = '';
    let checkOutTime = '';
    const childLines: string[] = [];

    for (const rawLine of lineSafe.split(/\r?\n/)) {
      const line = normalizeUnicodeSpaces(rawLine);
      if (!line) continue;

      if (!checkInTime && /\d/.test(line) && /check-?in/i.test(line) && !/self\s+check-?in/i.test(line)) {
        const m = line.match(
          /check-?in(?:\s+after|\s+from|\s+is|\s*:)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?(?:\s*[-–~]\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)?)/i,
        );
        if (m) checkInTime = normalizeUnicodeSpaces(m[1]);
      }

      if (!checkOutTime && /\d/.test(line) && /(?:check-?out|checkout|퇴실)/i.test(line)) {
        const m = line.match(
          /(?:check-?out|checkout|퇴실)(?:\s+before|\s+by|\s+is|\s*:)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i,
        );
        if (m) checkOutTime = normalizeUnicodeSpaces(m[1]);
      }

      if (/(children|infants?|어린이|유아|儿童|婴儿)/i.test(line) && line.length <= 120) {
        if (!childLines.includes(line)) childLines.push(line);
      }
    }

    if (!checkOutTime && fallbackDescription) {
      const descOut = fallbackDescription
        .replace(/[\u202f\u00a0\u2009]/g, ' ')
        .match(/(?:check-?out|checkout)(?:\s+before|\s+by|\s+is|\s*:)?\s*(\d{1,2}(?::\d{2})?\s*(?:AM|PM)?)/i);
      if (descOut) checkOutTime = normalizeUnicodeSpaces(descOut[1]);
    }

    return {
      checkInTime,
      checkOutTime,
      childPolicy: childLines.join('; '),
    };
  }

  private async runPipeline(
    job: DeepJobState,
    parsed: ParsedAirbnbUrl,
    input: DeepExtractJobInput,
  ) {
    await this.closeKeptBrowser();
    const warpProxy = input.useWarpProxy ? { server: 'socks5://127.0.0.1:40000' } : undefined;
    const proxyConfig = parseProxyUrl(input.proxyUrl) || warpProxy || this.appConfig.proxy;

    this.pushLog(job, '[Browser Tab 2] Đang mở cửa sổ Chrome for Testing (headless: false)...', 'step');
    let launched: { context: BrowserContext; browser: Browser; channelUsed: string };
    try {
      launched = await this.browserService.launchTab2ChromeForTesting({
        proxyOverride: proxyConfig,
      });
    } catch (err: any) {
      this.pushLog(
        job,
        `[Browser Tab 2] Lỗi mở Chrome for Testing: ${err?.message || err}`,
        'error',
      );
      throw err;
    }

    let browser: Browser = launched.browser;
    let context: BrowserContext = launched.context;
    job.activeBrowser = browser;

    let manualPaused = false;
    let pauseUntilMs = 0;
    let pauseReason = '';
    let isSwitchingContext = false;
    let contextGeneration = 0;
    let skipVersion = 0;
    let needsReset = false;

    const emitPause = () => {
      let status: 'running' | 'paused' | 'paused_503' = 'running';
      let countdownSeconds = 0;
      if (manualPaused) status = 'paused';
      else if (Date.now() < pauseUntilMs) {
        status = 'paused_503';
        countdownSeconds = Math.max(1, Math.ceil((pauseUntilMs - Date.now()) / 1000));
      }
      job.pauseState = { status, countdownSeconds, reason: pauseReason || undefined };
      this.broadcast(job, 'pause_state', job.pauseState);
    };

    const waitIfPaused = async (myGen: number, mySkip?: number) => {
      while (!job.abortController.signal.aborted) {
        if (mySkip !== undefined && skipVersion !== mySkip) throw new SkipCurrentError();
        if (contextGeneration !== myGen) throw new ContextRecreatedError();
        if (isSwitchingContext || manualPaused || Date.now() < pauseUntilMs) {
          emitPause();
          await sleep(400);
          continue;
        }
        emitPause();
        break;
      }
    };

    const trigger503Cooldown = async (reason: string, myGen: number, mySkip?: number) => {
      if (Date.now() >= pauseUntilMs && !manualPaused) {
        pauseUntilMs = Date.now() + 40000;
        pauseReason = reason;
        needsReset = true;
        this.pushLog(
          job,
          `[Cảnh báo 503/Captcha] ${reason} — Tạm dừng 40s để đổi IP / giải Captcha, sau đó bấm 'Tiếp tục ngay'!`,
          'warn',
        );
        emitPause();
      }
      await waitIfPaused(myGen, mySkip);
      if (needsReset && !job.abortController.signal.aborted) {
        needsReset = false;
        await this.browserService.resetSession(context);
      }
    };

    job.handlers = {
      pause: () => {
        manualPaused = true;
        pauseUntilMs = 0;
        pauseReason = 'Tạm dừng thủ công';
        emitPause();
      },
      resume: () => {
        manualPaused = false;
        pauseUntilMs = 0;
        pauseReason = '';
        emitPause();
      },
      resetSession: async () => {
        await this.browserService.resetSession(context);
        needsReset = false;
        this.pushLog(job, '[Session Reset] Đã xóa Cookie & làm mới phiên.', 'success');
      },
      skipCurrent: () => {
        skipVersion++;
        pauseUntilMs = 0;
        pauseReason = '';
        emitPause();
      },
      updateProxy: async (newProxyUrl?: string) => {
        isSwitchingContext = true;
        try {
          await context.close().catch(() => {});
          await browser.close().catch(() => {});
          const recreated = await this.browserService.launchTab2ChromeForTesting({
            proxyOverride: parseProxyUrl(newProxyUrl),
          });
          browser = recreated.browser;
          context = recreated.context;
          job.activeBrowser = browser;
          contextGeneration++;
          manualPaused = false;
          pauseUntilMs = 0;
          pauseReason = '';
          this.pushLog(job, `[Proxy] Đã chuyển Proxy mới (${recreated.channelUsed}).`, 'success');
        } finally {
          isSwitchingContext = false;
          emitPause();
        }
      },
    };

    const extractedRooms: DeepExtractedRoom[] = [];
    const candidateMap = new Map<
      string,
      {
        listingId: string;
        lat: number | null;
        lng: number | null;
        pricePerNight: number;
        totalPrice: number;
        rating: number;
        reviewsCount: number;
      }
    >();

    let page = await context.newPage();
    await page.bringToFront().catch(() => {});
    try {
      const cdp = await context.newCDPSession(page);
      const { windowId } = await cdp.send('Browser.getWindowForTarget');
      await cdp.send('Browser.setWindowBounds', {
        windowId,
        bounds: {
          windowState: 'normal',
          left: 40,
          top: 30,
          width: 1400,
          height: 850,
        },
      });
    } catch {
      // Ignore if CDP window bounds unsupported
    }
    this.pushLog(job, '[Browser Tab 2] Đã mở cửa sổ Chrome for Testing độc lập!', 'success');
    let myGen = contextGeneration;

    try {
      // =====================================================================
      // BƯỚC 1: Quét toàn bộ danh sách trong khung bản đồ URL gốc (Single Tab)
      // =====================================================================
      this.pushProgress(job, 8, 'Bước 1/3: Đang mở URL gốc & gom danh sách phòng trong khung bản đồ...');
      let apiBlock: Blocked503Error | null = null;

      const onSearchResp = (resp: Response) => {
        try {
          const st = resp.status();
          if (st === 503 || st === 429) {
            apiBlock = new Blocked503Error(st, `HTTP ${st}`);
            return;
          }
          if (st !== 200) return;
          const u = resp.url();
          if (!u.includes('StaysSearch') && !u.includes('ExploreLayout')) return;
          void resp
            .json()
            .then((json) => {
              const items = this.pdpParser.extractSearchListingsFromJson(json, {
                locationQuery: parsed.platformLocation.cityGuess,
                checkIn: parsed.dates.checkIn,
                checkOut: parsed.dates.checkOut,
                nights: parsed.dates.nights,
              });
              for (const item of items) {
                const prev = candidateMap.get(item.listing_id);
                candidateMap.set(item.listing_id, {
                  listingId: item.listing_id,
                  lat: item.lat ?? prev?.lat ?? null,
                  lng: item.lng ?? prev?.lng ?? null,
                  pricePerNight: item.price_per_night || prev?.pricePerNight || 0,
                  totalPrice: item.total_price || prev?.totalPrice || 0,
                  rating: item.rating || prev?.rating || 0,
                  reviewsCount: item.reviews_count || prev?.reviewsCount || 0,
                });
              }
            })
            .catch(() => null);
        } catch {
          // Ignore
        }
      };

      page.on('response', onSearchResp);
      await page.goto(parsed.originalUrl, { timeout: 60000, waitUntil: 'commit' });
      await page.bringToFront().catch(() => {});
      await randomDelay(3000, 4500);

      for (let p = 1; p <= 15; p++) {
        if (job.abortController.signal.aborted) break;
        await waitIfPaused(myGen);

        if (apiBlock) {
          await trigger503Cooldown((apiBlock as Blocked503Error).reason, myGen);
          apiBlock = null;
        }
        const blk = await this.isBlockedOr503(page);
        if (blk.blocked) {
          await trigger503Cooldown(blk.reason, myGen);
          await page.reload({ timeout: 60000, waitUntil: 'commit' }).catch(() => {});
          await randomDelay(3000, 4500);
        }

        await page
          .waitForSelector('a[href*="/rooms/"], [data-testid="card-container"]', { timeout: 20000 })
          .catch(() => null);

        await this.humanBrowseScroll(page, 4);

        // Bóc tách #data-deferred-state-*
        const deferredRaw = await page
          .locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]')
          .first()
          .innerText()
          .catch(() => '');
        if (deferredRaw) {
          try {
            const deferredJson = JSON.parse(deferredRaw);
            const items = this.pdpParser.extractSearchListingsFromJson(deferredJson, {
              locationQuery: parsed.platformLocation.cityGuess,
              checkIn: parsed.dates.checkIn,
              checkOut: parsed.dates.checkOut,
              nights: parsed.dates.nights,
            });
            for (const item of items) {
              const prev = candidateMap.get(item.listing_id);
              candidateMap.set(item.listing_id, {
                listingId: item.listing_id,
                lat: item.lat ?? prev?.lat ?? null,
                lng: item.lng ?? prev?.lng ?? null,
                pricePerNight: item.price_per_night || prev?.pricePerNight || 0,
                totalPrice: item.total_price || prev?.totalPrice || 0,
                rating: item.rating || prev?.rating || 0,
                reviewsCount: item.reviews_count || prev?.reviewsCount || 0,
              });
            }
          } catch {
            // Ignore
          }
        }

        const hrefs = await page
          .locator('a[href*="/rooms/"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''))
          .catch(() => []);
        for (const h of hrefs) {
          const rid = h.split('/rooms/')[1]?.split('?')[0] || '';
          if (/^\d+$/.test(rid) && !candidateMap.has(rid)) {
            candidateMap.set(rid, {
              listingId: rid,
              lat: null,
              lng: null,
              pricePerNight: 0,
              totalPrice: 0,
              rating: 0,
              reviewsCount: 0,
            });
          }
        }

        this.pushLog(
          job,
          `[Bước 1] Trang ${p}: Đã phát hiện ${candidateMap.size} căn hộ từ URL bản đồ.`,
          'info',
        );

        const nextBtn = page
          .locator('a[aria-label="Tiếp theo"], a[aria-label="Next"], a[aria-label="下一页"], a[aria-label="다음"]')
          .first();
        if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible().catch(() => false))) {
          await nextBtn.scrollIntoViewIfNeeded().catch(() => {});
          await randomDelay(2500, 4000);
          await nextBtn.click({ timeout: 10000 }).catch(() => {});
          await randomDelay(3000, 4500);
        } else {
          break;
        }
      }
      page.off('response', onSearchResp);

      // Lọc theo khung tọa độ Bounding Box & sắp xếp cố định theo Airbnb Listing ID tăng dần
      const candidates = Array.from(candidateMap.values())
        .filter((c) => {
          if (!input.strictBoundsOnly || !parsed.mapBounds.hasBounds) return true;
          if (c.lat === null || c.lng === null) return true;
          const check = checkBoundingBox(c.lat, c.lng, parsed.mapBounds);
          return check.status === 'inside' || check.status === 'nearby';
        })
        .sort((a, b) => a.listingId.localeCompare(b.listingId));

      this.pushLog(
        job,
        `[Bước 1 Hoàn tất] Tổng tìm thấy: ${candidateMap.size} căn • Sau lọc khung bản đồ: ${candidates.length} căn (đã sắp xếp cố định theo ID).`,
        'step',
      );

      // Nạp checkpoint từ SQLite tab2_room_cache
      const cachedMap = this.db.getTab2CachedRooms(candidates.map((c) => c.listingId));
      const extractedById = new Map<string, DeepExtractedRoom>();
      const excludedOutsideIds = new Set<string>();
      for (const cand of candidates) {
        const cached = cachedMap.get(cand.listingId);
        if (cached && cached.isComplete && cached.room) {
          extractedById.set(cand.listingId, cached.room as DeepExtractedRoom);
        }
      }
      if (extractedById.size > 0) {
        this.pushLog(
          job,
          `[Checkpoint SQLite] Đã khôi phục ${extractedById.size}/${candidates.length} căn hoàn chỉnh từ cache.`,
          'info',
        );
      }

      // =====================================================================
      // BƯỚC 2: Đọc sâu 100% chi tiết từng căn hộ + Auto-Retry tối đa 3 vòng
      // =====================================================================
      for (let round = 1; round <= 3; round++) {
        if (job.abortController.signal.aborted) break;
        const pendingCandidates = candidates.filter(
          (c) => !extractedById.has(c.listingId) && !excludedOutsideIds.has(c.listingId),
        );
        if (pendingCandidates.length === 0) break;

        if (round > 1) {
          this.pushLog(
            job,
            `[Auto-Retry Vòng ${round}/3] Đang chạy bù ${pendingCandidates.length} căn còn thiếu để đạt 100%...`,
            'step',
          );
        }

        for (let i = 0; i < pendingCandidates.length; i++) {
          if (job.abortController.signal.aborted) break;
          const cand = pendingCandidates[i];
          const mySkip = skipVersion;

        for (let attempt = 0; attempt < 3; attempt++) {
          if (job.abortController.signal.aborted) break;
          try {
            await waitIfPaused(myGen, mySkip);
            const pct = 20 + Math.round(((i + 1) / Math.max(1, candidates.length)) * 65);
            this.pushProgress(
              job,
              pct,
              `Bước 2/3: Đang đọc sâu căn #${cand.listingId} (${i + 1}/${candidates.length})...`,
            );

            const pdpBase = parsed.platformLocation.origin.includes('airbnb.cn')
              ? 'https://www.airbnb.com'
              : parsed.platformLocation.origin;
            const roomUrl =
              parsed.dates.checkIn && parsed.dates.checkOut
                ? `${pdpBase}/rooms/${cand.listingId}?check_in=${parsed.dates.checkIn}&check_out=${parsed.dates.checkOut}&locale=en`
                : `${pdpBase}/rooms/${cand.listingId}?locale=en`;

            const pdpJsonRoots: unknown[] = [];
            let bookItData: any = null;
            let pdpBlock: Blocked503Error | null = null;

            const onPdpResp = (resp: Response) => {
              try {
                const st = resp.status();
                if (st === 503 || st === 429) {
                  pdpBlock = new Blocked503Error(st, `HTTP ${st} PDP`);
                  return;
                }
                if (st !== 200) return;
                const rUrl = resp.url();
                if (rUrl.includes('StaysPdpBookItQuery')) {
                  void resp.json().then((j) => { bookItData = j; }).catch(() => null);
                } else if (
                  rUrl.includes('StaysPdpSections') ||
                  rUrl.includes('AMENITIES_DEFAULT') ||
                  rUrl.includes('HOUSE_RULES') ||
                  rUrl.includes('LOCATION_DEFAULT') ||
                  rUrl.includes('PHOTO_TOUR')
                ) {
                  void resp
                    .json()
                    .then((j) => {
                      if (j) pdpJsonRoots.push(j);
                    })
                    .catch(() => null);
                }
              } catch {
                // Ignore
              }
            };

            page.on('response', onPdpResp);
            try {
              const nav = await page.goto(roomUrl, { timeout: 60000, waitUntil: 'commit' });
              await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => {});
              await randomDelay(4000, 5500);
              if (pdpBlock) throw pdpBlock;
              const blk = await this.isBlockedOr503(page, nav);
              if (blk.blocked) throw new Blocked503Error(blk.status, blk.reason);

              await page.waitForSelector('h1', { timeout: 15000 }).catch(() => null);
              await this.humanBrowseScroll(page, 4);

              // Đọc #data-deferred-state-* (niobeMinimalClientData)
              const deferredRawList = await page
                .locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]')
                .allInnerTexts()
                .catch(() => []);
              for (const rawStr of deferredRawList) {
                try {
                  if (rawStr) pdpJsonRoots.push(JSON.parse(rawStr));
                } catch {
                  // Ignore
                }
              }

              // 1. Bấm mở rộng "Show more" ở phần Giới thiệu (Description)
              let expandedDescription = '';
              const descShowMoreBtn = page
                .locator('[data-section-id="DESCRIPTION_DEFAULT"] button:has-text("Show more"), [data-section-id="DESCRIPTION_DEFAULT"] button:has-text("Hiển thị thêm"), [data-section-id="DESCRIPTION_DEFAULT"] button:has-text("显示更多")')
                .first();
              if ((await descShowMoreBtn.count()) > 0 && (await descShowMoreBtn.isVisible().catch(() => false))) {
                await descShowMoreBtn.click({ timeout: 3000 }).catch(() => {});
                await sleep(1500);
                expandedDescription = await page
                  .locator('[role="dialog"]')
                  .first()
                  .innerText({ timeout: 2000 })
                  .catch(() => '');
                await page.keyboard.press('Escape').catch(() => {});
                await sleep(500);
              }

              // 2. Bấm mở rộng "Show all amenities" & đọc trực tiếp các mục có sẵn trong modal (loại bỏ Not included / gạch ngang)
              const modalAvailableAmenities: string[] = [];
              const showAllAmenitiesBtn = page
                .locator('[data-section-id="AMENITIES_DEFAULT"] button:has-text("Show all"), button:has-text("Hiển thị tất cả"), button:has-text("显示全部")')
                .first();
              if ((await showAllAmenitiesBtn.count()) > 0 && (await showAllAmenitiesBtn.isVisible().catch(() => false))) {
                await showAllAmenitiesBtn.click({ timeout: 3000 }).catch(() => {});
                await sleep(2000);
                const scrapedModalItems = await page
                  .locator('[role="dialog"]')
                  .first()
                  .evaluate((dialog) => {
                    const out: string[] = [];
                    const sections = dialog.querySelectorAll('section, div[data-section-id]');
                    const scanContainer = sections.length > 0 ? Array.from(sections) : [dialog];
                    for (const sec of scanContainer) {
                      const headingText = (sec.querySelector('h2, h3')?.textContent || '').toLowerCase();
                      if (
                        headingText.includes('not included') ||
                        headingText.includes('unavailable') ||
                        headingText.includes('không bao gồm') ||
                        headingText.includes('포함되지 않음') ||
                        headingText.includes('不包含')
                      ) {
                        continue;
                      }
                      const rows = sec.querySelectorAll('li, div[id*="row-title"]');
                      for (const r of Array.from(rows)) {
                        const style = window.getComputedStyle(r);
                        if (style.textDecorationLine.includes('line-through')) continue;
                        const txt = (r.textContent || '').trim();
                        if (
                          !txt ||
                          txt.length > 90 ||
                          /^(unavailable|not included):/i.test(txt)
                        ) {
                          continue;
                        }
                        out.push(txt);
                      }
                    }
                    return out;
                  })
                  .catch(() => []);
                for (const item of scrapedModalItems) {
                  const clean = normalizeUnicodeSpaces(item);
                  if (clean) modalAvailableAmenities.push(clean);
                }
                await page.keyboard.press('Escape').catch(() => {});
                await sleep(500);
              }

              // 3. Bấm mở rộng "Show more" ở phần Nội quy nhà (House rules)
              const rulesShowMoreBtn = page
                .locator('[data-section-id="POLICIES_DEFAULT"] button:has-text("Show more"), [data-section-id="POLICIES_DEFAULT"] button:has-text("Hiển thị thêm"), [data-section-id="POLICIES_DEFAULT"] button:has-text("显示更多")')
                .first();
              if ((await rulesShowMoreBtn.count()) > 0 && (await rulesShowMoreBtn.isVisible().catch(() => false))) {
                await rulesShowMoreBtn.click({ timeout: 3000 }).catch(() => {});
                await sleep(1500);
              }
              const modalRulesText = await page
                .locator('[role="dialog"]')
                .first()
                .innerText({ timeout: 1200 })
                .catch(() => '');
              if (modalRulesText) {
                await page.keyboard.press('Escape').catch(() => {});
                await sleep(500);
              }
              const sectionRulesText = await page
                .locator('[data-section-id="POLICIES_DEFAULT"], section:has-text("House rules")')
                .first()
                .innerText({ timeout: 2000 })
                .catch(() => '');
              const houseRulesText = normalizeUnicodeSpaces(`${sectionRulesText}\n${modalRulesText}`);

              // 4. Bấm mở Thư viện ảnh (Show all photos) để kích hoạt JSON PHOTO_TOUR_SCROLLABLE_MODAL
              const showPhotosBtn = page
                .locator('button:has-text("Show all photos"), button:has-text("Hiển thị tất cả ảnh"), button:has-text("显示所有照片")')
                .first();
              if ((await showPhotosBtn.count()) > 0 && (await showPhotosBtn.isVisible().catch(() => false))) {
                await showPhotosBtn.click({ timeout: 3000 }).catch(() => {});
                await sleep(1800);
                await page.keyboard.press('Escape').catch(() => {});
                await sleep(500);
              }

              // Bóc tách dữ liệu PDP chuẩn + JSON gốc StaysPdpSections
              const structured = extractStructuredPdpFromJson(pdpJsonRoots);
              const baseRecord = await this.pdpParser.extractFromPage({
                page,
                listingId: cand.listingId,
                url: roomUrl,
                locationQuery: parsed.platformLocation.cityGuess,
                checkIn: parsed.dates.checkIn,
                checkOut: parsed.dates.checkOut,
                nights: parsed.dates.nights,
                bookItData,
              });

              const finalLat = structured.lat ?? baseRecord?.lat ?? cand.lat;
              const finalLng = structured.lng ?? baseRecord?.lng ?? cand.lng;
              const boundsCheck = checkBoundingBox(finalLat, finalLng, parsed.mapBounds);
              if (
                input.strictBoundsOnly &&
                parsed.mapBounds.hasBounds &&
                boundsCheck.status === 'outside'
              ) {
                excludedOutsideIds.add(cand.listingId);
                this.pushLog(
                  job,
                  `[Lọc tọa độ] Bỏ qua căn #${cand.listingId} vì nằm ngoài khung bản đồ (${finalLat}, ${finalLng}).`,
                  'warn',
                );
                break;
              }

              const fullDescription = [
                structured.description,
                baseRecord?.description || '',
                expandedDescription,
                structured.gettingAround,
              ]
                .filter(Boolean)
                .join('\n')
                .trim();

              // CHỈ dùng danh sách tiện nghi có available: true từ JSON gốc + modal đã lọc bỏ Not included
              const strictAvailableAmenities = Array.from(
                new Set([
                  ...(structured.availableAmenities.length > 0
                    ? structured.availableAmenities
                    : baseRecord?.amenities || []),
                  ...modalAvailableAmenities,
                ]),
              );
              const flags = this.extractAmenityFlags(
                strictAvailableAmenities,
                fullDescription,
                houseRulesText,
              );
              const rulesParsed = this.parseHouseRulesDetails(houseRulesText, fullDescription);
              const finalCheckInTime = normalizeUnicodeSpaces(
                structured.checkInTime || rulesParsed.checkInTime || '',
              );
              const finalCheckOutTime = normalizeUnicodeSpaces(
                structured.checkOutTime || rulesParsed.checkOutTime || '',
              );
              const finalChildPolicy = normalizeUnicodeSpaces(
                structured.childPolicy || rulesParsed.childPolicy || '',
              );

              // Đọc tên Host chuẩn từ JSON hoặc truy cập thẳng /users/profile/{hostId} (cấm "Airbnb Host")
              const hostId = structured.hostId || baseRecord?.host_id || '';
              let hostName = isValidHostName(structured.hostName)
                ? structured.hostName
                : isValidHostName(baseRecord?.host_name || '')
                  ? normalizeUnicodeSpaces(baseRecord?.host_name || '')
                  : '';
              let hostTotalListings = 1;

              if (hostId && !hostName) {
                const profileUrl = `https://www.airbnb.com/users/profile/${hostId}?locale=en`;
                await page.goto(profileUrl, { timeout: 45000, waitUntil: 'commit' }).catch(() => null);
                await randomDelay(3000, 4000);
                const h1Host = await page
                  .locator('h1')
                  .first()
                  .innerText({ timeout: 3000 })
                  .catch(() => '');
                const cleanHostH1 = normalizeUnicodeSpaces(h1Host)
                  .replace(/^(Hi,\s*I['’]m|I['’]m|About)\s+/i, '')
                  .trim();
                if (isValidHostName(cleanHostH1)) {
                  hostName = cleanHostH1;
                }
              }
              if (hostId) {
                const hostShowUrl = `https://www.airbnb.com/users/show/${hostId}?locale=en`;
                const hostRoomIds = await this.hostParser
                  .collectHostRoomIds(page, hostShowUrl)
                  .catch(() => []);
                if (hostRoomIds.length > 0) hostTotalListings = hostRoomIds.length;
                if (!hostName) {
                  const h1Show = await page
                    .locator('h1')
                    .first()
                    .innerText({ timeout: 2000 })
                    .catch(() => '');
                  const cleanShow = normalizeUnicodeSpaces(h1Show)
                    .replace(/^(Hi,\s*I['’]m|I['’]m|About)\s+/i, '')
                    .trim();
                  if (isValidHostName(cleanShow)) hostName = cleanShow;
                }
              }

              const rawTitle = structured.title || baseRecord?.title || `Room ${cand.listingId}`;
              const candidateBuilding =
                (!isBlacklistedBuildingName(baseRecord?.building_name || '')
                  ? baseRecord?.building_name || ''
                  : '') ||
                extractBuildingNameFromText(
                  `${rawTitle}\n${baseRecord?.subtitle || ''}\n${fullDescription}\n${hostName}`,
                );

              // Lấy 100% ảnh từ JSON gốc StaysPdpSections (PHOTO_TOUR_SCROLLABLE_MODAL / HERO_DEFAULT)
              const finalPhotos = [...structured.photoUrls];

              const city = parsed.platformLocation.cityGuess || 'Seoul';
              const country = parsed.platformLocation.countryGuess || 'South Korea';
              const address = structured.locationSubtitle || baseRecord?.location_text || '';
              const district = this.extractDistrict(
                address,
                structured.locationSubtitle,
                fullDescription,
              );

              const bedrooms = structured.bedrooms || baseRecord?.bedrooms || 0;
              const beds = Math.max(1, structured.beds || baseRecord?.beds || 1);
              const bathrooms = Math.max(1, structured.bathrooms || baseRecord?.bathrooms || 1);
              const maxPeople = Math.max(1, structured.personCapacity || baseRecord?.guests || 2);

              const deepRoom: DeepExtractedRoom = {
                listingId: cand.listingId,
                url: roomUrl,
                title: rawTitle,
                subtitle: baseRecord?.subtitle || '',
                description: fullDescription,
                address,
                district,
                city,
                country,
                lat: finalLat,
                lng: finalLng,
                boundsStatus: boundsCheck.status,
                boundsLabel: boundsCheck.label,
                buildingName: candidateBuilding,
                supplierApartmentCode: this.extractSupplierAptCode(
                  rawTitle,
                  `${fullDescription}\n${houseRulesText}`,
                ),
                roomType: this.inferRoomType(bedrooms, rawTitle),
                bedrooms,
                beds,
                bathrooms,
                maxPeople,
                pricePerNight: baseRecord?.price_per_night || cand.pricePerNight || 0,
                totalPrice: baseRecord?.total_price || cand.totalPrice || 0,
                cleaningFee: 0,
                serviceFee: 0,
                currency: baseRecord?.currency || 'VND',
                rating: baseRecord?.rating || cand.rating || 0,
                reviewsCount: baseRecord?.reviews_count || cand.reviewsCount || 0,
                checkInTime: finalCheckInTime,
                checkOutTime: finalCheckOutTime,
                childPolicy: finalChildPolicy,
                houseRulesText,
                amenities: strictAvailableAmenities,
                amenityFlags: flags,
                photoUrls: finalPhotos,
                localPhotoDir: '',
                hostId,
                hostName: hostName || `Host-${hostId || cand.listingId}`,
                hostAirbnbLink: hostId ? `https://www.airbnb.com/users/profile/${hostId}` : '',
                hostTotalListings,
              };

              extractedById.set(cand.listingId, deepRoom);
              const isRoomComplete =
                Boolean(deepRoom.title && !/stay tuned/i.test(deepRoom.title)) &&
                isValidHostName(deepRoom.hostName);
              this.db.upsertTab2RoomCache(
                cand.listingId,
                parsed.platformLocation.placeId || parsed.platformLocation.cityGuess,
                JSON.stringify(deepRoom),
                isRoomComplete,
              );

              const currentList = candidates
                .map((c) => extractedById.get(c.listingId))
                .filter((r): r is DeepExtractedRoom => Boolean(r));
              job.preview = buildSevenNightsPreview(
                currentList,
                city,
                input.downloadPhotos ? 'Photos' : '',
              );
              this.broadcast(job, 'preview', job.preview);
              this.pushLog(
                job,
                `[Vòng ${round} | ${i + 1}/${pendingCandidates.length}] Đã trích xuất #${cand.listingId} ("${deepRoom.title.slice(0, 40)}...") | ${deepRoom.photoUrls.length} ảnh JSON | ${boundsCheck.label}`,
                'success',
              );
              break;
            } finally {
              page.off('response', onPdpResp);
            }
          } catch (err: any) {
            if (err instanceof SkipCurrentError) {
              this.pushLog(job, `[Bỏ qua] Đã bỏ qua căn #${cand.listingId} theo lệnh người dùng.`, 'warn');
              break;
            }
            if (err instanceof ContextRecreatedError) {
              await page.close().catch(() => {});
              myGen = contextGeneration;
              page = await this.browserService.newHumanPage(context);
              attempt--;
              continue;
            }
            if (err instanceof Blocked503Error) {
              await trigger503Cooldown(err.reason, myGen, mySkip);
              continue;
            }
            this.pushLog(job, `[Lỗi] Căn #${cand.listingId}: ${err?.message || err}`, 'warn');
            break;
          }
        }
      }
      } // end retry rounds

      extractedRooms.push(
        ...candidates
          .map((c) => extractedById.get(c.listingId))
          .filter((r): r is DeepExtractedRoom => Boolean(r)),
      );
      this.pushLog(
        job,
        `[Airbnb JSON] Đã lấy chuẩn ${extractedRooms.length}/${candidates.length} căn, thông số phòng, 9 tiện nghi và 100% URL ảnh.`,
        'step',
      );
    } finally {
      if (input.keepBrowserOpen && !job.isStopRequested) {
        this.keptBrowser = browser;
        this.keptContext = context;
        await page.goto(parsed.originalUrl, { timeout: 30000, waitUntil: 'commit' }).catch(() => {});
        await page.bringToFront().catch(() => {});
        this.pushLog(
          job,
          '[Chrome Kiểm Tra Trực Tiếp] Giữ nguyên cửa sổ Chrome for Testing mở để bạn đối chiếu trực tiếp!',
          'step',
        );
      } else {
        await this.browserService.forceClose();
        await context.close().catch(() => {});
        await browser?.close().catch(() => {});
      }
      job.activeBrowser = undefined;
    }

    // =======================================================================
    // BƯỚC 2.5: OpenAI ChatGPT (gpt-4o / gpt-4o-mini) Enrichment & Fallback
    // =======================================================================
    let aiCopyPrompt = '';
    if (extractedRooms.length > 0) {
      const { provider, apiKey, model } = this.aiEnrichment.resolveOpenAiConfig(
        input.aiProvider,
        input.aiApiKey,
        input.aiModel,
        input.enableAiEnrichment !== false,
      );

      // Tính tâm tọa độ & Reverse Geocoding thô làm ngữ cảnh cho AI
      const validCoordRooms = extractedRooms.filter((r) => r.lat !== null && r.lng !== null);
      const centerLat =
        validCoordRooms.length > 0
          ? validCoordRooms.reduce((s, r) => s + (r.lat || 0), 0) / validCoordRooms.length
          : null;
      const centerLng =
        validCoordRooms.length > 0
          ? validCoordRooms.reduce((s, r) => s + (r.lng || 0), 0) / validCoordRooms.length
          : null;
      const baseReverseGeo = await reverseGeocodeCoords(centerLat, centerLng);

      aiCopyPrompt = this.aiEnrichment.buildManualChatGptPrompt({
        rooms: extractedRooms,
        reverseGeoAddress: baseReverseGeo?.address,
        centerLat,
        centerLng,
      });

      if (provider === 'openai' && apiKey) {
        this.pushProgress(
          job,
          88,
          `Bước 2.5/3: Đang chuẩn hóa dữ liệu bằng OpenAI ChatGPT (${model})...`,
        );

        const aiBuilding = await this.aiEnrichment.enrichBuildingCluster({
          apiKey,
          model,
          rooms: extractedRooms,
          reverseGeoAddress: baseReverseGeo?.address,
          centerLat,
          centerLng,
        });

        const aiRoomsMap = await this.aiEnrichment.enrichRoomsBatch({
          apiKey,
          model,
          rooms: extractedRooms,
        });

        for (const r of extractedRooms) {
          if (aiBuilding) {
            if (aiBuilding.building_name && !isBlacklistedBuildingName(aiBuilding.building_name)) {
              r.buildingName = aiBuilding.building_name;
            }
            if (aiBuilding.address) r.address = aiBuilding.address;
            if (aiBuilding.district) r.district = aiBuilding.district;
            if (aiBuilding.city) r.city = aiBuilding.city;
            if (aiBuilding.country) r.country = aiBuilding.country;
            if (aiBuilding.swimming_pool) r.amenityFlags.swimmingPool = aiBuilding.swimming_pool;
            if (aiBuilding.gym) r.amenityFlags.gym = aiBuilding.gym;
            if (aiBuilding.gym_fee) r.amenityFlags.gymFee = aiBuilding.gym_fee;
            if (aiBuilding.parking) r.amenityFlags.parking = aiBuilding.parking;
          }
          const aiRoom = aiRoomsMap.get(r.listingId);
          if (aiRoom) {
            if (aiRoom.supplier_apartment_code && !r.supplierApartmentCode) {
              r.supplierApartmentCode = aiRoom.supplier_apartment_code;
            }
            if (aiRoom.child_policy && !r.childPolicy) {
              r.childPolicy = aiRoom.child_policy;
            }
            if (aiRoom.check_in_time && !r.checkInTime) {
              r.checkInTime = normalizeUnicodeSpaces(aiRoom.check_in_time);
            }
            if (aiRoom.check_out_time && !r.checkOutTime) {
              r.checkOutTime = normalizeUnicodeSpaces(aiRoom.check_out_time);
            }
            if (aiRoom.clean_host_name && isValidHostName(aiRoom.clean_host_name)) {
              r.hostName = aiRoom.clean_host_name;
            }
            if (aiRoom.room_type_verified) {
              r.roomType = aiRoom.room_type_verified;
            }
          }
        }

        this.pushLog(
          job,
          `[AI Enrichment - ChatGPT ${model}] Đã chuẩn hóa tòa nhà: ${aiBuilding?.building_name || extractedRooms[0].buildingName || 'N/A'} | Gym fee: ${aiBuilding?.gym_fee || 'N/A'} | Đã bổ sung Child policy & Mã căn.`,
          'success',
        );
      } else {
        // Fallback Regex + Nominatim khi không dùng AI / chưa có API Key
        const buildingCounts = new Map<string, number>();
        for (const r of extractedRooms) {
          if (r.buildingName && !isBlacklistedBuildingName(r.buildingName)) {
            buildingCounts.set(r.buildingName, (buildingCounts.get(r.buildingName) || 0) + 1);
          }
        }
        let dominantBuilding = '';
        let maxCount = 0;
        for (const [bName, cnt] of buildingCounts.entries()) {
          if (cnt > maxCount) {
            dominantBuilding = bName;
            maxCount = cnt;
          }
        }

        if (dominantBuilding) {
          const firstDist = extractedRooms.find((r) => r.district)?.district || '';
          const firstCity = extractedRooms[0].city || 'Seoul';
          const addrHit = await searchAddressByBuildingName(dominantBuilding, firstDist, firstCity);
          for (const r of extractedRooms) {
            if (!r.buildingName || isBlacklistedBuildingName(r.buildingName)) {
              r.buildingName = dominantBuilding;
            }
            if (addrHit?.address) r.address = addrHit.address;
            if (addrHit?.district && !r.district) r.district = addrHit.district;
            if (addrHit?.city) r.city = addrHit.city;
            if (addrHit?.country) r.country = addrHit.country;
          }
          this.pushLog(
            job,
            `[Fallback Parser] Chốt tên tòa nhà: "${dominantBuilding}"${addrHit?.address ? ` | Địa chỉ: ${addrHit.address}` : ''}`,
            'step',
          );
        } else {
          for (const r of extractedRooms) {
            if (!r.address || r.address === r.city || !r.district || !r.buildingName) {
              const rev = await reverseGeocodeCoords(r.lat, r.lng);
              if (rev?.buildingName && !r.buildingName) r.buildingName = rev.buildingName;
              if (rev?.address && (!r.address || r.address === r.city)) r.address = rev.address;
              if (rev?.district && !r.district) r.district = rev.district;
            }
          }
        }
      }
    }

    // =======================================================================
    // BƯỚC 3: Đóng gói Bundle (7Nights Global.xlsx + Raw + Photos + .zip)
    // =======================================================================
    this.pushProgress(job, 92, 'Bước 3/3: Đang xuất Excel 7Nights Global, tải ảnh & đóng gói .zip...');
    const bundle = await exportSevenNightsBundle({
      outputDir: this.appConfig.outputDir,
      locationLabel: parsed.platformLocation.cityGuess || 'Airbnb',
      rooms: extractedRooms,
      downloadPhotos: input.downloadPhotos,
      onLog: (m, l) => this.pushLog(job, m, l),
    });

    const result: DeepExtractBundleResult = {
      ...bundle,
      totalFound: candidateMap.size,
      totalExtracted: extractedRooms.length,
      stoppedEarly: job.isStopRequested,
      browserKeptOpen: Boolean(input.keepBrowserOpen && !job.isStopRequested),
      aiCopyPrompt,
    };

    job.result = result;
    job.preview = bundle.preview;
    job.status = job.isStopRequested ? 'stopped' : 'completed';
    this.pushProgress(job, 100, `Hoàn tất! Đã xuất ${bundle.sevenNightsExcelFile} & ${bundle.zipFileName}`);
    this.broadcast(job, job.isStopRequested ? 'stopped' : 'done', {
      status: job.status,
      result,
    });
  }
}
