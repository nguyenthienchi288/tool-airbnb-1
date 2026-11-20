import { DeepExtractedRoom, SevenNightsPreviewData } from './types';
export declare function buildSevenNightsPreview(extractedRooms: DeepExtractedRoom[], defaultCity?: string, photoPathPrefix?: string): SevenNightsPreviewData;
export declare function exportSevenNightsBundle(params: {
    outputDir: string;
    locationLabel: string;
    rooms: DeepExtractedRoom[];
    downloadPhotos: boolean;
    onLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error' | 'step') => void;
}): Promise<{
    bundleName: string;
    bundleDir: string;
    sevenNightsExcelFile: string;
    rawExcelFile: string;
    rawJsonFile: string;
    zipFileName: string;
    totalPhotosDownloaded: number;
    preview: SevenNightsPreviewData;
}>;
