import { Browser, BrowserContext, Page } from 'playwright';
import { ProxyConfig } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
export declare class BrowserService {
    private readonly appConfig;
    private activeBrowser;
    private activeContext;
    private setupContext;
    constructor(appConfig: AppConfigService);
    forceClose(): Promise<void>;
    private closeSetupContext;
    private configureStealthAndRouting;
    launchPersistentBrowserContext(options?: {
        proxyOverride?: ProxyConfig;
        disableEnvProxy?: boolean;
        humanLikeMode?: boolean;
        enableResourceBlocking?: boolean;
        isSetupMode?: boolean;
    }): Promise<{
        context: BrowserContext;
        browser: Browser | null;
        channelUsed: string;
    }>;
    openSetupBrowser(proxyOverride?: ProxyConfig): Promise<{
        channelUsed: string;
        profileDir: string;
    }>;
    newHumanPage(context: BrowserContext): Promise<Page>;
    launchTab2ChromeForTesting(options?: {
        proxyOverride?: ProxyConfig;
    }): Promise<{
        context: BrowserContext;
        browser: Browser;
        channelUsed: string;
    }>;
    launchTab2HeadfulBrowser(options?: {
        proxyOverride?: ProxyConfig;
    }): Promise<{
        context: BrowserContext;
        browser: Browser | null;
        channelUsed: string;
    }>;
    resetSession(context: BrowserContext): Promise<void>;
    recreateBrowserWithProxy(options: {
        currentContext?: BrowserContext | null;
        currentBrowser?: Browser | null;
        proxyOverride?: ProxyConfig;
        humanLikeMode?: boolean;
    }): Promise<{
        browser: Browser | null;
        context: BrowserContext;
        channelUsed: string;
    }>;
    checkIpTrace(): Promise<{
        ip: string;
        loc: string;
        warp: string;
        checkedAt: string;
    }>;
}
