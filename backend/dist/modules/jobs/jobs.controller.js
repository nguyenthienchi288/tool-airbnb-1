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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.JobsController = void 0;
const common_1 = require("@nestjs/common");
const jobs_service_1 = require("./jobs.service");
let JobsController = class JobsController {
    jobsService;
    constructor(jobsService) {
        this.jobsService = jobsService;
    }
    getActiveJob() {
        const active = this.jobsService.getActiveJob();
        if (!active)
            return { activeJob: null };
        return {
            activeJob: {
                jobId: active.jobId,
                status: active.status,
                percent: active.percent,
                label: active.label,
                createdAt: active.createdAt,
                pauseState: active.pauseState,
            },
        };
    }
    startJob(body) {
        const active = this.jobsService.getActiveJob();
        if (active) {
            throw new common_1.ConflictException({
                error: 'Đang có tiến trình chạy. Vui lòng dừng trước khi bắt đầu lượt mới.',
                activeJobId: active.jobId,
            });
        }
        const cityName = String(body?.cityName || '').trim();
        const checkIn = String(body?.checkIn || '').trim();
        const checkOut = String(body?.checkOut || '').trim();
        const keywords = Array.isArray(body?.keywords)
            ? body.keywords.map((k) => String(k || '').trim()).filter(Boolean)
            : undefined;
        const dateWindows = Array.isArray(body?.dateWindows)
            ? body.dateWindows
                .filter((w) => w && typeof w === 'object')
                .map((w) => ({
                checkIn: String(w.checkIn || '').trim(),
                checkOut: String(w.checkOut || '').trim(),
                label: w.label ? String(w.label).trim() : undefined,
            }))
            : undefined;
        const autoGenerateStrategicDates = Boolean(body?.autoGenerateStrategicDates);
        const includeFlexibleDates = Boolean(body?.includeFlexibleDates);
        const hasAnyDateSource = (checkIn && checkOut) ||
            (dateWindows && dateWindows.some((w) => w.checkIn && w.checkOut)) ||
            autoGenerateStrategicDates ||
            includeFlexibleDates;
        if (!cityName || !hasAnyDateSource) {
            throw new common_1.BadRequestException('Vui lòng nhập Thành phố/Khu vực và ít nhất 1 khung ngày Check-in/Check-out (hoặc bật Tự động sinh khung ngày / Flexible).');
        }
        const job = this.jobsService.startJob({
            cityName,
            keywords,
            checkIn,
            checkOut,
            dateWindows,
            autoGenerateStrategicDates,
            includeFlexibleDates,
            maxPages: Math.max(1, Math.min(30, Number(body?.maxPages || 15))),
            tabsCount: Math.max(1, Math.min(6, Number(body?.tabsCount || 2))),
            humanLikeMode: body?.humanLikeMode !== false,
            enablePriceSlicing: body?.enablePriceSlicing !== false,
            priceBucketsText: body?.priceBucketsText ? String(body.priceBucketsText) : undefined,
            entireHomeOnly: body?.entireHomeOnly !== false,
            includeHostRooms: body?.includeHostRooms !== false,
            proxyUrl: body?.proxyUrl ? String(body.proxyUrl).trim() : undefined,
            useWarpProxy: Boolean(body?.useWarpProxy),
        });
        return { jobId: job.jobId, status: job.status };
    }
    streamJob(jobId, req, res) {
        const job = this.jobsService.getJob(jobId);
        if (!job)
            throw new common_1.NotFoundException('Không tìm thấy jobId.');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        this.jobsService.sendSse(res, 'progress', {
            status: job.status,
            percent: job.percent,
            label: job.label,
        });
        this.jobsService.sendSse(res, 'pause_state', job.pauseState);
        for (const entry of job.logs) {
            this.jobsService.sendSse(res, 'log', entry);
        }
        if (job.status === 'completed') {
            this.jobsService.sendSse(res, 'done', { status: 'completed', result: job.result });
        }
        else if (job.status === 'stopped') {
            this.jobsService.sendSse(res, 'stopped', { status: 'stopped' });
        }
        else if (job.status === 'error') {
            this.jobsService.sendSse(res, 'error', { status: 'error', error: job.error });
        }
        job.clients.add(res);
        req.on('close', () => {
            job.clients.delete(res);
        });
    }
    async stopActiveJob() {
        const job = await this.jobsService.stopJob();
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, status: job.status };
    }
    async stopJob(jobId) {
        const job = await this.jobsService.stopJob(jobId);
        if (!job)
            throw new common_1.NotFoundException('Không tìm thấy jobId.');
        return { jobId: job.jobId, status: job.status };
    }
    pauseActiveJob(body) {
        const job = this.jobsService.pauseJob(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    resumeActiveJob(body) {
        const job = this.jobsService.resumeJob(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    async updateProxy(body) {
        const job = await this.jobsService.updateProxy(body?.proxyUrl, body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    async resetSession(body) {
        const job = await this.jobsService.resetSession(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, ok: true };
    }
    skipCurrent(body) {
        const job = this.jobsService.skipCurrent(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, ok: true };
    }
};
exports.JobsController = JobsController;
__decorate([
    (0, common_1.Get)('active'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "getActiveJob", null);
__decorate([
    (0, common_1.Post)('start'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "startJob", null);
__decorate([
    (0, common_1.Get)(':jobId/stream'),
    __param(0, (0, common_1.Param)('jobId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "streamJob", null);
__decorate([
    (0, common_1.Post)('stop'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "stopActiveJob", null);
__decorate([
    (0, common_1.Post)(':jobId/stop'),
    __param(0, (0, common_1.Param)('jobId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "stopJob", null);
__decorate([
    (0, common_1.Post)('pause'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "pauseActiveJob", null);
__decorate([
    (0, common_1.Post)('resume'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "resumeActiveJob", null);
__decorate([
    (0, common_1.Post)('update-proxy'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "updateProxy", null);
__decorate([
    (0, common_1.Post)('reset-session'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], JobsController.prototype, "resetSession", null);
__decorate([
    (0, common_1.Post)('skip-current'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], JobsController.prototype, "skipCurrent", null);
exports.JobsController = JobsController = __decorate([
    (0, common_1.Controller)('api/jobs'),
    __metadata("design:paramtypes", [jobs_service_1.JobsService])
], JobsController);
//# sourceMappingURL=jobs.controller.js.map