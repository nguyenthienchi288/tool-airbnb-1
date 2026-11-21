import { ConflictException, Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { sleep } from '../../common/helpers';
import { ProxyConfig } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
import { AIRBNB_BASE_URL, DEFAULT_USER_AGENT } from '../../config/constants';

const BLOCKED_TRACKER_DOMAINS = [
  'doubleclick.net',
  'googlesyndication.com',
  'google-analytics.com',
  'googletagmanager.com',
  'connect.facebook.net',
  'facebook.com',
  'analytics.tiktok.com',
  'sentry.io',
  'braze.com',
  'forter.com',
];

const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font']);

@Injectable()
export class BrowserService {
  private activeBrowser: Browser | null = null;
  private activeContext: BrowserContext | null = null;
  private setupContext: BrowserContext | null = null;

  constructor(private readonly appConfig: AppConfigService) {}

  async forceClose(): Promise<void> {
    const ctx = this.activeContext;
    const browser = this.activeBrowser;
    this.activeContext = null;
    this.activeBrowser = null;
    if (ctx) {
      await ctx.close().catch(() => {});
    }
    if (browser) {
      await browser.close().catch(() => {});
    }
  }

  private async closeSetupContext(): Promise<void> {
    const ctx = this.setupContext;
    this.setupContext = null;
    if (ctx) {
      await ctx.close().catch(() => {});
    }
  }

  private async configureStealthAndRouting(
    context: BrowserContext,
    enableResourceBlocking = true,
  ): Promise<void> {
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    if (enableResourceBlocking) {
      await context.route('**/*', (route) => {
        const req = route.request();
        if (BLOCKED_RESOURCE_TYPES.has(req.resourceType())) {
          return route.abort();
        }
        const url = req.url().toLowerCase();
        if (BLOCKED_TRACKER_DOMAINS.some((domain) => url.includes(domain))) {
          return route.abort();
        }
        return route.continue();
      });
    }
  }

  /**
   * Khởi chạy Persistent Browser Context tại ./data/chrome_vpn_profile
   * (ưu tiên Google Chrome cài sẵn trên Windows, bật Extension để giữ vĩnh viễn VPN Extension).
   */
  async launchPersistentBrowserContext(options?: {
    proxyOverride?: ProxyConfig;
    disableEnvProxy?: boolean;
    humanLikeMode?: boolean;
    enableResourceBlocking?: boolean;
    isSetupMode?: boolean;
  }): Promise<{ context: BrowserContext; browser: Browser | null; channelUsed: string }> {
    const profileDir = this.appConfig.chromeProfileDir;
    if (!fs.existsSync(profileDir)) {
      fs.mkdirSync(profileDir, { recursive: true });
    }

    if (!options?.isSetupMode) {
      await this.closeSetupContext();
    }

    // Giải phóng khóa Profile nếu bị treo từ lần chạy trước
    if (!this.activeContext && !this.setupContext) {
      for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
        const lockPath = path.join(profileDir, lockFile);
        if (fs.existsSync(lockPath)) {
          try {
            fs.unlinkSync(lockPath);
          } catch {
            // Ignore
          }
        }
      }
    }

    const proxy = options?.disableEnvProxy
      ? options.proxyOverride
      : options?.proxyOverride || this.appConfig.proxy;
    const humanLike = options?.humanLikeMode !== false;
    const headless = humanLike ? false : this.appConfig.headless;

    const baseOptions = {
      headless,
      slowMo: humanLike ? 30 : this.appConfig.slowMo,
      viewport: { width: 1366, height: 768 },
      locale: 'vi-VN',
      timezoneId: 'Asia/Ho_Chi_Minh',
      userAgent: DEFAULT_USER_AGENT,
      ignoreDefaultArgs: ['--disable-extensions'],
      args: [
        '--start-maximized',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            },
          }
        : {}),
    };

    const attempts: Array<{ label: string; channel?: 'chrome' | 'msedge' }> = [
      { label: 'Google Chrome (Persistent VPN Profile)', channel: 'chrome' },
      { label: 'Microsoft Edge (Persistent VPN Profile)', channel: 'msedge' },
      { label: 'Playwright Chromium (Persistent VPN Profile)' },
    ];

    let lastError: any = null;
    for (const attempt of attempts) {
      try {
        const context = await chromium.launchPersistentContext(profileDir, {
          ...baseOptions,
          ...(attempt.channel ? { channel: attempt.channel } : {}),
        });
        await this.configureStealthAndRouting(
          context,
          options?.enableResourceBlocking !== false,
        );
        const browser = context.browser();
        if (!options?.isSetupMode) {
          this.activeContext = context;
          this.activeBrowser = browser;
        }
        return { context, browser, channelUsed: attempt.label };
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Không thể khởi chạy trình duyệt Persistent Profile (Chrome/Edge/Chromium): ${lastError?.message || lastError}`,
    );
  }

  /**
   * Mở Chrome ở chế độ cài đặt/bật VPN Extension trước khi chạy (không chặn ảnh/CSS).
   */
  async openSetupBrowser(proxyOverride?: ProxyConfig): Promise<{
    channelUsed: string;
    profileDir: string;
  }> {
    if (this.activeContext) {
      throw new ConflictException(
        'Đang có tiến trình thu thập chạy trên Chrome Profile. Vui lòng dừng tiến trình trước khi mở chế độ cài VPN.',
      );
    }

    await this.closeSetupContext();

    const { context, channelUsed } = await this.launchPersistentBrowserContext({
      proxyOverride,
      disableEnvProxy: Boolean(proxyOverride),
      humanLikeMode: true,
      enableResourceBlocking: false,
      isSetupMode: true,
    });

    this.setupContext = context;
    context.on('close', () => {
      if (this.setupContext === context) {
        this.setupContext = null;
      }
    });

    const pages = context.pages();
    const storePage = pages[0] || (await context.newPage());
    await storePage
      .goto('https://chromewebstore.google.com/', { timeout: 30000, waitUntil: 'commit' })
      .catch(() => {});

    const tracePage = await context.newPage().catch(() => null);
    if (tracePage) {
      await tracePage
        .goto('https://1.1.1.1/cdn-cgi/trace', { timeout: 20000, waitUntil: 'commit' })
        .catch(() => {});
    }

    return {
      channelUsed,
      profileDir: this.appConfig.chromeProfileDir,
    };
  }

  async newHumanPage(context: BrowserContext): Promise<Page> {
    return context.newPage();
  }

  /**
   * Mở trực tiếp "Chrome for Testing" (Playwright Chromium độc lập) cho Tab 2,
   * không dùng channel: 'chrome' và không dùng chung User Data Dir để luôn hiện icon riêng trên Taskbar Windows.
   */
  async launchTab2ChromeForTesting(options?: {
    proxyOverride?: ProxyConfig;
  }): Promise<{ context: BrowserContext; browser: Browser; channelUsed: string }> {
    const proxy = options?.proxyOverride || this.appConfig.proxy;
    const browser = await chromium.launch({
      headless: false,
      slowMo: 35,
      args: [
        '--start-maximized',
        '--window-position=50,40',
        '--window-size=1366,820',
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
      ],
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            },
          }
        : {}),
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 820 },
      locale: 'en-US',
      timezoneId: 'Asia/Seoul',
      userAgent: DEFAULT_USER_AGENT,
    });
    await this.configureStealthAndRouting(context, false);
    return {
      context,
      browser,
      channelUsed: 'Chrome for Testing (Playwright Chromium Độc Lập)',
    };
  }

  /**
   * Mở trình duyệt độc lập có giao diện (headless: false) dành riêng cho Tab 2.
   * Ưu tiên dùng Playwright Chromium (chromium.launch) để KHÔNG BAO GIỜ bị gộp ngầm vào Chrome cá nhân,
   * ép tọa độ hiển thị --window-position=80,50 --window-size=1366,820 ngay trên màn hình chính.
   */
  async launchTab2HeadfulBrowser(options?: {
    proxyOverride?: ProxyConfig;
  }): Promise<{ context: BrowserContext; browser: Browser | null; channelUsed: string }> {
    const proxy = options?.proxyOverride || this.appConfig.proxy;
    const windowArgs = [
      '--window-position=80,50',
      '--window-size=1366,820',
      '--new-window',
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ];

    const proxyOpt = proxy
      ? {
          proxy: {
            server: proxy.server,
            username: proxy.username,
            password: proxy.password,
          },
        }
      : {};

    let lastError: any = null;

    // Lựa chọn số 1: Playwright Chromium độc lập (không gộp process Chrome đang mở)
    try {
      const browser = await chromium.launch({
        headless: false,
        slowMo: 35,
        args: windowArgs,
        ...proxyOpt,
      });
      const context = await browser.newContext({
        viewport: { width: 1366, height: 820 },
        locale: 'en-US',
        timezoneId: 'Asia/Seoul',
        userAgent: DEFAULT_USER_AGENT,
      });
      await this.configureStealthAndRouting(context, false);
      return {
        context,
        browser,
        channelUsed: 'Playwright Chromium Độc Lập (headless: false, 80,50)',
      };
    } catch (err) {
      lastError = err;
    }

    // Fallback: Edge hoặc Chrome với --new-window & thư mục --user-data-dir cô lập
    const isolatedDir = path.join(
      path.dirname(this.appConfig.chromeProfileDir),
      'chrome_tab2_isolated',
    );
    if (!fs.existsSync(isolatedDir)) {
      fs.mkdirSync(isolatedDir, { recursive: true });
    }
    for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
      const lockPath = path.join(isolatedDir, lockFile);
      if (fs.existsSync(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Ignore
        }
      }
    }

    const fallbackAttempts: Array<{ label: string; channel: 'msedge' | 'chrome' }> = [
      { label: 'Microsoft Edge Isolated (headless: false)', channel: 'msedge' },
      { label: 'Google Chrome Isolated (headless: false)', channel: 'chrome' },
    ];

    for (const attempt of fallbackAttempts) {
      try {
        const context = await chromium.launchPersistentContext(isolatedDir, {
          headless: false,
          slowMo: 35,
          channel: attempt.channel,
          viewport: { width: 1366, height: 820 },
          locale: 'en-US',
          timezoneId: 'Asia/Seoul',
          userAgent: DEFAULT_USER_AGENT,
          ignoreDefaultArgs: ['--disable-extensions'],
          args: windowArgs,
          ...proxyOpt,
        });
        await this.configureStealthAndRouting(context, false);
        const browser = context.browser();
        return { context, browser, channelUsed: attempt.label };
      } catch (err) {
        lastError = err;
      }
    }

    throw new Error(
      `Không thể mở cửa sổ trình duyệt độc lập (headless: false): ${lastError?.message || lastError}`,
    );
  }

  /**
   * Xóa toàn bộ Cookie/Storage của phiên hiện tại và ghé nhẹ trang chủ Airbnb
   * để lấy cookie phiên mới sạch sẽ (tránh dấu vết _airbed_session_id bị gắn cờ 503).
   */
  async resetSession(context: BrowserContext): Promise<void> {
    await context.clearCookies().catch(() => {});
    for (const p of context.pages()) {
      await p
        .evaluate(() => {
          try {
            localStorage.clear();
            sessionStorage.clear();
          } catch {
            // Ignore cross-origin / about:blank
          }
        })
        .catch(() => {});
    }

    const warmPage = await context.newPage().catch(() => null);
    if (warmPage) {
      try {
        await warmPage.goto(AIRBNB_BASE_URL, { timeout: 25000, waitUntil: 'commit' });
        await sleep(1500);
      } catch {
        // Ignore warm-up error
      } finally {
        await warmPage.close().catch(() => {});
      }
    }
  }

  /**
   * Đổi Proxy nóng giữa chừng: đóng Persistent Context cũ và khởi tạo lại
   * với Proxy mới (hoặc Direct / VPN Extension nếu proxyOverride undefined).
   */
  async recreateBrowserWithProxy(options: {
    currentContext?: BrowserContext | null;
    currentBrowser?: Browser | null;
    proxyOverride?: ProxyConfig;
    humanLikeMode?: boolean;
  }): Promise<{ browser: Browser | null; context: BrowserContext; channelUsed: string }> {
    if (options.currentContext) {
      await options.currentContext.close().catch(() => {});
    }
    if (options.currentBrowser) {
      await options.currentBrowser.close().catch(() => {});
    }
    if (this.activeContext === options.currentContext) {
      this.activeContext = null;
    }
    if (this.activeBrowser === options.currentBrowser) {
      this.activeBrowser = null;
    }

    const { context, browser, channelUsed } = await this.launchPersistentBrowserContext({
      proxyOverride: options.proxyOverride,
      disableEnvProxy: true,
      humanLikeMode: options.humanLikeMode,
    });
    return { browser, context, channelUsed };
  }

  /**
   * Kiểm tra IP, Quốc gia và trạng thái Cloudflare WARP qua https://1.1.1.1/cdn-cgi/trace
   */
  async checkIpTrace(): Promise<{
    ip: string;
    loc: string;
    warp: string;
    checkedAt: string;
  }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch('https://1.1.1.1/cdn-cgi/trace', {
        signal: controller.signal,
        headers: { 'Cache-Control': 'no-cache' },
      });
      const text = await res.text();
      const map: Record<string, string> = {};
      for (const line of text.split(/\r?\n/)) {
        const idx = line.indexOf('=');
        if (idx > 0) {
          map[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
        }
      }
      return {
        ip: map['ip'] || 'Unknown',
        loc: map['loc'] || '??',
        warp: (map['warp'] || 'off').toUpperCase(),
        checkedAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
