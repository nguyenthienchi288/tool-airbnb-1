export interface SystemVersionResponse {
  status: string;
  version: string;
  shortVersion: string;
  updatedAt: string;
  changelog: string[];
  proxyConfigured: boolean;
  proxyServerMasked?: string;
}

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'success' | 'warn' | 'error' | 'step';
  message: string;
}

export interface HeartbeatPayload {
  elapsedSeconds: number;
  idleSeconds: number;
  currentAction: string;
  savedCount: number;
}

export type PauseMode = 'running' | 'paused' | 'paused_503';

export interface PauseStatePayload {
  status: PauseMode;
  countdownSeconds: number;
  reason?: string;
}

export interface RoomItem {
  listing_id: string;
  location_query: string;
  check_in: string;
  check_out: string;
  nights: number;
  title: string;
  url: string;
  room_type: string;
  max_guests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  price_per_night: number;
  total_price: number;
  currency: string;
  images_count: number;
  lat: number | null;
  lng: number | null;
  amenities_json: string;
  building_name?: string;
  is_high_rise?: number;
  host_id: string;
  host_name: string;
  host_url: string;
  scraped_at: string;
}

export interface ListingsResponse {
  items: RoomItem[];
  total: number;
  page: number;
  limit: number;
  stats: {
    totalRooms: number;
    uniqueHosts: number;
    avgPrice: number;
    totalHostRooms: number;
  };
}

export interface ReportFile {
  name: string;
  sizeBytes: number;
  updatedAt: string;
}

export interface IpTraceInfo {
  ip: string;
  loc: string;
  warp: string;
  checkedAt: string;
}
