import { BadRequestException } from '@nestjs/common';
import { calculateNights } from '../../common/helpers';
import { BoundsStatus, ParsedAirbnbUrl } from './types';

const KNOWN_PLACE_MAP: Record<string, { display: string; city: string; country: string }> = {
  首尔: { display: '首尔 (Seoul)', city: 'Seoul', country: 'South Korea' },
  서울: { display: '서울 (Seoul)', city: 'Seoul', country: 'South Korea' },
  서울특별시: { display: '서울특별시 (Seoul)', city: 'Seoul', country: 'South Korea' },
  seoul: { display: 'Seoul', city: 'Seoul', country: 'South Korea' },
  'seoul, south korea': { display: 'Seoul, South Korea', city: 'Seoul', country: 'South Korea' },
  busan: { display: 'Busan', city: 'Busan', country: 'South Korea' },
  부산: { display: '부산 (Busan)', city: 'Busan', country: 'South Korea' },
  tokyo: { display: 'Tokyo', city: 'Tokyo', country: 'Japan' },
  'ho chi minh city': { display: 'Ho Chi Minh City', city: 'Ho Chi Minh City', country: 'Vietnam' },
  hanoi: { display: 'Hanoi', city: 'Hanoi', country: 'Vietnam' },
  'da nang': { display: 'Da Nang', city: 'Da Nang', country: 'Vietnam' },
};

function parseNullableFloat(val: string | null): number | null {
  if (!val || !val.trim()) return null;
  const num = Number(val);
  return Number.isFinite(num) ? num : null;
}

function inferCityCountry(rawLoc: string): { display: string; city: string; country: string } {
  const clean = rawLoc.trim();
  if (!clean) return { display: 'Unknown', city: 'Unknown', country: '' };
  const key = clean.toLowerCase();
  if (KNOWN_PLACE_MAP[key]) return KNOWN_PLACE_MAP[key];
  if (key.includes('seoul') || clean.includes('首尔') || clean.includes('서울')) {
    return { display: `${clean} (Seoul)`, city: 'Seoul', country: 'South Korea' };
  }
  const firstSegment = clean.split(',')[0].trim();
  return {
    display: clean,
    city: firstSegment || clean,
    country: clean.includes('Korea') ? 'South Korea' : '',
  };
}

export function parseAirbnbSearchUrl(rawUrl: string): ParsedAirbnbUrl {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    throw new BadRequestException('Vui lòng dán đường dẫn URL Airbnb hợp lệ.');
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
  } catch {
    throw new BadRequestException('URL không đúng định dạng. Vui lòng kiểm tra lại.');
  }

  if (!/airbnb\./i.test(parsed.hostname)) {
    throw new BadRequestException('URL phải thuộc tên miền Airbnb (airbnb.com, airbnb.cn, airbnb.com.vn...).');
  }

  const pathMatch = parsed.pathname.match(/\/s\/([^/]+)/i);
  const rawLocationPath = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
  const inferred = inferCityCountry(rawLocationPath.replace(/--/g, ', '));
  const params = parsed.searchParams;

  const checkIn = (params.get('checkin') || '').trim();
  const checkOut = (params.get('checkout') || '').trim();
  const nights = checkIn && checkOut ? calculateNights(checkIn, checkOut) : 1;

  const neLat = parseNullableFloat(params.get('ne_lat'));
  const swLat = parseNullableFloat(params.get('sw_lat'));
  const neLng = parseNullableFloat(params.get('ne_lng'));
  const swLng = parseNullableFloat(params.get('sw_lng'));
  const hasBounds = neLat !== null && swLat !== null && neLng !== null && swLng !== null;

  return {
    originalUrl: parsed.toString(),
    platformLocation: {
      origin: parsed.origin,
      domain: parsed.hostname,
      rawLocationPath,
      locationDisplay: inferred.display,
      cityGuess: inferred.city,
      countryGuess: inferred.country,
      placeId: params.get('place_id') || '',
      source: params.get('source') || '',
      searchMode: params.get('search_mode') || '',
    },
    dates: {
      checkIn,
      checkOut,
      nights,
      datePickerType: params.get('date_picker_type') || '',
      flexibleTripLengths: params.getAll('flexible_trip_lengths[]'),
      monthlyStartDate: params.get('monthly_start_date') || '',
      monthlyLength: params.get('monthly_length') || '',
      monthlyEndDate: params.get('monthly_end_date') || '',
    },
    mapBounds: {
      neLat,
      swLat,
      neLng,
      swLng,
      zoom: params.get('zoom') || params.get('zoom_level') || '',
      searchByMap: params.get('search_by_map') === 'true',
      searchType: params.get('search_type') || '',
      hasBounds,
    },
    filters: {
      l2PropertyTypeIds: params.getAll('l2_property_type_ids[]'),
      roomTypes: params.getAll('room_types[]'),
      priceMin: params.get('price_min') || '',
      priceMax: params.get('price_max') || '',
      priceFilterNumNights: params.get('price_filter_num_nights') || '',
      channel: params.get('channel') || '',
      selectedFilterOrder: params.getAll('selected_filter_order[]'),
    },
    tracking: {
      refFsid: params.get('ref_fsid') || params.get('federated_search_session_id') || '',
      refSearchSessionId: params.get('ref_search_session_id') || '',
    },
  };
}

