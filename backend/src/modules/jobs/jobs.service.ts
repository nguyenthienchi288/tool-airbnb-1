import { Injectable } from '@nestjs/common';
import { Browser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { Response } from 'express';
import { CrawlJobInput, CrawlJobResult, LogEntry } from '../../common/types';
import { DatabaseService } from '../database/database.service';
import { ExporterService } from '../exporter/exporter.service';
import { BrowserService } from '../scraper/browser.service';
import {
  ManualInterventionHandlers,
  PauseStatePayload,
  ScraperService,
} from '../scraper/scraper.service';

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

function isTargetClosedError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  const name = String(err?.name || '').toLowerCase();
  return (
    name.includes('targetclosederror') ||
    msg.includes('target page, context or browser has been closed') ||
    msg.includes('browser has been closed') ||
    msg.includes('target closed')
  );
}

@Injectable()
export class JobsService {
  private readonly jobs = new Map<string, JobState>();

  constructor(
    private readonly scraper: ScraperService,
    private readonly browserService: BrowserService,
    private readonly exporterService: ExporterService,
    private readonly db: DatabaseService,
  ) {}

  getJob(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  getActiveJob(): JobState | undefined {
    for (const job of this.jobs.values()) {
      if (job.status === 'running') return job;
    }
    return undefined;
  }

  sendSse(res: Response, event: string, data: unknown) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Ignore closed stream
    }
  }

  private broadcast(job: JobState, event: string, data: unknown) {
    for (const client of job.clients) {
      this.sendSse(client, event, data);
    }
  }

  private createJob(cityName: string): JobState {
    const now = Date.now();
    const initialAction = 'Đang kiểm tra cấu hình & mở trình duyệt...';
    const job: JobState = {
      jobId: uuidv4(),
      cityName,
      status: 'running',
      percent: 3,
      label: initialAction,
      logs: [],
      abortController: new AbortController(),
      isStopRequested: false,
      clients: new Set(),
      createdAt: new Date(now).toISOString(),
      startedAtMs: now,
      lastActivityAtMs: now,
      currentAction: initialAction,
      pauseState: { status: 'running', countdownSeconds: 0 },
    };
    this.jobs.set(job.jobId, job);
    return job;
  }

  private pushLog(job: JobState, message: string, level: LogEntry['level'] = 'info') {
    job.lastActivityAtMs = Date.now();
    job.currentAction = message;
    const entry: LogEntry = {
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      level,
      message,
    };
    job.logs.push(entry);
    if (job.logs.length > 500) job.logs.shift();
    this.broadcast(job, 'log', entry);
  }

  private pushProgress(job: JobState, percent: number, label: string) {
    job.lastActivityAtMs = Date.now();
    job.percent = Math.min(100, Math.max(0, Math.round(percent)));
    job.label = label;
    job.currentAction = label;
    this.broadcast(job, 'progress', {
      status: job.status,
      percent: job.percent,
      label: job.label,
    });
  }

  private emitHeartbeat(job: JobState) {
    if (job.status !== 'running') return;
    const now = Date.now();
    const payload: HeartbeatPayload = {
      elapsedSeconds: Math.max(0, Math.floor((now - job.startedAtMs) / 1000)),
      idleSeconds: Math.max(0, Math.floor((now - job.lastActivityAtMs) / 1000)),
      currentAction: job.currentAction || job.label,
      savedCount: this.db.getRoomCountForCity(job.cityName),
    };
    this.broadcast(job, 'heartbeat', payload);
  }

  startJob(input: CrawlJobInput): JobState {
    const job = this.createJob(input.cityName);

    // Đẩy ngay log đầu tiên vào logBuffer để Frontend vừa nối SSE là nhận được tức thì
    this.pushLog(
      job,
      '[Hệ thống] Đã nhận lệnh khởi chạy — Đang kiểm tra cấu hình & mở trình duyệt...',
      'step',
    );

    // Bộ đếm nhịp đập thời gian thực mỗi 2 giây
    job.heartbeatTimer = setInterval(() => {
      this.emitHeartbeat(job);
    }, 2000);

    const runJob = async () => {
      try {
        const result = await this.scraper.runCleanPipeline(
          input,
          {
            signal: job.abortController.signal,
            onLog: (msg, level) => this.pushLog(job, msg, level),
            onProgress: (pct, lbl) => this.pushProgress(job, pct, lbl),
            onPauseStateChange: (ps) => {
              job.pauseState = ps;
              this.broadcast(job, 'pause_state', ps);
            },
            onHandlersReady: (handlers) => {
              job.handlers = handlers;
            },
          },
          (browser) => {
            job.activeBrowser = browser;
          },
        );
        job.result = result;
        if (result.stoppedEarly || job.isStopRequested) {
          job.status = 'stopped';
          this.pushProgress(job, 100, `Đã dừng & xuất Excel (${result.cityReportFile})`);
          this.broadcast(job, 'stopped', { status: 'stopped', result });
        } else {
          job.status = 'completed';
          this.pushProgress(job, 100, 'Hoàn tất!');
          this.broadcast(job, 'done', { status: 'completed', result });
        }
      } catch (err: any) {
        if (
          job.isStopRequested ||
          err?.name === 'AbortError' ||
          job.abortController.signal.aborted
        ) {
          job.status = 'stopped';
          this.pushLog(
            job,
            '[Hệ thống] Trình duyệt đã đóng theo lệnh dừng — Đang xuất toàn bộ dữ liệu SQLite ra Excel...',
            'warn',
          );
          try {
            const { cityReport, masterReport } = await this.exporterService.exportAllReports(input.cityName);
            const fallbackResult: CrawlJobResult = {
              cityName: input.cityName,
              stoppedEarly: true,
              totalUrls: 0,
              totalRooms: this.db.getRoomCountForCity(input.cityName),
              totalHosts: 0,
              totalHostRooms: 0,
              cityReportFile: cityReport.fileName,
              masterReportFile: masterReport.fileName,
            };
            job.result = fallbackResult;
            this.pushLog(job, `[Excel] Đã xuất ${cityReport.fileName}`, 'success');
            this.pushLog(job, `[Excel] Đã cập nhật ${masterReport.fileName}`, 'success');
            this.pushProgress(job, 100, `Đã dừng & xuất Excel (${cityReport.fileName})`);
            this.broadcast(job, 'stopped', { status: 'stopped', result: fallbackResult });
          } catch (exportErr: any) {
            this.pushLog(job, `[Excel] Lỗi khi xuất file lúc dừng: ${exportErr?.message || exportErr}`, 'warn');
            this.broadcast(job, 'stopped', { status: 'stopped' });
          }
        } else {
          job.status = 'error';
          const errMsg = err?.message || 'Lỗi không xác định.';
          const stackLine = err?.stack ? String(err.stack).split('\n').slice(0, 3).join(' | ') : '';
          job.error = errMsg;
          console.error('[JobsService] Job FAILED:', err);
          this.pushLog(job, `[FAILED] ${errMsg}`, 'error');
          if (stackLine) {
            this.pushLog(job, `[Chi tiết lỗi] ${stackLine}`, 'error');
          }
          this.pushProgress(job, job.percent, `Thất bại: ${errMsg}`);
          this.broadcast(job, 'error', { status: 'error', error: errMsg });
        }
      } finally {
        if (job.heartbeatTimer) {
          clearInterval(job.heartbeatTimer);
          job.heartbeatTimer = undefined;
        }
        job.activeBrowser = undefined;
        await this.browserService.forceClose();
      }
    };

    void runJob().catch((unhandledErr) => {
      console.error('[JobsService] Unhandled Rejection:', unhandledErr);
      if (job.heartbeatTimer) {
        clearInterval(job.heartbeatTimer);
        job.heartbeatTimer = undefined;
      }
      job.status = 'error';
      job.error = unhandledErr?.message || 'Unhandled error';
      this.pushLog(job, `[FAILED] ${job.error}`, 'error');
      this.broadcast(job, 'error', { status: 'error', error: job.error });
    });

    return job;
  }

  async stopJob(jobId?: string): Promise<JobState | undefined> {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job) return undefined;

    job.isStopRequested = true;
    job.abortController.abort();
    this.pushLog(job, '[Hệ thống] Đang cưỡng bức đóng trình duyệt & xuất Excel hiện có...', 'warn');

    await this.browserService.forceClose();
    if (job.activeBrowser) {
      await job.activeBrowser.close().catch(() => {});
      job.activeBrowser = undefined;
    }
    return job;
  }

  pauseJob(jobId?: string): JobState | undefined {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job || job.status !== 'running') return undefined;
    job.handlers?.pause();
    return job;
  }

  resumeJob(jobId?: string): JobState | undefined {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job || job.status !== 'running') return undefined;
    job.handlers?.resume();
    return job;
  }

  async updateProxy(proxyUrl?: string, jobId?: string): Promise<JobState | undefined> {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job || job.status !== 'running') return undefined;
    if (job.handlers) {
      await job.handlers.updateProxy(proxyUrl);
    }
    return job;
  }

  async resetSession(jobId?: string): Promise<JobState | undefined> {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job || job.status !== 'running') return undefined;
    if (job.handlers) {
      await job.handlers.resetSession();
    }
    return job;
  }

  skipCurrent(jobId?: string): JobState | undefined {
    const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
    if (!job || job.status !== 'running') return undefined;
    job.handlers?.skipCurrent();
    return job;
  }
}
