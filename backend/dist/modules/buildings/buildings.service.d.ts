import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../database/database.service';
import { ExporterService } from '../exporter/exporter.service';
export declare class BuildingsService {
    private readonly appConfig;
    private readonly db;
    private readonly exporter;
    constructor(appConfig: AppConfigService, db: DatabaseService, exporter: ExporterService);
    private ensureOutputDir;
    private runDbscan;
    private mostFrequentNonEmpty;
    exportClustersExcel(cityName?: string): Promise<{
        filePath: string;
        fileName: string;
        totalClusters: number;
        totalRooms: number;
    }>;
    private rebuildBuildingClusters;
    private extractCellText;
    importClustersExcel(fileBuffer: Buffer, cityName?: string): Promise<{
        importedClusters: number;
        updatedRooms: number;
        cityReportFile: string;
        masterReportFile: string;
        message: string;
    }>;
}
