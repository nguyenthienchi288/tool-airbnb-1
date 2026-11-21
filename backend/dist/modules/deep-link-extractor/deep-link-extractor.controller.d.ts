import { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { DeepLinkExtractorService } from './deep-link-extractor.service';
export declare class DeepLinkExtractorController {
    private readonly extractor;
    private readonly appConfig;
    constructor(extractor: DeepLinkExtractorService, appConfig: AppConfigService);
    parseUrl(body: {
        url?: string;
    }): import("./types").ParsedAirbnbUrl;
    start(body: any): {
        jobId: string;
        status: "error" | "running" | "completed" | "stopped";
    };
    stream(jobId: string, req: Request, res: Response): void;
    stop(body?: {
        jobId?: string;
    }): Promise<{
        jobId: string;
        status: "error" | "running" | "completed" | "stopped";
    }>;
    pause(body?: {
        jobId?: string;
    }): {
        jobId: string;
        pauseState: {
            status: "running" | "paused" | "paused_503";
            countdownSeconds: number;
            reason?: string;
        };
    };
    resume(body?: {
        jobId?: string;
    }): {
        jobId: string;
        pauseState: {
            status: "running" | "paused" | "paused_503";
            countdownSeconds: number;
            reason?: string;
        };
    };
    skipCurrent(body?: {
        jobId?: string;
    }): {
        jobId: string;
        ok: boolean;
    };
    resetSession(body?: {
        jobId?: string;
    }): Promise<{
        jobId: string;
        ok: boolean;
    }>;
    clearCache(): {
        ok: boolean;
    };
    updateProxy(body?: {
        proxyUrl?: string;
        jobId?: string;
    }): Promise<{
        jobId: string;
        pauseState: {
            status: "running" | "paused" | "paused_503";
            countdownSeconds: number;
            reason?: string;
        };
    }>;
    closeKeptBrowser(): Promise<{
        ok: boolean;
    }>;
    applyAiJson(body: {
        jobId?: string;
        aiJsonText?: string;
    }): Promise<{
        result: import("./types").DeepExtractBundleResult;
        preview: import("./types").SevenNightsPreviewData;
        message: string;
    }>;
    downloadBundleFile(bundleName: string, fileName: string, res: Response): void;
    downloadBundleZip(zipFileName: string, res: Response): void;
}
