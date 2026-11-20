import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export const AIRBNB_BASE_URL = 'https://www.airbnb.com.vn';

export const APP_CONFIG = {
  headless: process.env.HEADLESS !== 'false',
  slowMo: Number(process.env.SLOW_MO || 50),
  pageTimeoutMs: Number(process.env.PAGE_TIMEOUT_MS || 45000),
  minDelayMs: Number(process.env.MIN_DELAY_MS || 1800),
  maxDelayMs: Number(process.env.MAX_DELAY_MS || 4200),
  proxy: process.env.PROXY_SERVER
    ? {
        server: process.env.PROXY_SERVER,
        username: process.env.PROXY_USERNAME || undefined,
        password: process.env.PROXY_PASSWORD || undefined,
      }
    : undefined,
  geocoderProvider: (process.env.GEOCODER_PROVIDER || 'nominatim').toLowerCase(),
  googlePlacesApiKey: process.env.GOOGLE_PLACES_API_KEY || '',
  nominatimUserAgent:
    process.env.NOMINATIM_USER_AGENT || 'AirbnbMarketResearchCLI/1.0 (ota-arbitrage-tool)',
  dbPath: path.resolve(process.env.DB_PATH || './data/airbnb_market.db'),
  outputDir: path.resolve(process.env.OUTPUT_DIR || './output'),
};

/**
 * Countries strictly blocked by the Market Guardrail.
 * Normalized (lowercase, no diacritics).
 */
export const EXCLUDED_COUNTRY_KEYS = new Set([
  'indonesia',
  'id',
  'indo',
  'republic of indonesia',
  'malaysia',
  'my',
  'malay',
]);

/**
 * Normalize text by removing Vietnamese/Unicode diacritics and collapsing spaces.
 */
