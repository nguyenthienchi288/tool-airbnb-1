import { Browser } from 'playwright';
import { Response } from 'express';
import { CrawlJobInput, CrawlJobResult, LogEntry } from '../../common/types';
import { DatabaseService } from '../database/database.service';
import { ExporterService } from '../exporter/exporter.service';
import { BrowserService } from '../scraper/browser.service';
import { ManualInterventionHandlers, PauseStatePayload, ScraperService } from '../scraper/scraper.service';
export interface HeartbeatPayload {
    elapsedSeconds: number;
    idleSeconds: number;
    currentAction: string;
    savedCount: number;
}
export interface JobState {
    jobId: string;
    cityName: string;
    status: 'running' | 'completed' | 'stopped' | 'error';
    percent: number;
    label: string;
    logs: LogEntry[];
    result?: CrawlJobResult;
    error?: string;
    abortController: AbortController;
    isStopRequested: boolean;
    activeBrowser?: Browser | null;
    clients: Set<Response>;
    createdAt: string;
    startedAtMs: number;
    lastActivityAtMs: number;
    currentAction: string;
    heartbeatTimer?: NodeJS.Timeout;
    pauseState: PauseStatePayload;
    handlers?: ManualInterventionHandlers;
}
export declare class JobsService {
    private readonly scraper;
    private readonly browserService;
    private readonly exporterService;
    private readonly db;
    private readonly jobs;
    constructor(scraper: ScraperService, browserService: BrowserService, exporterService: ExporterService, db: DatabaseService);
    getJob(jobId: string): JobState | undefined;
    getActiveJob(): JobState | undefined;
    sendSse(res: Response, event: string, data: unknown): void;
    private broadcast;
    private createJob;
    private pushLog;
    private pushProgress;
    private emitHeartbeat;
    startJob(input: CrawlJobInput): JobState;
    stopJob(jobId?: string): Promise<JobState | undefined>;
    pauseJob(jobId?: string): JobState | undefined;
    resumeJob(jobId?: string): JobState | undefined;
    updateProxy(proxyUrl?: string, jobId?: string): Promise<JobState | undefined>;
    resetSession(jobId?: string): Promise<JobState | undefined>;
    skipCurrent(jobId?: string): JobState | undefined;
}
