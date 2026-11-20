import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../database/database.service';
export declare class ExporterService {
    private readonly appConfig;
    private readonly db;
    constructor(appConfig: AppConfigService, db: DatabaseService);
    private ensureOutputDir;
    private styleHeaderRow;
    private mapDbRowToRoom;
    private populateDetailedRoomsSheet;
    exportCitySummaryReport(cityName?: string): Promise<{
        filePath: string;
        fileName: string;
    }>;
    exportMasterCityComparison(): Promise<{
        filePath: string;
        fileName: string;
    }>;
    exportAllReports(cityName?: string): Promise<{
        cityReport: {
            filePath: string;
            fileName: string;
        };
        masterReport: {
            filePath: string;
            fileName: string;
        };
    }>;
    exportHomesExcel(cityName?: string): Promise<{
        filePath: string;
        fileName: string;
    }>;
    exportHostRoomsExcel(cityName?: string): Promise<{
        filePath: string;
        fileName: string;
    }>;
}
