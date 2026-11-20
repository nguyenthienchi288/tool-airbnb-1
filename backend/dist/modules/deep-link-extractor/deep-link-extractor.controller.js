"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepLinkExtractorController = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app_config_service_1 = require("../../config/app-config.service");
const deep_link_extractor_service_1 = require("./deep-link-extractor.service");
let DeepLinkExtractorController = class DeepLinkExtractorController {
    extractor;
    appConfig;
    constructor(extractor, appConfig) {
        this.extractor = extractor;
        this.appConfig = appConfig;
    }
    parseUrl(body) {
        return this.extractor.parseUrl(body?.url || '');
    }
    start(body) {
        const active = this.extractor.getActiveJob();
        if (active) {
            throw new common_1.ConflictException({
                error: 'Đang có tiến trình Trích xuất Link chạy. Vui lòng dừng trước khi bắt đầu lượt mới.',
                activeJobId: active.jobId,
            });
        }
        const url = String(body?.url || '').trim();
        if (!url) {
            throw new common_1.BadRequestException('Vui lòng dán đường dẫn URL Airbnb.');
        }
        const job = this.extractor.startJob({
            url,
            downloadPhotos: body?.downloadPhotos !== false,
            strictBoundsOnly: body?.strictBoundsOnly !== false,
            proxyUrl: body?.proxyUrl ? String(body.proxyUrl).trim() : undefined,
            useWarpProxy: Boolean(body?.useWarpProxy),
            humanLikeMode: body?.humanLikeMode !== false,
        });
        return { jobId: job.jobId, status: job.status };
    }
    stream(jobId, req, res) {
        const job = this.extractor.getJob(jobId);
        if (!job)
            throw new common_1.NotFoundException('Không tìm thấy jobId.');
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        this.extractor.sendSse(res, 'progress', {
            status: job.status,
            percent: job.percent,
            label: job.label,
        });
        this.extractor.sendSse(res, 'pause_state', job.pauseState);
        this.extractor.sendSse(res, 'preview', job.preview);
        for (const entry of job.logs) {
            this.extractor.sendSse(res, 'log', entry);
        }
        if (job.status === 'completed') {
            this.extractor.sendSse(res, 'done', { status: 'completed', result: job.result });
        }
        else if (job.status === 'stopped') {
            this.extractor.sendSse(res, 'stopped', { status: 'stopped', result: job.result });
        }
        else if (job.status === 'error') {
            this.extractor.sendSse(res, 'error', { status: 'error', error: job.error });
        }
        job.clients.add(res);
        req.on('close', () => {
            job.clients.delete(res);
        });
    }
    async stop(body) {
        const job = await this.extractor.stopJob(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, status: job.status };
    }
    pause(body) {
        const job = this.extractor.pauseJob(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    resume(body) {
        const job = this.extractor.resumeJob(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    skipCurrent(body) {
        const job = this.extractor.skipCurrent(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, ok: true };
    }
    async resetSession(body) {
        const job = await this.extractor.resetSession(body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, ok: true };
    }
    async updateProxy(body) {
        const job = await this.extractor.updateProxy(body?.proxyUrl, body?.jobId);
        if (!job)
            throw new common_1.NotFoundException('Không có tiến trình nào đang chạy.');
        return { jobId: job.jobId, pauseState: job.pauseState };
    }
    downloadBundleFile(bundleName, fileName, res) {
        const safeBundle = path.basename(bundleName);
        const safeFile = path.basename(fileName);
        const fullPath = path.join(this.appConfig.outputDir, safeBundle, safeFile);
        if (!fs.existsSync(fullPath)) {
            throw new common_1.NotFoundException('Không tìm thấy file trong thư mục bundle.');
        }
        return res.download(fullPath, safeFile);
    }
    downloadBundleZip(zipFileName, res) {
        const safeZip = path.basename(zipFileName);
        const fullPath = path.join(this.appConfig.outputDir, safeZip);
        if (!fs.existsSync(fullPath)) {
            throw new common_1.NotFoundException('Không tìm thấy file .zip.');
        }
        return res.download(fullPath, safeZip);
    }
};
exports.DeepLinkExtractorController = DeepLinkExtractorController;
__decorate([
    (0, common_1.Post)('parse-url'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "parseUrl", null);
__decorate([
    (0, common_1.Post)('start'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "start", null);
__decorate([
    (0, common_1.Get)(':jobId/stream'),
    __param(0, (0, common_1.Param)('jobId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "stream", null);
__decorate([
    (0, common_1.Post)('stop'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeepLinkExtractorController.prototype, "stop", null);
__decorate([
    (0, common_1.Post)('pause'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "pause", null);
__decorate([
    (0, common_1.Post)('resume'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "resume", null);
__decorate([
    (0, common_1.Post)('skip-current'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "skipCurrent", null);
__decorate([
    (0, common_1.Post)('reset-session'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeepLinkExtractorController.prototype, "resetSession", null);
__decorate([
    (0, common_1.Post)('update-proxy'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], DeepLinkExtractorController.prototype, "updateProxy", null);
__decorate([
    (0, common_1.Get)('download-file/:bundleName/:fileName'),
    __param(0, (0, common_1.Param)('bundleName')),
    __param(1, (0, common_1.Param)('fileName')),
    __param(2, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "downloadBundleFile", null);
__decorate([
    (0, common_1.Get)('download-zip/:zipFileName'),
    __param(0, (0, common_1.Param)('zipFileName')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], DeepLinkExtractorController.prototype, "downloadBundleZip", null);
exports.DeepLinkExtractorController = DeepLinkExtractorController = __decorate([
    (0, common_1.Controller)('api/deep-extract'),
    __metadata("design:paramtypes", [deep_link_extractor_service_1.DeepLinkExtractorService,
        app_config_service_1.AppConfigService])
], DeepLinkExtractorController);
//# sourceMappingURL=deep-link-extractor.controller.js.map