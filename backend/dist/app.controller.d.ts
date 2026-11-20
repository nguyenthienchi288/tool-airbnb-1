import { Response } from 'express';
import { AppConfigService } from './config/app-config.service';
import { DatabaseService } from './modules/database/database.service';
import { ExporterService } from './modules/exporter/exporter.service';
export declare class AppController {
    private readonly appConfig;
    private readonly db;
    private readonly exporter;
    constructor(appConfig: AppConfigService, db: DatabaseService, exporter: ExporterService);
    getVersion(res: Response): {
        status: string;
        version: string;
        shortVersion: string;
        updatedAt: string;
        changelog: string[];
        proxyConfigured: boolean;
    };
    getListings(locationQuery?: string, search?: string, page?: string, limit?: string): {
        items: any;
        total: number;
        page: number;
        limit: number;
        stats: {
            totalRooms: number;
            uniqueHosts: number;
            avgPrice: number;
            totalHostRooms: number;
        };
    };
    exportHomes(cityName: string, res: Response): Promise<void>;
    exportMaster(res: Response): Promise<void>;
    exportHostRooms(cityName: string, res: Response): Promise<void>;
    getReports(): {
        files: {
            name: string;
            sizeBytes: number;
            updatedAt: string;
        }[];
    };
    downloadReport(filename: string, res: Response): void;
}
