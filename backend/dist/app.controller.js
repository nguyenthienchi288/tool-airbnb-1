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
exports.AppController = void 0;
const common_1 = require("@nestjs/common");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const app_config_service_1 = require("./config/app-config.service");
const constants_1 = require("./config/constants");
const database_service_1 = require("./modules/database/database.service");
const exporter_service_1 = require("./modules/exporter/exporter.service");
const CHANGELOG = [
    'Chế độ trình duyệt thật có giao diện (Headful 1366x768, vi-VN, Asia/Ho_Chi_Minh) chống bot 429',
    'Mở song song 1–5 Tab (mặc định 3 Tab) cuộn chuột mượt & bấm chuyển trang từ Trang 1 đến Trang 15',
    'Bắt trọn JSON StaysSearch / ExploreLayout & StaysPdpSections từ Network Response, lưu tức thì vào SQLite',
    'Smart Incremental Crawl: Tự động bỏ qua các căn hộ đã có đủ chi tiết & tiện nghi trong SQLite',
];
let AppController = class AppController {
    appConfig;
    db;
    exporter;
    constructor(appConfig, db, exporter) {
        this.appConfig = appConfig;
        this.db = db;
        this.exporter = exporter;
    }
    getVersion(res) {
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
        return {
            status: 'connected',
            version: constants_1.APP_VERSION,
            shortVersion: constants_1.SHORT_VERSION,
            updatedAt: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
            changelog: CHANGELOG,
            proxyConfigured: Boolean(this.appConfig.proxy),
        };
    }
    getListings(locationQuery, search, page, limit) {
        return this.db.getRooms({
            locationQuery: locationQuery?.trim() || undefined,
            search: search?.trim() || undefined,
            page: page ? Number(page) : 1,
            limit: limit ? Number(limit) : 50,
        });
    }
    async exportHomes(cityName, res) {
        const { filePath, fileName } = await this.exporter.exportCitySummaryReport(cityName?.trim() || undefined);
        return res.download(filePath, fileName);
    }
    async exportMaster(res) {
        const { filePath, fileName } = await this.exporter.exportMasterCityComparison();
        return res.download(filePath, fileName);
    }
    async exportHostRooms(cityName, res) {
        const { filePath, fileName } = await this.exporter.exportHostRoomsExcel(cityName?.trim() || undefined);
        return res.download(filePath, fileName);
    }
    getReports() {
        const outputDir = this.appConfig.outputDir;
        if (!fs.existsSync(outputDir))
            return { files: [] };
        const files = fs
            .readdirSync(outputDir)
            .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
            .map((name) => {
            const stat = fs.statSync(path.join(outputDir, name));
            return {
                name,
                sizeBytes: stat.size,
                updatedAt: stat.mtime.toISOString(),
            };
        })
            .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
        return { files };
    }
    downloadReport(filename, res) {
        const safeName = path.basename(filename || '');
        if (!safeName || !safeName.toLowerCase().endsWith('.xlsx')) {
            throw new common_1.BadRequestException('Tên file không hợp lệ.');
        }
        const filePath = path.join(this.appConfig.outputDir, safeName);
        if (!fs.existsSync(filePath)) {
            throw new common_1.NotFoundException('Không tìm thấy file báo cáo.');
        }
        return res.download(filePath, safeName);
    }
};
exports.AppController = AppController;
__decorate([
    (0, common_1.Get)('system/version'),
    __param(0, (0, common_1.Res)({ passthrough: true })),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getVersion", null);
__decorate([
    (0, common_1.Get)('listings'),
    __param(0, (0, common_1.Query)('locationQuery')),
    __param(1, (0, common_1.Query)('search')),
    __param(2, (0, common_1.Query)('page')),
    __param(3, (0, common_1.Query)('limit')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getListings", null);
__decorate([
    (0, common_1.Get)('export/homes'),
    __param(0, (0, common_1.Query)('cityName')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "exportHomes", null);
__decorate([
    (0, common_1.Get)('export/master'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "exportMaster", null);
__decorate([
    (0, common_1.Get)('export/host-rooms'),
    __param(0, (0, common_1.Query)('cityName')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AppController.prototype, "exportHostRooms", null);
__decorate([
    (0, common_1.Get)('reports'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], AppController.prototype, "getReports", null);
__decorate([
    (0, common_1.Get)('reports/download/:filename'),
    __param(0, (0, common_1.Param)('filename')),
    __param(1, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", void 0)
], AppController.prototype, "downloadReport", null);
exports.AppController = AppController = __decorate([
    (0, common_1.Controller)('api'),
    __metadata("design:paramtypes", [app_config_service_1.AppConfigService,
        database_service_1.DatabaseService,
        exporter_service_1.ExporterService])
], AppController);
//# sourceMappingURL=app.controller.js.map