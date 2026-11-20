export declare const APP_VERSION = "v4.2.0 - Tab 2 High-Precision JSON & Korean Building Deep Parser";
export declare const SHORT_VERSION = "v4.2.0";
export declare const AIRBNB_BASE_URL = "https://www.airbnb.com.vn";
export declare const AIRBNB_API_KEY = "d306zoyjsyarp7ifhu67rjxn52tv0t20";
export declare const DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
export interface PriceBucketConfig {
    min: number;
    max: number | null;
    label: string;
    splitDepth?: number;
}
export declare const DEFAULT_PRICE_BUCKETS_VND: PriceBucketConfig[];
export declare const DEFAULT_PRICE_BUCKETS_TEXT = "0-500000, 500000-750000, 750000-1000000, 1000000-1300000, 1300000-1700000, 1700000-2200000, 2200000-3000000, 3000000-4500000, 4500000-8000000, 8000000+";
export declare const SEOUL_PRICE_BUCKETS_VND: PriceBucketConfig[];
export declare const SEOUL_PRICE_BUCKETS_TEXT = "0-1000000, 1000001-1500000, 1500001-2200000, 2200001-3200000, 3200001-5000000, 5000001+";
export declare const SEOUL_CITY_VARIANTS: string[];
export declare const SEOUL_DISTRICT_GROUPS: {
    cbd: string[];
    northwest: string[];
    south: string[];
};
export declare const KNOWN_BUILDING_REGEX: RegExp;
export declare const HIGH_RISE_KEYWORDS: string[];
