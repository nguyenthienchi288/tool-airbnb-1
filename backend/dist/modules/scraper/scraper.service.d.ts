import { Browser, Page, Response } from 'playwright';
import { CrawlJobInput, CrawlJobResult } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { ExporterService } from '../exporter/exporter.service';
import { HostParserService } from '../parser/host-parser.service';
import { PdpParserService } from '../parser/pdp-parser.service';
import { BrowserService } from './browser.service';
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
export declare class ScraperService {
    private readonly appConfig;
    private readonly db;
    private readonly pdpParser;
    private readonly hostParser;
    private readonly browserService;
    private readonly exporter;
    constructor(appConfig: AppConfigService, db: DatabaseService, pdpParser: PdpParserService, hostParser: HostParserService, browserService: BrowserService, exporter: ExporterService);
    private isStopRequested;
    private isTargetClosedError;
    private isWatchdogError;
    private runWithWatchdog;
    private gotoWithRetry;
    private humanSmoothScroll;
    private dismissPopups;
    private extractDeferredJson;
    isBlockedOr503(page: Page, response?: Response | null): Promise<{
        blocked: boolean;
        status: number;
        reason: string;
    }>;
    private scrapeRoomDetail;
    runCleanPipeline(input: CrawlJobInput, control: JobControl, onBrowserReady?: (browser: Browser | null) => void): Promise<CrawlJobResult>;
}
