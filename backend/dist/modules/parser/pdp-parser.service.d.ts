import { Page } from 'playwright';
import { RoomRecord } from '../../common/types';
export declare class PdpParserService {
    extractPriceFromBookIt(bookItData: any, nights?: number): {
        priceRaw: string;
        totalPriceRaw: string;
        pricePerNight: number;
        totalPrice: number;
        currency: string;
    };
    private parseOverviewItems;
    detectBuildingAndHighRise(params: {
        title?: string;
        subtitle?: string;
        description?: string;
        locationText?: string;
        amenities?: string[];
    }): {
        buildingName: string;
        isHighRise: number;
    };
    private cleanHostName;
    extractFromPage(params: {
        page: Page;
        listingId: string;
        url: string;
        locationQuery: string;
        checkIn: string;
        checkOut: string;
        nights: number;
        bookItData: any;
    }): Promise<RoomRecord | null>;
    extractSearchListingsFromJson(jsonData: any, meta: {
        locationQuery: string;
        checkIn: string;
        checkOut: string;
        nights: number;
    }): RoomRecord[];
}
