export interface ReverseGeoResult {
    buildingName: string;
    address: string;
    district: string;
    city: string;
    country: string;
    lat?: number;
    lng?: number;
}
export declare function isBlacklistedBuildingName(name: string): boolean;
export declare function extractBuildingNameFromText(text: string): string;
export declare function searchAddressByBuildingName(buildingName: string, district: string, city: string): Promise<ReverseGeoResult | null>;
export declare function reverseGeocodeCoords(lat: number | null, lng: number | null): Promise<ReverseGeoResult | null>;
