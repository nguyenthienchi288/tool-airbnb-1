import { BuildingsService } from './buildings.service';
export declare class BuildingsController {
    private readonly buildingsService;
    constructor(buildingsService: BuildingsService);
    exportClusters(body?: {
        cityName?: string;
    }): Promise<{
        fileName: string;
        downloadUrl: string;
        totalClusters: number;
        totalRooms: number;
    }>;
    importClusters(file: {
        buffer: Buffer;
        originalname: string;
    } | undefined, cityName?: string): Promise<{
        importedClusters: number;
        updatedRooms: number;
        cityReportFile: string;
        masterReportFile: string;
        message: string;
    }>;
}
