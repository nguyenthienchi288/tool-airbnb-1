import { BoundsStatus, ParsedAirbnbUrl } from './types';
export declare function parseAirbnbSearchUrl(rawUrl: string): ParsedAirbnbUrl;
export declare function checkBoundingBox(lat: number | null, lng: number | null, mapBounds: ParsedAirbnbUrl['mapBounds'], jitterToleranceDeg?: number): {
    status: BoundsStatus;
    label: string;
};