/**
 * Kiểm tra tọa độ phòng có nằm trong Bounding Box bản đồ hay không.
 * Cho phép sai số làm mờ vị trí Airbnb jitter (~0.0015 deg ≈ 150m).
 */
export function checkBoundingBox(
  lat: number | null,
  lng: number | null,
  mapBounds: ParsedAirbnbUrl['mapBounds'],
  jitterToleranceDeg = 0.0015,
): { status: BoundsStatus; label: string } {
  if (!mapBounds.hasBounds || lat === null || lng === null || lat === 0 || lng === 0) {
    return { status: 'unknown', label: 'Không có khung tọa độ' };
  }
  const { neLat, swLat, neLng, swLng } = mapBounds;
  if (neLat === null || swLat === null || neLng === null || swLng === null) {
    return { status: 'unknown', label: 'Không có khung tọa độ' };
  }

  const minLat = Math.min(swLat, neLat);
  const maxLat = Math.max(swLat, neLat);
  const minLng = Math.min(swLng, neLng);
  const maxLng = Math.max(swLng, neLng);

  if (lat >= minLat && lat <= maxLat && lng >= minLng && lng <= maxLng) {
    return { status: 'inside', label: 'Chính xác trong khung' };
  }

  if (
    lat >= minLat - jitterToleranceDeg &&
    lat <= maxLat + jitterToleranceDeg &&
    lng >= minLng - jitterToleranceDeg &&
    lng <= maxLng + jitterToleranceDeg
  ) {
    return { status: 'nearby', label: 'Lân cận khung (Jitter)' };
  }

  return { status: 'outside', label: 'Ngoài khung bản đồ' };
}

const TRACKING_QUERY_PARAMS = [
  'previous_page_name',
  'source_impression_id',
  'federated_search_id',
  'search_id',
  'search_mode',
  'check_in',
  'check_out',
  'adults',
  'guests',
  'children',
  'infants',
  'pets',
  'c',
  'af',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'locale',
];

/**
 * Chuẩn hóa toàn bộ link hồ sơ chủ nhà sang định dạng quốc tế duy nhất:
 * https://www.airbnb.com/users/profile/{hostId}
 */
export function normalizeHostProfileUrl(
  rawUrlOrId?: string | null,
  _sourceOrigin?: string,
  fallbackHostId?: string | null,
): string {
  const candidates = [rawUrlOrId, fallbackHostId];
  for (const cand of candidates) {
    const str = String(cand || '').trim();
    if (!str) continue;
    const urlMatch = str.match(/\/users\/(?:show|profile)\/(\d+)/i);
    if (urlMatch && urlMatch[1]) {
      return `https://www.airbnb.com/users/profile/${urlMatch[1]}`;
    }
    if (/^\d+$/.test(str)) {
      return `https://www.airbnb.com/users/profile/${str}`;
    }
  }
  return '';
}
