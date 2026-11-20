import {
  AIRBNB_BASE_URL,
  DEFAULT_PRICE_BUCKETS_VND,
  PriceBucketConfig,
} from '../config/constants';
import { ProxyConfig } from './types';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomDelay(minMs = 600, maxMs = 1400): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return sleep(ms);
}

export function cleanControlChars(text: unknown): string {
  if (!text) return '';
  return String(text)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?b>/gi, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .trim();
}

export function decodeAirbnbId(rawId: unknown): string | null {
  if (!rawId) return null;
  const str = String(rawId).trim();
  if (/^\d+$/.test(str)) return str;

  try {
    const decoded = Buffer.from(str, 'base64').toString('utf8');
    if (decoded.includes(':')) {
      const parts = decoded.split(':');
      const candidate = parts[parts.length - 1].trim();
      if (/^\d+$/.test(candidate)) {
        return candidate;
      }
    }
    const match = decoded.match(/(\d{5,})/);
    if (match) return match[1];
  } catch {
    // Ignore decode failure
  }

  const fallbackMatch = str.match(/(\d{5,})/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

export function buildListingUrl(listingId: string): string {
  return `${AIRBNB_BASE_URL}/rooms/${listingId}`;
}

export function buildHostProfileUrl(hostId: string): string {
  return `${AIRBNB_BASE_URL}/users/show/${hostId}`;
}

export function buildSearchUrl(params: {
  cityName: string;
  checkIn: string;
  checkOut: string;
  minPrice?: number;
  maxPrice?: number | null;
  entireHomeOnly?: boolean;
  currency?: string;
}): string {
  const {
    cityName,
    checkIn,
    checkOut,
    minPrice,
    maxPrice,
    entireHomeOnly = true,
    currency = 'VND',
  } = params;

  let url =
    `${AIRBNB_BASE_URL}/s/${encodeURIComponent(cityName)}/homes` +
    `?currency=${encodeURIComponent(currency)}`;

  if (checkIn && checkOut) {
    url += `&checkin=${encodeURIComponent(checkIn)}&checkout=${encodeURIComponent(checkOut)}`;
  }

  if (entireHomeOnly) {
    url += `&room_types%5B%5D=${encodeURIComponent('Entire home/apt')}`;
  }
  if (typeof minPrice === 'number' && minPrice > 0) {
    url += `&price_min=${Math.round(minPrice)}`;
  }
  if (typeof maxPrice === 'number' && maxPrice > 0) {
    url += `&price_max=${Math.round(maxPrice)}`;
  }

  return url;
}

export function parsePriceBucketsText(raw?: string): PriceBucketConfig[] {
  const text = (raw || '').trim();
  if (!text) return [...DEFAULT_PRICE_BUCKETS_VND];

  const parsed: PriceBucketConfig[] = [];
  for (const part of text.split(',')) {
    const token = part.trim();
    if (!token) continue;
    if (token.endsWith('+')) {
      const min = parseInt(token.slice(0, -1).replace(/[^\d]/g, ''), 10);
      if (!Number.isNaN(min)) {
        parsed.push({ min, max: null, label: `Trên ${Math.round(min / 1000)}k` });
      }
      continue;
    }
    const [a, b] = token.split('-').map((x) => parseInt(x.replace(/[^\d]/g, ''), 10));
    if (!Number.isNaN(a) && !Number.isNaN(b) && b > a) {
      parsed.push({
        min: a,
        max: b,
        label: `${Math.round(a / 1000)}k - ${Math.round(b / 1000)}k`,
      });
    }
  }
  return parsed.length > 0 ? parsed : [...DEFAULT_PRICE_BUCKETS_VND];
}

export function buildRoomUrl(roomId: string, checkIn: string, checkOut: string): string {
  if (checkIn && checkOut) {
    return `${AIRBNB_BASE_URL}/rooms/${roomId}?check_in=${encodeURIComponent(checkIn)}&check_out=${encodeURIComponent(checkOut)}&locale=en`;
  }
  return `${AIRBNB_BASE_URL}/rooms/${roomId}?locale=en`;
}

export function parseProxyUrl(raw?: string): ProxyConfig | undefined {
  const value = (raw || '').trim();
  if (!value) return undefined;

  // Hỗ trợ định dạng phổ biến host:port:user:pass
  if (!value.includes('://') && !value.includes('@')) {
    const parts = value.split(':');
    if (parts.length === 4 && /^\d+$/.test(parts[1])) {
      return {
        server: `http://${parts[0]}:${parts[1]}`,
        username: parts[2],
        password: parts[3],
      };
    }
    if (parts.length === 2 && /^\d+$/.test(parts[1])) {
      return {
        server: `http://${parts[0]}:${parts[1]}`,
      };
    }
  }

  try {
    const normalized = value.includes('://') ? value : `http://${value}`;
    const parsed = new URL(normalized);
    return {
      server: `${parsed.protocol}//${parsed.host}`,
      username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
      password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    };
  } catch {
    return { server: value };
  }
}

export function calculateNights(checkIn: string, checkOut: string): number {
  const d1 = new Date(checkIn);
  const d2 = new Date(checkOut);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime())) return 1;
  const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, diff);
}