export function normalizeText(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Check whether the target country is blocked by Market Guardrail.
 */
export function isCountryExcluded(country) {
  const normalized = normalizeText(country);
  if (!normalized) return false;
  if (EXCLUDED_COUNTRY_KEYS.has(normalized)) return true;
  for (const key of EXCLUDED_COUNTRY_KEYS) {
    if (key.length > 2 && normalized.includes(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Amenity & Property Type classification rules for high-rise condos (Multi-Criteria Scoring).
 */
export const CLASSIFICATION_RULES = {
  elevatorKeywords: ['thang máy', 'elevator', 'lift'],
  noElevatorKeywords: [
    'không có thang máy',
    'no elevator',
    'stairs only',
    'must climb stairs',
    'cần leo cầu thang',
    'leo cầu thang',
    'không thang máy',
    'chỉ có cầu thang bộ',
  ],
  complexAmenities: [
    {
      label: 'Hồ bơi chung',
      keywords: ['hồ bơi chung', 'shared pool', 'bể bơi chung', 'communal pool', 'hồ bơi', 'pool'],
      excludeIfIncludes: ['riêng', 'private pool'],
    },
    {
      label: 'Phòng tập / Gym',
      keywords: ['phòng tập thể hình', 'gym', 'fitness', 'phòng tập gym', 'phòng tập', 'fitness center'],
    },
    {
      label: 'Bảo vệ / Lễ tân 24/7',
      keywords: ['building staff', 'concierge', 'lễ tân', 'bảo vệ', 'nhân viên tòa nhà', 'security'],
    },
    {
      label: 'Bãi đỗ xe',
      keywords: [
        'bãi đỗ xe miễn phí tại nơi ở',
        'bãi đỗ xe trong khuôn viên',
        'bãi đỗ xe',
        'free parking on premises',
        'free residential garage',
        'parking on premises',
      ],
    },
    {
      label: 'Ban công / Sân hiên',
      keywords: ['ban công', 'sân hiên', 'patio or balcony', 'balcony', 'private patio or balcony'],
    },
    {
      label: 'City view / Skyline',
      keywords: ['đường chân trời', 'city skyline view', 'skyline view', 'city view', 'tầm nhìn ra thành phố'],
    },
    {
      label: 'Sauna / Rooftop',
      keywords: ['sauna', 'xông hơi', 'rooftop', 'sân thượng'],
    },
  ],
  excludedPropertyKeywords: [
    'nhà phố',
    'townhouse',
    'nhà riêng',
    'entire home',
    'entire house',
    'biệt thự',
    'villa',
    'nhà gỗ',
    'cabin',
    'bungalow',
    'cottage',
    'tiny home',
    'farm stay',
    'houseboat',
    'tent',
    'nhà nguyên căn mặt đất',
    'hẻm xe máy',
  ],
  condoPropertyKeywords: [
    'condo',
    'condominium',
    'căn hộ',
    'chung cư',
    'serviced apartment',
    'căn hộ dịch vụ',
    'rental unit',
    'đơn vị cho thuê',
    'loft',
    'gác xép',
    'apartment',
    'penthouse',
    'studio',
    'suite',
  ],
  buildingTitleKeywords: [
    'apartment',
    'condo',
    'condominium',
    'residence',
    'residences',
    'residential tower',
    'high-rise',
    'highrise',
    'tower',
    'serviced apartment',
    'apartment complex',
    'building',
    'suite',
    'skyline',
    'penthouse',
    'studio',
    'căn hộ',
    'chung cư',
    'căn hộ dịch vụ',
    'tòa nhà',
    'tháp',
    'cao tầng',
    'khu phức hợp',
  ],
  projectNameKeywords: [
    'vinhomes',
    'masteri',
    'saigon',
    'landmark',
    'the sun',
    'rivergate',
    'millennium',
    'goldview',
    'tower',
    'residence',
    'residences',
    'center',
    'plaza',
    'heights',
    'park',
  ],
};

function formatDateYMD(date) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDays(baseDate, days) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Find next Friday (day 5) on or after baseDate + minOffsetDays.
 */
function nextWeekendPair(baseDate, minOffsetDays, nights = 2) {
  const start = addDays(baseDate, minOffsetDays);
  const day = start.getDay(); // 0 Sun .. 5 Fri .. 6 Sat
  const diffToFri = (5 - day + 7) % 7;
  const checkinDate = addDays(start, diffToFri);
  const checkoutDate = addDays(checkinDate, nights);
  return { checkinDate, checkoutDate };
}

/**
 * Find next Tuesday (day 2) on or after baseDate + minOffsetDays (midweek).
 */
function nextMidweekPair(baseDate, minOffsetDays, nights = 2) {
  const start = addDays(baseDate, minOffsetDays);
  const day = start.getDay();
  const diffToTue = (2 - day + 7) % 7;
  const checkinDate = addDays(start, diffToTue);
  const checkoutDate = addDays(checkinDate, nights);
  return { checkinDate, checkoutDate };
}

/**
 * Generate N diverse (checkin, checkout) pairs covering weekdays, weekends,
 * and horizons (+3d, +7d, +15d, +30d, +45d, +60d, +75d) to capture price volatility.
 */
export function generateDatePairs(iterations = 10) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const templates = [
    () => ({ ...nextMidweekPair(today, 3, 2), label: 'Ngay thuong (+3d)' }),
    () => ({ ...nextWeekendPair(today, 3, 2), label: 'Cuoi tuan (+1w)' }),
    () => {
      const checkinDate = addDays(today, 7);
      return { checkinDate, checkoutDate: addDays(checkinDate, 3), label: '+7 ngay (3 dem)' };
    },
    () => ({ ...nextMidweekPair(today, 14, 2), label: 'Ngay thuong (+15d)' }),
    () => ({ ...nextWeekendPair(today, 14, 2), label: 'Cuoi tuan (+15d)' }),
    () => {
      const checkinDate = addDays(today, 30);
      return { checkinDate, checkoutDate: addDays(checkinDate, 3), label: '+30 ngay (3 dem)' };
    },
    () => ({ ...nextWeekendPair(today, 30, 2), label: 'Cuoi tuan (+30d)' }),
    () => ({ ...nextMidweekPair(today, 45, 2), label: 'Ngay thuong (+45d)' }),
    () => {
      const checkinDate = addDays(today, 60);
      return { checkinDate, checkoutDate: addDays(checkinDate, 3), label: '+60 ngay (3 dem)' };
    },
    () => ({ ...nextWeekendPair(today, 75, 2), label: 'Cuoi tuan (+75d)' }),
  ];

  const pairs = [];
  for (let i = 0; i < iterations; i++) {
    let pair;
    if (i < templates.length) {
      pair = templates[i]();
    } else {
      const extraOffset = 80 + (i - templates.length) * 7;
      const checkinDate = addDays(today, extraOffset);
      pair = {
        checkinDate,
        checkoutDate: addDays(checkinDate, 2),
        label: `+${extraOffset} ngay`,
      };
    }

    const checkin = formatDateYMD(pair.checkinDate);
    const checkout = formatDateYMD(pair.checkoutDate);
    const nights = Math.max(
      1,
      Math.round((pair.checkoutDate - pair.checkinDate) / (1000 * 60 * 60 * 24))
    );

    pairs.push({
      index: i + 1,
      checkin,
      checkout,
      nights,
      label: pair.label,
      key: `${checkin}->${checkout}`,
    });
  }

  return pairs;
}
