import { Browser } from 'playwright';
import { Response as ExpressResponse } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { PdpParserService } from '../parser/pdp-parser.service';
import { HostParserService } from '../parser/host-parser.service';
import { BrowserService } from '../scraper/browser.service';
import { DeepExtractBundleResult, DeepExtractJobInput, ParsedAirbnbUrl, SevenNightsPreviewData } from './types';
export interface DeepJobState {
    jobId: string;
    status: 'running' | 'completed' | 'stopped' | 'error';
    percent: number;
    label: string;
    logs: Array<{
        timestamp: string;
        level: string;
        message: string;
    }>;
    preview: SevenNightsPreviewData;
    result?: DeepExtractBundleResult;
    error?: string;
    abortController: AbortController;
    isStopRequested: boolean;
    activeBrowser?: Browser | null;
    clients: Set<ExpressResponse>;
    pauseState: {
        status: 'running' | 'paused' | 'paused_503';
        countdownSeconds: number;
        reason?: string;
    };
    handlers?: {
        pause: () => void;
        resume: () => void;
        resetSession: () => Promise<void>;
        skipCurrent: () => void;
        updateProxy: (proxyUrl?: string) => Promise<void>;
    };
}
export declare class DeepLinkExtractorService {
    private readonly appConfig;
    private readonly browserService;
    private readonly pdpParser;
    private readonly hostParser;
    private readonly jobs;
    constructor(appConfig: AppConfigService, browserService: BrowserService, pdpParser: PdpParserService, hostParser: HostParserService);
    parseUrl(rawUrl: string): ParsedAirbnbUrl;
    getJob(jobId: string): DeepJobState | undefined;
    getActiveJob(): DeepJobState | undefined;
    sendSse(res: ExpressResponse, event: string, data: unknown): void;
    private broadcast;
    private pushLog;
    private pushProgress;
    startJob(input: DeepExtractJobInput): DeepJobState;
    stopJob(jobId?: string): Promise<DeepJobState | undefined>;
    pauseJob(jobId?: string): DeepJobState;
    resumeJob(jobId?: string): DeepJobState;
    skipCurrent(jobId?: string): DeepJobState;
    resetSession(jobId?: string): Promise<DeepJobState>;
    updateProxy(proxyUrl?: string, jobId?: string): Promise<DeepJobState>;
    private isBlockedOr503;
    private extractAmenityFlags;
    private inferRoomType;
    private extractDistrict;
    private extractSupplierAptCode;
    private humanBrowseScroll;
    private collectPhotosFromObject;
    private parseHouseRulesDetails;
    private runPipeline;
}
