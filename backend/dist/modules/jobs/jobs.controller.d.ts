import { Request, Response } from 'express';
import { JobsService } from './jobs.service';
export declare class JobsController {
    private readonly jobsService;
    constructor(jobsService: JobsService);
    getActiveJob(): {
        activeJob: {
            jobId: string;
            status: "running" | "completed" | "stopped" | "error";
            percent: number;
            label: string;
            createdAt: string;
            pauseState: import("../scraper/scraper.service").PauseStatePayload;
        };
    };
    startJob(body: any): {
        jobId: string;
        status: "running" | "completed" | "stopped" | "error";
    };
    streamJob(jobId: string, req: Request, res: Response): void;
    stopActiveJob(): Promise<{
        jobId: string;
        status: "running" | "completed" | "stopped" | "error";
    }>;
    stopJob(jobId: string): Promise<{
        jobId: string;
        status: "running" | "completed" | "stopped" | "error";
    }>;
    pauseActiveJob(body?: {
        jobId?: string;
    }): {
        jobId: string;
        pauseState: import("../scraper/scraper.service").PauseStatePayload;
    };
    resumeActiveJob(body?: {
        jobId?: string;
    }): {
        jobId: string;
        pauseState: import("../scraper/scraper.service").PauseStatePayload;
    };
    updateProxy(body?: {
        proxyUrl?: string;
        jobId?: string;
    }): Promise<{
        jobId: string;
        pauseState: import("../scraper/scraper.service").PauseStatePayload;
    }>;
    resetSession(body?: {
        jobId?: string;
    }): Promise<{
        jobId: string;
        ok: boolean;
    }>;
    skipCurrent(body?: {
        jobId?: string;
    }): {
        jobId: string;
        ok: boolean;
    };
}
