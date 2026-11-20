export interface ProxyConfig {
    server: string;
    username?: string;
    password?: string;
}
export type CollectionStatus = 'Mới thu thập' | 'Dữ liệu có sẵn' | 'Chưa đọc PDP (Dừng sớm)';
export interface RoomRecord {
    listing_id: string;
    location_query: string;
    checkin: string;
    checkout: string;
    nights: number;
    title: string;
    url: string;
    subtitle: string;
    guests_text: string;
    bedrooms_text: string;
    beds_text: string;
    bathrooms_text: string;
    guests: number;
    bedrooms: number;
    beds: number;
    bathrooms: number;
    description: string;
    price_per_night: number;
    total_price: number;
    price_raw: string;
    total_price_raw: string;
    currency: string;
    rating?: number;
    reviews_count?: number;
    location_text?: string;
    building_name?: string;
    is_high_rise?: number;
    collection_status?: CollectionStatus;
    images_count: number;
    lat: number | null;
    lng: number | null;
    amenities: string[];
    host_id: string;
    host_name: string;
    host_url: string;
    pdp_scraped?: number;
    updated_at?: string;
}
export interface HostListingRecord extends RoomRecord {
    owner_host_id: string;
    owner_host_name: string;
    is_in_target?: number;
}
export interface DateWindow {
    checkIn: string;
    checkOut: string;
    label?: string;
}
export interface SearchCombination {
    index: number;
    total: number;
    keyword: string;
    checkIn: string;
    checkOut: string;
    dateLabel: string;
    nights: number;
    bucket: {
        min: number;
        max: number | null;
        label: string;
        splitDepth?: number;
    };
}
export interface CrawlJobInput {
    cityName: string;
    keywords?: string[];
    checkIn: string;
    checkOut: string;
    dateWindows?: DateWindow[];
    autoGenerateStrategicDates?: boolean;
    includeFlexibleDates?: boolean;
    maxPages: number;
    tabsCount: number;
    humanLikeMode: boolean;
    enablePriceSlicing: boolean;
    priceBucketsText?: string;
    entireHomeOnly: boolean;
    includeHostRooms: boolean;
    proxyUrl?: string;
    useWarpProxy?: boolean;
}
export interface CrawlJobResult {
    cityName: string;
    stoppedEarly?: boolean;
    stoppedAtStep?: number;
    totalUrls: number;
    totalRooms: number;
    totalHosts: number;
    totalHostRooms: number;
    cityReportFile: string;
    masterReportFile: string;
}
export interface LogEntry {
    timestamp: string;
    level: 'info' | 'success' | 'warn' | 'error' | 'step';
    message: string;
}