/**
 * Extract pure numeric amount from localized price strings (e.g., "$125", "₫1,450,000", "1.450.000 ₫").
 */
export function parseNumericAmount(priceText: unknown): number {
  if (typeof priceText === 'number' && Number.isFinite(priceText)) {
    return Math.max(0, Math.round(priceText * 100) / 100);
  }
  if (!priceText || typeof priceText !== 'string') return 0;

  const cleaned = priceText.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return 0;

  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    // e.g. 1,234.56 or 1.234,56
    const lastComma = cleaned.lastIndexOf(',');
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot > lastComma) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    }
  } else if (cleaned.includes(',')) {
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 3) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(',', '.');
    }
  } else if (cleaned.includes('.')) {
    const parts = cleaned.split('.');
    if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
      normalized = cleaned.replace(/\./g, '');
    }
  }

  const num = parseFloat(normalized);
  return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : 0;
}

export function detectCurrencyFromText(priceText: unknown, fallback = 'USD'): string {
  if (!priceText || typeof priceText !== 'string') return fallback;
  if (priceText.includes('₫') || /vnd/i.test(priceText)) return 'VND';
  if (priceText.includes('$') || /usd/i.test(priceText)) return 'USD';
  if (priceText.includes('€') || /eur/i.test(priceText)) return 'EUR';
  if (priceText.includes('฿') || /thb/i.test(priceText)) return 'THB';
  return fallback;
}

export function normalizePriceBreakdown(
  priceText: unknown,
  qualifierText = '',
  nights = 1,
): { pricePerNight: number; totalPrice: number } {
  const amount = parseNumericAmount(priceText);
  if (amount <= 0) return { pricePerNight: 0, totalPrice: 0 };

  const q = (qualifierText || '').toLowerCase();
  const nightMatch = q.match(/(\d+)\s*(đêm|nights?)/i);
  if (nightMatch) {
    const n = Math.max(1, parseInt(nightMatch[1], 10));
    const perNight = Math.round(amount / n);
    return { pricePerNight: perNight, totalPrice: Math.round(amount) };
  }

  if (q.includes('tổng') || q.includes('total')) {
    const perNight = Math.round(amount / Math.max(1, nights));
    return { pricePerNight: perNight, totalPrice: Math.round(amount) };
  }

  // Per-night price (normalized integer)
  const perNight = Math.round(amount);
  return {
    pricePerNight: perNight,
    totalPrice: Math.round(perNight * Math.max(1, nights)),
  };
}

export function findObjectsWhere(
  root: any,
  predicate: (obj: any) => boolean,
  results: any[] = [],
  visited: WeakSet<object> = new WeakSet(),
): any[] {
  if (!root || typeof root !== 'object') return results;
  if (visited.has(root)) return results;
  visited.add(root);

  if (Array.isArray(root)) {
    for (const item of root) {
      findObjectsWhere(item, predicate, results, visited);
    }
    return results;
  }

  if (predicate(root)) {
    results.push(root);
  }

  for (const key of Object.keys(root)) {
    const val = root[key];
    if (val && typeof val === 'object') {
      findObjectsWhere(val, predicate, results, visited);
    }
  }
  return results;
}

export function formatDateStamp(date = new Date()): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function sanitizeFilename(name: string): string {
  return String(name || 'Unknown')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Khoảng cách Haversine (mét) giữa 2 tọa độ GPS.
 */
export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Kiểm tra tiêu đề căn hộ có phải trang báo lỗi/chặn của Airbnb hay không
 * (VD: "Stay tuned", "Airbnb is temporarily unavailable", "Error code: 503").
 */
export function isInvalidBlockedTitle(title?: string | null): boolean {
  const t = String(title || '').trim().toLowerCase();
  if (!t) return true;
  return (
    t === 'stay tuned' ||
    t.includes('stay tuned') ||
    t.includes('temporarily unavailable') ||
    t.includes('error code: 503') ||
    t.includes('pardon our interruption') ||
    t.includes('429 too many requests') ||
    t.includes('verify you are human')
  );
}
