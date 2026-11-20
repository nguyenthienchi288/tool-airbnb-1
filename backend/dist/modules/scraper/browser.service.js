"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserService = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const playwright_1 = require("playwright");
const helpers_1 = require("../../common/helpers");
const app_config_service_1 = require("../../config/app-config.service");
const constants_1 = require("../../config/constants");
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
let BrowserService = class BrowserService {
    appConfig;
    activeBrowser = null;
    activeContext = null;
    setupContext = null;
    constructor(appConfig) {
        this.appConfig = appConfig;
    }
    async forceClose() {
        const ctx = this.activeContext;
        const browser = this.activeBrowser;
        this.activeContext = null;
        this.activeBrowser = null;
        if (ctx) {
            await ctx.close().catch(() => { });
        }
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
    async closeSetupContext() {
        const ctx = this.setupContext;
        this.setupContext = null;
        if (ctx) {
            await ctx.close().catch(() => { });
        }
    }
    async configureStealthAndRouting(context, enableResourceBlocking = true) {
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
    async launchPersistentBrowserContext(options) {
        const profileDir = this.appConfig.chromeProfileDir;
        if (!fs.existsSync(profileDir)) {
            fs.mkdirSync(profileDir, { recursive: true });
        }
        if (!options?.isSetupMode) {
            await this.closeSetupContext();
        }
        if (!this.activeContext && !this.setupContext) {
            for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
                const lockPath = path.join(profileDir, lockFile);
                if (fs.existsSync(lockPath)) {
                    try {
                        fs.unlinkSync(lockPath);
                    }
                    catch {
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
            userAgent: constants_1.DEFAULT_USER_AGENT,
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
        const attempts = [
            { label: 'Google Chrome (Persistent VPN Profile)', channel: 'chrome' },
            { label: 'Microsoft Edge (Persistent VPN Profile)', channel: 'msedge' },
            { label: 'Playwright Chromium (Persistent VPN Profile)' },
        ];
        let lastError = null;
        for (const attempt of attempts) {
            try {
                const context = await playwright_1.chromium.launchPersistentContext(profileDir, {
                    ...baseOptions,
                    ...(attempt.channel ? { channel: attempt.channel } : {}),
                });
                await this.configureStealthAndRouting(context, options?.enableResourceBlocking !== false);
                const browser = context.browser();
                if (!options?.isSetupMode) {
                    this.activeContext = context;
                    this.activeBrowser = browser;
                }
                return { context, browser, channelUsed: attempt.label };
            }
            catch (err) {
                lastError = err;
            }
        }
        throw new Error(`Không thể khởi chạy trình duyệt Persistent Profile (Chrome/Edge/Chromium): ${lastError?.message || lastError}`);
    }
    async openSetupBrowser(proxyOverride) {
        if (this.activeContext) {
            throw new common_1.ConflictException('Đang có tiến trình thu thập chạy trên Chrome Profile. Vui lòng dừng tiến trình trước khi mở chế độ cài VPN.');
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
            .catch(() => { });
        const tracePage = await context.newPage().catch(() => null);
        if (tracePage) {
            await tracePage
                .goto('https://1.1.1.1/cdn-cgi/trace', { timeout: 20000, waitUntil: 'commit' })
                .catch(() => { });
        }
        return {
            channelUsed,
            profileDir: this.appConfig.chromeProfileDir,
        };
    }
    async newHumanPage(context) {
        return context.newPage();
    }
    async launchTab2ChromeForTesting(options) {
        const proxy = options?.proxyOverride || this.appConfig.proxy;
        const browser = await playwright_1.chromium.launch({
            headless: false,
            slowMo: 35,
            args: [
                '--start-maximized',
                '--window-position=50,40',
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
            viewport: null,
            locale: 'en-US',
            timezoneId: 'Asia/Seoul',
            userAgent: constants_1.DEFAULT_USER_AGENT,
        });
        await this.configureStealthAndRouting(context, false);
        return {
            context,
            browser,
            channelUsed: 'Chrome for Testing (Playwright Chromium Độc Lập)',
        };
    }
    async launchTab2HeadfulBrowser(options) {
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
        let lastError = null;
        try {
            const browser = await playwright_1.chromium.launch({
                headless: false,
                slowMo: 35,
                args: windowArgs,
                ...proxyOpt,
            });
            const context = await browser.newContext({
                viewport: { width: 1366, height: 820 },
                locale: 'en-US',
                timezoneId: 'Asia/Seoul',
                userAgent: constants_1.DEFAULT_USER_AGENT,
            });
            await this.configureStealthAndRouting(context, false);
            return {
                context,
                browser,
                channelUsed: 'Playwright Chromium Độc Lập (headless: false, 80,50)',
            };
        }
        catch (err) {
            lastError = err;
        }
        const isolatedDir = path.join(path.dirname(this.appConfig.chromeProfileDir), 'chrome_tab2_isolated');
        if (!fs.existsSync(isolatedDir)) {
            fs.mkdirSync(isolatedDir, { recursive: true });
        }
        for (const lockFile of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
            const lockPath = path.join(isolatedDir, lockFile);
            if (fs.existsSync(lockPath)) {
                try {
                    fs.unlinkSync(lockPath);
                }
                catch {
                }
            }
        }
        const fallbackAttempts = [
            { label: 'Microsoft Edge Isolated (headless: false)', channel: 'msedge' },
            { label: 'Google Chrome Isolated (headless: false)', channel: 'chrome' },
        ];
        for (const attempt of fallbackAttempts) {
            try {
                const context = await playwright_1.chromium.launchPersistentContext(isolatedDir, {
                    headless: false,
                    slowMo: 35,
                    channel: attempt.channel,
                    viewport: { width: 1366, height: 820 },
                    locale: 'en-US',
                    timezoneId: 'Asia/Seoul',
                    userAgent: constants_1.DEFAULT_USER_AGENT,
                    ignoreDefaultArgs: ['--disable-extensions'],
                    args: windowArgs,
                    ...proxyOpt,
                });
                await this.configureStealthAndRouting(context, false);
                const browser = context.browser();
                return { context, browser, channelUsed: attempt.label };
            }
            catch (err) {
                lastError = err;
            }
        }
        throw new Error(`Không thể mở cửa sổ trình duyệt độc lập (headless: false): ${lastError?.message || lastError}`);
    }
    async resetSession(context) {
        await context.clearCookies().catch(() => { });
        for (const p of context.pages()) {
            await p
                .evaluate(() => {
                try {
                    localStorage.clear();
                    sessionStorage.clear();
                }
                catch {
                }
            })
                .catch(() => { });
        }
        const warmPage = await context.newPage().catch(() => null);
        if (warmPage) {
            try {
                await warmPage.goto(constants_1.AIRBNB_BASE_URL, { timeout: 25000, waitUntil: 'commit' });
                await (0, helpers_1.sleep)(1500);
            }
            catch {
            }
            finally {
                await warmPage.close().catch(() => { });
            }
        }
    }
    async recreateBrowserWithProxy(options) {
        if (options.currentContext) {
            await options.currentContext.close().catch(() => { });
        }
        if (options.currentBrowser) {
            await options.currentBrowser.close().catch(() => { });
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
    async checkIpTrace() {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 7000);
        try {
            const res = await fetch('https://1.1.1.1/cdn-cgi/trace', {
                signal: controller.signal,
                headers: { 'Cache-Control': 'no-cache' },
            });
            const text = await res.text();
            const map = {};
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
        }
        finally {
            clearTimeout(timer);
        }
    }
};
exports.BrowserService = BrowserService;
exports.BrowserService = BrowserService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [app_config_service_1.AppConfigService])
], BrowserService);
//# sourceMappingURL=browser.service.js.map