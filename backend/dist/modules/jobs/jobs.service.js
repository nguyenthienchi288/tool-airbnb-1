"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const database_service_1 = require("../database/database.service");
const exporter_service_1 = require("../exporter/exporter.service");
const browser_service_1 = require("../scraper/browser.service");
const scraper_service_1 = require("../scraper/scraper.service");
function isTargetClosedError(err) {
    const msg = String(err?.message || err || '').toLowerCase();
    const name = String(err?.name || '').toLowerCase();
    return (name.includes('targetclosederror') ||
        msg.includes('target page, context or browser has been closed') ||
        msg.includes('browser has been closed') ||
        msg.includes('target closed'));
}
let JobsService = class JobsService {
    scraper;
    browserService;
    exporterService;
    db;
    jobs = new Map();
    constructor(scraper, browserService, exporterService, db) {
        this.scraper = scraper;
        this.browserService = browserService;
        this.exporterService = exporterService;
        this.db = db;
    }
    getJob(jobId) {
        return this.jobs.get(jobId);
    }
    getActiveJob() {
        for (const job of this.jobs.values()) {
            if (job.status === 'running')
                return job;
        }
        return undefined;
    }
    sendSse(res, event, data) {
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
        catch {
        }
    }
    broadcast(job, event, data) {
        for (const client of job.clients) {
            this.sendSse(client, event, data);
        }
    }
    createJob(cityName) {
        const now = Date.now();
        const initialAction = 'Đang kiểm tra cấu hình & mở trình duyệt...';
        const job = {
            jobId: (0, uuid_1.v4)(),
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
    pushLog(job, message, level = 'info') {
        job.lastActivityAtMs = Date.now();
        job.currentAction = message;
        const entry = {
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
            level,
            message,
        };
        job.logs.push(entry);
        if (job.logs.length > 500)
            job.logs.shift();
        this.broadcast(job, 'log', entry);
    }
    pushProgress(job, percent, label) {
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
    emitHeartbeat(job) {
        if (job.status !== 'running')
            return;
        const now = Date.now();
        const payload = {
            elapsedSeconds: Math.max(0, Math.floor((now - job.startedAtMs) / 1000)),
            idleSeconds: Math.max(0, Math.floor((now - job.lastActivityAtMs) / 1000)),
            currentAction: job.currentAction || job.label,
            savedCount: this.db.getRoomCountForCity(job.cityName),
        };
        this.broadcast(job, 'heartbeat', payload);
    }
    startJob(input) {
        const job = this.createJob(input.cityName);
        this.pushLog(job, '[Hệ thống] Đã nhận lệnh khởi chạy — Đang kiểm tra cấu hình & mở trình duyệt...', 'step');
        job.heartbeatTimer = setInterval(() => {
            this.emitHeartbeat(job);
        }, 2000);
        const runJob = async () => {
            try {
                const result = await this.scraper.runCleanPipeline(input, {
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
                }, (browser) => {
                    job.activeBrowser = browser;
                });
                job.result = result;
                if (result.stoppedEarly || job.isStopRequested) {
                    job.status = 'stopped';
                    this.pushProgress(job, 100, `Đã dừng & xuất Excel (${result.cityReportFile})`);
                    this.broadcast(job, 'stopped', { status: 'stopped', result });
                }
                else {
                    job.status = 'completed';
                    this.pushProgress(job, 100, 'Hoàn tất!');
                    this.broadcast(job, 'done', { status: 'completed', result });
                }
            }
            catch (err) {
                if (job.isStopRequested ||
                    err?.name === 'AbortError' ||
                    job.abortController.signal.aborted) {
                    job.status = 'stopped';
                    this.pushLog(job, '[Hệ thống] Trình duyệt đã đóng theo lệnh dừng — Đang xuất toàn bộ dữ liệu SQLite ra Excel...', 'warn');
                    try {
                        const { cityReport, masterReport } = await this.exporterService.exportAllReports(input.cityName);
                        const fallbackResult = {
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
                    }
                    catch (exportErr) {
                        this.pushLog(job, `[Excel] Lỗi khi xuất file lúc dừng: ${exportErr?.message || exportErr}`, 'warn');
                        this.broadcast(job, 'stopped', { status: 'stopped' });
                    }
                }
                else {
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
            }
            finally {
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
    async stopJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job)
            return undefined;
        job.isStopRequested = true;
        job.abortController.abort();
        this.pushLog(job, '[Hệ thống] Đang cưỡng bức đóng trình duyệt & xuất Excel hiện có...', 'warn');
        await this.browserService.forceClose();
        if (job.activeBrowser) {
            await job.activeBrowser.close().catch(() => { });
            job.activeBrowser = undefined;
        }
        return job;
    }
    pauseJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job || job.status !== 'running')
            return undefined;
        job.handlers?.pause();
        return job;
    }
    resumeJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job || job.status !== 'running')
            return undefined;
        job.handlers?.resume();
        return job;
    }
    async updateProxy(proxyUrl, jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job || job.status !== 'running')
            return undefined;
        if (job.handlers) {
            await job.handlers.updateProxy(proxyUrl);
        }
        return job;
    }
    async resetSession(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job || job.status !== 'running')
            return undefined;
        if (job.handlers) {
            await job.handlers.resetSession();
        }
        return job;
    }
    skipCurrent(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job || job.status !== 'running')
            return undefined;
        job.handlers?.skipCurrent();
        return job;
    }
};
exports.JobsService = JobsService;
exports.JobsService = JobsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [scraper_service_1.ScraperService,
        browser_service_1.BrowserService,
        exporter_service_1.ExporterService,
        database_service_1.DatabaseService])
], JobsService);
//# sourceMappingURL=jobs.service.js.map