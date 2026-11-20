import { Page, Response } from 'playwright';
export declare class HostParserService {
    collectHostRoomIds(page: Page, hostUrl: string, onNavigated?: (response: Response | null) => Promise<void>): Promise<string[]>;
}
