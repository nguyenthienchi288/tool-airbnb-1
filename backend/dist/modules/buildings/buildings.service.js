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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BuildingsService = void 0;
const common_1 = require("@nestjs/common");
const ExcelJS = __importStar(require("exceljs"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const helpers_1 = require("../../common/helpers");
const app_config_service_1 = require("../../config/app-config.service");
const database_service_1 = require("../database/database.service");
const exporter_service_1 = require("../exporter/exporter.service");
let BuildingsService = class BuildingsService {
    appConfig;
    db;
    exporter;
    constructor(appConfig, db, exporter) {
        this.appConfig = appConfig;
        this.db = db;
        this.exporter = exporter;
    }
    ensureOutputDir() {
        const dir = this.appConfig.outputDir;
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }
    runDbscan(rooms, epsMeters = 50) {
        const n = rooms.length;
        const visited = new Uint8Array(n);
        const assigned = new Uint8Array(n);
        const clusters = [];
        const regionQuery = (idx) => {
            const p = rooms[idx];
            const neighbors = [];
            for (let j = 0; j < n; j++) {
                if ((0, helpers_1.haversineMeters)(p.lat, p.lng, rooms[j].lat, rooms[j].lng) <= epsMeters) {
                    neighbors.push(j);
                }
            }
            return neighbors;
        };
        for (let i = 0; i < n; i++) {
            if (visited[i])
                continue;
            visited[i] = 1;
            const neighbors = regionQuery(i);
            const clusterIndices = [];
            const queue = [...neighbors];
            assigned[i] = 1;
            clusterIndices.push(i);
            while (queue.length > 0) {
                const current = queue.shift();
                if (!visited[current]) {
                    visited[current] = 1;
                    const currentNeighbors = regionQuery(current);
                    for (const nb of currentNeighbors) {
                        if (!assigned[nb]) {
                            queue.push(nb);
                        }
                    }
                }
                if (!assigned[current]) {
                    assigned[current] = 1;
                    clusterIndices.push(current);
                }
            }
            clusters.push(clusterIndices.map((idx) => rooms[idx]));
        }
        return clusters.sort((a, b) => b.length - a.length);
    }
    mostFrequentNonEmpty(values) {
        const counts = new Map();
        for (const v of values) {
            const clean = (0, helpers_1.cleanControlChars)(v);
            if (!clean)
                continue;
            counts.set(clean, (counts.get(clean) || 0) + 1);
        }
        let best = '';
        let bestCount = 0;
        for (const [k, c] of counts.entries()) {
            if (c > bestCount) {
                best = k;
                bestCount = c;
            }
        }
        return best;
    }
    async exportClustersExcel(cityName) {
        const rawRows = this.db.getRoomsWithValidCoords(cityName);
        const rooms = rawRows.map((r) => ({
            listing_id: String(r.listing_id || ''),
            location_query: String(r.location_query || ''),
            location_text: String(r.location_text || ''),
            title: String(r.title || ''),
            building_name: String(r.building_name || ''),
            lat: Number(r.lat),
            lng: Number(r.lng),
        }));
        if (rooms.length === 0) {
            throw new common_1.BadRequestException('Chưa có căn hộ nào có tọa độ GPS (lat, lng) hợp lệ trong SQLite để gom cụm.');
        }
        const rawClusters = this.runDbscan(rooms, 50);
        const wb = new ExcelJS.Workbook();
        wb.creator = 'Airbnb Market Intelligence v3.6.0';
        const sheet = wb.addWorksheet('Danh_Sach_Cum_Toa_Nha');
        const columns = [
            { header: 'Cluster_ID', key: 'Cluster_ID', width: 16 },
            { header: 'So_Luong_Can', key: 'So_Luong_Can', width: 14 },
            { header: 'Center_Lat', key: 'Center_Lat', width: 14 },
            { header: 'Center_Lng', key: 'Center_Lng', width: 14 },
            { header: 'Google_Maps_Link', key: 'Google_Maps_Link', width: 42 },
            { header: 'Khu_Vuc_Hien_Tai', key: 'Khu_Vuc_Hien_Tai', width: 26 },
            { header: 'Ten_Cac_Can_Ho_Mau', key: 'Ten_Cac_Can_Ho_Mau', width: 65 },
            { header: 'Ten_Toa_Nha_Goi_Y_Cu', key: 'Ten_Toa_Nha_Goi_Y_Cu', width: 28 },
            { header: 'Ten_Toa_Nha_Chuan', key: 'Ten_Toa_Nha_Chuan', width: 32 },
            { header: 'Ghi_Chu_Dia_Chi', key: 'Ghi_Chu_Dia_Chi', width: 34 },
        ];
        sheet.columns = columns;
        const headerRow = sheet.getRow(1);
        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
        headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        headerRow.height = 28;
        sheet.views = [{ state: 'frozen', ySplit: 1 }];
        const dbClusters = [];
        rawClusters.forEach((group, idx) => {
            const clusterId = `CLUSTER_${String(idx + 1).padStart(3, '0')}`;
            const centerLat = Number((group.reduce((s, r) => s + r.lat, 0) / group.length).toFixed(6));
            const centerLng = Number((group.reduce((s, r) => s + r.lng, 0) / group.length).toFixed(6));
            const mapsLink = `https://www.google.com/maps?q=${centerLat},${centerLng}`;
            const khuVuc = this.mostFrequentNonEmpty(group.map((r) => r.location_text)) ||
                this.mostFrequentNonEmpty(group.map((r) => r.location_query));
            const sampleTitles = Array.from(new Set(group
                .map((r) => (0, helpers_1.cleanControlChars)(r.title))
                .filter((t) => t && !(0, helpers_1.isInvalidBlockedTitle)(t)))).slice(0, 5);
            const oldSuggestion = this.mostFrequentNonEmpty(group.map((r) => r.building_name));
            const cached = this.db.findCachedBuildingByCoords(centerLat, centerLng, 50);
            const row = sheet.addRow({
                Cluster_ID: clusterId,
                So_Luong_Can: group.length,
                Center_Lat: centerLat,
                Center_Lng: centerLng,
                Google_Maps_Link: mapsLink,
                Khu_Vuc_Hien_Tai: khuVuc,
                Ten_Cac_Can_Ho_Mau: sampleTitles.join(' | '),
                Ten_Toa_Nha_Goi_Y_Cu: oldSuggestion,
                Ten_Toa_Nha_Chuan: cached?.building_name || '',
                Ghi_Chu_Dia_Chi: cached?.address_note || '',
            });
            row.getCell('Center_Lat').numFmt = '0.000000';
            row.getCell('Center_Lng').numFmt = '0.000000';
            row.getCell('Google_Maps_Link').value = {
                text: mapsLink,
                hyperlink: mapsLink,
            };
            dbClusters.push({
                cluster_id: clusterId,
                listing_ids: group.map((r) => r.listing_id),
                center_lat: centerLat,
                center_lng: centerLng,
                building_name: cached?.building_name || oldSuggestion || '',
                address_note: cached?.address_note || '',
            });
        });
        sheet.autoFilter = {
            from: { row: 1, column: 1 },
            to: { row: 1, column: columns.length },
        };
        this.db.replaceBuildingClusters(cityName?.trim() || 'All', dbClusters);
        const dir = this.ensureOutputDir();
        const safeCity = (0, helpers_1.sanitizeFilename)(cityName?.trim() || 'All');
        const dateStamp = (0, helpers_1.formatDateStamp)(new Date());
        const fileName = `Cum_Toa_Nha_Can_Giai_Ma_${safeCity}_${dateStamp}.xlsx`;
        const filePath = path.join(dir, fileName);
        await wb.xlsx.writeFile(filePath);
        return {
            filePath,
            fileName,
            totalClusters: dbClusters.length,
            totalRooms: rooms.length,
        };
    }
    rebuildBuildingClusters(cityName) {
        const rawRows = this.db.getRoomsWithValidCoords(cityName);
        const rooms = rawRows.map((r) => ({
            listing_id: String(r.listing_id || ''),
            location_query: String(r.location_query || ''),
            location_text: String(r.location_text || ''),
            title: String(r.title || ''),
            building_name: String(r.building_name || ''),
            lat: Number(r.lat),
            lng: Number(r.lng),
        }));
        if (rooms.length === 0) {
            return 0;
        }
        const rawClusters = this.runDbscan(rooms, 50);
        const dbClusters = rawClusters.map((group, idx) => {
            const clusterId = `CLUSTER_${String(idx + 1).padStart(3, '0')}`;
            const centerLat = Number((group.reduce((s, r) => s + r.lat, 0) / group.length).toFixed(6));
            const centerLng = Number((group.reduce((s, r) => s + r.lng, 0) / group.length).toFixed(6));
            const oldSuggestion = this.mostFrequentNonEmpty(group.map((r) => r.building_name));
            const cached = this.db.findCachedBuildingByCoords(centerLat, centerLng, 50);
            return {
                cluster_id: clusterId,
                listing_ids: group.map((r) => r.listing_id),
                center_lat: centerLat,
                center_lng: centerLng,
                building_name: cached?.building_name || oldSuggestion || '',
                address_note: cached?.address_note || '',
            };
        });
        this.db.replaceBuildingClusters(cityName?.trim() || 'All', dbClusters);
        return dbClusters.length;
    }
    extractCellText(val) {
        if (val === null || val === undefined)
            return '';
        if (typeof val === 'object') {
            if ('text' in val && typeof val.text === 'string')
                return val.text.trim();
            if ('result' in val && val.result !== undefined)
                return String(val.result).trim();
            if ('richText' in val && Array.isArray(val.richText)) {
                return val.richText.map((rt) => rt.text).join('').trim();
            }
        }
        return String(val).trim();
    }
    async importClustersExcel(fileBuffer, cityName) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(fileBuffer);
        const sheet = wb.getWorksheet('Danh_Sach_Cum_Toa_Nha') || wb.worksheets[0];
        if (!sheet) {
            throw new common_1.BadRequestException('File Excel không có sheet dữ liệu hợp lệ.');
        }
        let headerRowNumber = 1;
        let colMap = new Map();
        const maxHeaderScan = Math.min(5, Math.max(1, sheet.rowCount));
        for (let r = 1; r <= maxHeaderScan; r++) {
            const row = sheet.getRow(r);
            const candidateMap = new Map();
            row.eachCell((cell, colNumber) => {
                const name = this.extractCellText(cell.value)
                    .replace(/\uFEFF/g, '')
                    .trim()
                    .toLowerCase();
                if (name)
                    candidateMap.set(name, colNumber);
            });
            if (candidateMap.has('cluster_id') && candidateMap.has('ten_toa_nha_chuan')) {
                headerRowNumber = r;
                colMap = candidateMap;
                break;
            }
            if (r === 1) {
                colMap = candidateMap;
            }
        }
        const clusterIdCol = colMap.get('cluster_id');
        const buildingNameCol = colMap.get('ten_toa_nha_chuan');
        if (!clusterIdCol || !buildingNameCol) {
            throw new common_1.BadRequestException('File Excel sai cấu trúc: Bắt buộc phải có 2 cột "Cluster_ID" và "Ten_Toa_Nha_Chuan".');
        }
        const latCol = colMap.get('center_lat');
        const lngCol = colMap.get('center_lng');
        const noteCol = colMap.get('ghi_chu_dia_chi');
        if (this.db.countBuildingClusters(cityName) === 0) {
            this.rebuildBuildingClusters(cityName);
        }
        let importedClusters = 0;
        let updatedRooms = 0;
        sheet.eachRow((row, rowNumber) => {
            if (rowNumber <= headerRowNumber)
                return;
            const clusterId = this.extractCellText(row.getCell(clusterIdCol).value)
                .trim()
                .toUpperCase();
            const buildingName = (0, helpers_1.cleanControlChars)(this.extractCellText(row.getCell(buildingNameCol).value));
            if (!clusterId ||
                !buildingName ||
                buildingName.toLowerCase() === 'chưa xác định' ||
                buildingName === '-') {
                return;
            }
            const addressNote = noteCol
                ? (0, helpers_1.cleanControlChars)(this.extractCellText(row.getCell(noteCol).value))
                : '';
            const rawLat = latCol ? Number(this.extractCellText(row.getCell(latCol).value)) : NaN;
            const rawLng = lngCol ? Number(this.extractCellText(row.getCell(lngCol).value)) : NaN;
            const updated = this.db.applyBuildingNameToCluster({
                clusterId,
                buildingName,
                addressNote,
                centerLat: Number.isFinite(rawLat) && rawLat !== 0 ? rawLat : null,
                centerLng: Number.isFinite(rawLng) && rawLng !== 0 ? rawLng : null,
                radiusMeters: 50,
            });
            if (updated > 0) {
                importedClusters++;
                updatedRooms += updated;
            }
        });
        const { cityReport, masterReport } = await this.exporter.exportAllReports(cityName?.trim() || undefined);
        const message = `Đã cập nhật ${importedClusters} cụm (${updatedRooms} căn hộ) vào database airbnb_market.db!`;
        return {
            importedClusters,
            updatedRooms,
            cityReportFile: cityReport.fileName,
            masterReportFile: masterReport.fileName,
            message,
        };
    }
};
exports.BuildingsService = BuildingsService;
exports.BuildingsService = BuildingsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [app_config_service_1.AppConfigService,
        database_service_1.DatabaseService,
        exporter_service_1.ExporterService])
], BuildingsService);
//# sourceMappingURL=buildings.service.js.map