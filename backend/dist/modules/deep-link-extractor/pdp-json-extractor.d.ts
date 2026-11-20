export interface StructuredPdpJsonData {
    title: string;
    description: string;
    gettingAround: string;
    guestInteraction: string;
    availableAmenities: string[];
    unavailableAmenities: string[];
    personCapacity: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    checkInTime: string;
    checkOutTime: string;
    childPolicy: string;
    houseRulesItems: string[];
    hostId: string;
    hostName: string;
    lat: number | null;
    lng: number | null;
    locationSubtitle: string;
    photoUrls: string[];
}
export declare function normalizeUnicodeSpaces(text: string): string;
export declare function isValidHostName(name: string): boolean;
export declare function extractStructuredPdpFromJson(jsonRoots: unknown[]): StructuredPdpJsonData;
