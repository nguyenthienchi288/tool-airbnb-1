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
exports.BuildingsController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const buildings_service_1 = require("./buildings.service");
let BuildingsController = class BuildingsController {
    buildingsService;
    constructor(buildingsService) {
        this.buildingsService = buildingsService;
    }
    async exportClusters(body) {
        const result = await this.buildingsService.exportClustersExcel(body?.cityName);
        return {
            fileName: result.fileName,
            downloadUrl: `/api/reports/download/${encodeURIComponent(result.fileName)}`,
            totalClusters: result.totalClusters,
            totalRooms: result.totalRooms,
        };
    }
    async importClusters(file, cityName) {
        if (!file || !file.buffer || file.buffer.length === 0) {
            throw new common_1.BadRequestException('Vui lòng chọn file Excel (.xlsx) hợp lệ để tải lên.');
        }
        return this.buildingsService.importClustersExcel(file.buffer, cityName);
    }
};
exports.BuildingsController = BuildingsController;
__decorate([
    (0, common_1.Post)('export-clusters'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BuildingsController.prototype, "exportClusters", null);
__decorate([
    (0, common_1.Post)('import-clusters'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file')),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)('cityName')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], BuildingsController.prototype, "importClusters", null);
exports.BuildingsController = BuildingsController = __decorate([
    (0, common_1.Controller)('api/buildings'),
    __metadata("design:paramtypes", [buildings_service_1.BuildingsService])
], BuildingsController);
//# sourceMappingURL=buildings.controller.js.map