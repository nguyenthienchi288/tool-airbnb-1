import { BrowserService } from './browser.service';
export declare class BrowserController {
    private readonly browserService;
    constructor(browserService: BrowserService);
    openSetupBrowser(body?: {
        proxyUrl?: string;
        useWarpProxy?: boolean;
    }): Promise<{
        ok: boolean;
        channelUsed: string;
        profileDir: string;
        message: string;
    }>;
    checkIp(): Promise<{
        ip: string;
        loc: string;
        warp: string;
        checkedAt: string;
    }>;
}
