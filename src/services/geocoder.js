import { APP_CONFIG, normalizeText } from '../config/index.js';
import { sleep } from '../utils/helpers.js';

const KNOWN_PROJECTS_REGEX =
  /\b(Vinhomes\s+Central\s+Park|Vinhomes\s+Golden\s+River|Vinhomes\s+Grand\s+Park|Masteri\s+Th[aả]o\s+[ĐD]i[eề]n|Masteri\s+An\s+Ph[uú]|Millennium|Rivergate|The\s+Gold\s*View|GoldView|Saigon\s+Royal|Icon\s*56|Sunrise\s+City|Sunrise\s+Riverside|Estella\s+Heights|Gateway\s+Th[aả]o\s+[ĐD]i[eề]n|The\s+Sun\s+Avenue|Landmark\s*81|The\s+Tresor|Kingdom\s*101|HaDo\s+Centrosa|Diamond\s+Island|[ĐD][aả]o\s+Kim\s+C[uươ]ng|Galaxy\s*9|Scenic\s+Valley|Happy\s+Valley|Celadon\s+City|Orchard\s+Parkview|Botanica|Kingston\s+Residence|The\s+Vista|Vista\s+Verde|Feliz\s+en\s+Vista|Sadora|Sarimi|Sala|Ashton\s+Asoke|Ideo\s+Q|Noble\s+Ploenchit|The\s+Line)\b/i;

/**
 * Attempt to extract a condominium / building / residence name from listing title or description.
 */
export function extractBuildingNameFromText(title = '', description = '') {
  const fullText = `${title} ${description}`;

  // 1. Known commercial condo projects
  const knownMatch = fullText.match(KNOWN_PROJECTS_REGEX);
  if (knownMatch) {
    return knownMatch[1].replace(/\s+/g, ' ').trim();
  }

  // 2. Common patterns: "@ Building Name", "in Building Name", "at Building Name"
  const atMatch = `${title}`.match(
    /(?:@|\bat\b|\bin\b|\btại\b)\s+([A-ZÀ-Ỹ0-9][A-Za-zÀ-ỹ0-9\s&'’-]{3,40})/
  );
  if (atMatch) {
    return atMatch[1].replace(/\s*[-|,].*$/, '').trim();
  }

  // 3. Common high-rise project suffixes
  const suffixMatch = fullText.match(
    /\b((?:The\s+)?[A-Z][A-Za-z0-9'&-]+(?:\s+[A-Z0-9][A-Za-z0-9'&-]+){0,3}\s+(?:Condo(?:minium)?|Residence|Residences|Apartment|Tower|Towers|Suites|Suite|Loft|Heights|Place|Park|Court|Plaza|Center|Building|View|Garden|Gardens|Riverside))\b/
  );
  if (suffixMatch) {
    return suffixMatch[1].trim();
  }

  return '';
}

export function buildGeoClusterKey(lat, lng) {
  return `${Number(lat).toFixed(3)},${Number(lng).toFixed(3)}`;
}

/**
 * Great-circle distance between two lat/lng coordinates in kilometers (Haversine formula).
 */
export function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const haversineDistanceKm = calculateDistanceKm;

const BUILTIN_CITY_CENTERS = {
  'ho chi minh city': { centerLat: 10.7769, centerLng: 106.7009, countryName: 'Vietnam', countryCode: 'vn' },
  'ho chi minh': { centerLat: 10.7769, centerLng: 106.7009, countryName: 'Vietnam', countryCode: 'vn' },
  'tp ho chi minh': { centerLat: 10.7769, centerLng: 106.7009, countryName: 'Vietnam', countryCode: 'vn' },
  'hanoi': { centerLat: 21.0285, centerLng: 105.8542, countryName: 'Vietnam', countryCode: 'vn' },
  'ha noi': { centerLat: 21.0285, centerLng: 105.8542, countryName: 'Vietnam', countryCode: 'vn' },
  'da nang': { centerLat: 16.0544, centerLng: 108.2022, countryName: 'Vietnam', countryCode: 'vn' },
  'bangkok': { centerLat: 13.7563, centerLng: 100.5018, countryName: 'Thailand', countryCode: 'th' },
  'tokyo': { centerLat: 35.6762, centerLng: 139.6503, countryName: 'Japan', countryCode: 'jp' },
  'osaka': { centerLat: 34.6937, centerLng: 135.5023, countryName: 'Japan', countryCode: 'jp' },
  'singapore': { centerLat: 1.3521, centerLng: 103.8198, countryName: 'Singapore', countryCode: 'sg' },
};

/**
 * Fetch target city center coordinates and bounding box from Nominatim,
 * with built-in fallback for major cities so Geofencing is always active.
 */
export async function fetchCityBounds(city, country) {
  const q = `${city}, ${country}`.trim();
  const url =
    `https://nominatim.openstreetmap.org/search?format=jsonv2` +
    `&q=${encodeURIComponent(q)}&limit=1&addressdetails=1`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': APP_CONFIG.nominatimUserAgent,
        'Accept-Language': 'en,vi',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const rows = await res.json();
      const first = Array.isArray(rows) ? rows[0] : null;
      if (first) {
        const centerLat = Number(first.lat);
        const centerLng = Number(first.lon);
        if (Number.isFinite(centerLat) && Number.isFinite(centerLng)) {
          const bbox = Array.isArray(first.boundingbox) ? first.boundingbox.map(Number) : null;
          return {
            centerLat,
            centerLng,
            boundingbox: bbox && bbox.length === 4 ? bbox : null,
            countryName: first.address?.country || country,
            countryCode: (first.address?.country_code || '').toLowerCase(),
            displayName: first.display_name || q,
          };
        }
      }
    }
  } catch {
    // Fall through to built-in centers
  }

  const normCity = normalizeText(city);
  const builtin = BUILTIN_CITY_CENTERS[normCity];
  if (builtin) {
    return {
      ...builtin,
      boundingbox: null,
      displayName: q,
    };
  }
  return null;
}

/**
 * Check whether (lat, lng) is within `maxRadiusKm` (default 40 km) of the target city center.
 */
export function isWithinCityGeofence(lat, lng, cityBounds, maxRadiusKm = 40) {
  if (!cityBounds || typeof lat !== 'number' || typeof lng !== 'number') {
    return true;
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return true;
  const dist = calculateDistanceKm(lat, lng, cityBounds.centerLat, cityBounds.centerLng);
  return dist <= maxRadiusKm;
}

const OTHER_LOCATION_BLACKLIST = [
  'nam phi',
  'south africa',
  'cape town',
  'johannesburg',
  'costa rica',
  'bo dao nha',
  'portugal',
  'lisbon',
  'porto',
  'colombia',
  'medellin',
  'bogota',
  'brazil',
  'brasil',
  'rio de janeiro',
  'sao paulo',
  'hoa ky',
  'united states',
  'california',
  'new york',
  'los angeles',
  'miami',
  'mexico',
  'cancun',
  'tulum',
  'da lat',
  'dalat',
  'nha trang',
  'phu quoc',
  'da nang',
  'ha noi',
  'hanoi',
  'vung tau',
  'sapa',
  'sa pa',
  'hoi an',
  'hue',
  'bekasi',
  'jakarta',
  'bali',
  'bangkok',
  'phuket',
  'chiang mai',
  'tokyo',
  'osaka',
  'kyoto',
  'athens',
  'filothei',
  'greece',
  'hy lap',
  'london',
  'paris',
  'seoul',
  'singapore',
  'kuala lumpur',
];

/**
 * Layer 2 Filter: Reject listings whose title/subtitle explicitly mentions
 * another country or province/city outside the target city/country.
 */
export function isForeignOrOtherCityTitle(text, targetCity = '', targetCountry = '') {
  const normText = normalizeText(text);
  if (!normText) return false;

  const normTargetCity = normalizeText(targetCity);
  const normTargetCountry = normalizeText(targetCountry);

  for (const loc of OTHER_LOCATION_BLACKLIST) {
    if (normTargetCity.includes(loc) || normTargetCountry.includes(loc)) {
      continue;
    }
    const regex = new RegExp(`\\b${loc.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    if (regex.test(normText)) {
      return true;
    }
  }
  return false;
}

const COUNTRY_ALIAS_MAP = {
  vietnam: ['vietnam', 'viet nam', 'vn', 'cong hoa xa hoi chu nghia viet nam'],
  thailand: ['thailand', 'thai lan', 'th', 'prathet thai'],
  japan: ['japan', 'nhat ban', 'jp', 'nippon'],
  singapore: ['singapore', 'sg'],
  philippines: ['philippines', 'ph'],
  korea: ['south korea', 'korea', 'han quoc', 'kr', 'republic of korea'],
  indonesia: ['indonesia', 'id'],
  malaysia: ['malaysia', 'my'],
  greece: ['greece', 'hy lap', 'gr', 'hellenic republic', 'athens', 'filothei'],
};

export function isCountryMatching(targetCountry, detectedCountry = '', detectedCountryCode = '', rawDisplayName = '') {
  const normTarget = normalizeText(targetCountry);
  if (!normTarget) return true;

  const normDetected = normalizeText(detectedCountry);
  const normCode = normalizeText(detectedCountryCode);
  const normRaw = normalizeText(rawDisplayName);

  // If Nominatim didn't return country info at all, don't false-positive reject
  if (!normDetected && !normCode && !normRaw) return true;

  // Check alias groups
  for (const aliases of Object.values(COUNTRY_ALIAS_MAP)) {
    if (aliases.some((a) => normTarget === a || normTarget.includes(a))) {
      if (
        (normDetected && aliases.some((a) => normDetected.includes(a) || a === normDetected)) ||
        (normCode && aliases.includes(normCode)) ||
        (normRaw && aliases.some((a) => a.length > 2 && normRaw.includes(a)))
      ) {
        return true;
      }
      return false;
    }
  }

  if (normDetected && (normDetected.includes(normTarget) || normTarget.includes(normDetected))) {
    return true;
  }
  if (normRaw && normRaw.includes(normTarget)) {
    return true;
  }
  return false;
}

async function reverseGeocodeNominatim(lat, lng) {
  const url =
    `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': APP_CONFIG.nominatimUserAgent,
      'Accept-Language': 'en,vi',
    },
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    throw new Error(`Nominatim HTTP ${res.status}`);
  }

  const data = await res.json();
  const addr = data.address || {};
  const buildingName =
    data.name ||
    addr.building ||
    addr.amenity ||
    addr.apartments ||
    addr.residential ||
    addr.commercial ||
    '';

  const streetParts = [
    addr.house_number,
    addr.road || addr.pedestrian || addr.street,
    addr.suburb || addr.neighbourhood || addr.quarter,
    addr.city || addr.town || addr.state,
  ].filter(Boolean);

  const streetAddress = streetParts.join(', ') || data.display_name || '';

  return {
    buildingName: String(buildingName).trim(),
    streetAddress: String(streetAddress).trim(),
    rawDisplayName: data.display_name || '',
    country: addr.country || '',
    countryCode: (addr.country_code || '').toLowerCase(),
    actualCity: addr.city || addr.town || addr.state || addr.province || addr.county || '',
  };
}

async function reverseGeocodeGoogle(lat, lng) {
  const key = APP_CONFIG.googlePlacesApiKey;
  if (!key) {
    return reverseGeocodeNominatim(lat, lng);
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok) {
    throw new Error(`Google Geocoding HTTP ${res.status}`);
  }
  const data = await res.json();
  const first = data.results?.[0];
  if (!first) {
    return { buildingName: '', streetAddress: '', rawDisplayName: '' };
  }

  const premiseComp = (first.address_components || []).find(
    (c) => c.types?.includes('premise') || c.types?.includes('point_of_interest')
  );

  return {
    buildingName: premiseComp?.long_name || '',
    streetAddress: first.formatted_address || '',
    rawDisplayName: first.formatted_address || '',
  };
}

/**
 * Resolve raw geocode result once per spatial cluster (rounded to 3 decimals ~100m),
 * cached in SQLite `geocode_cache`.
 */
export async function resolveClusterGeocode(lat, lng, db, targetCountry = '') {
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    return { buildingName: '', streetAddress: '', fromCache: false, outOfBounds: false };
  }

  const cacheKey = buildGeoClusterKey(lat, lng);
  const cached = db ? db.getGeocodeCache(cacheKey) : null;
  if (cached) {
    const countryOk = isCountryMatching(targetCountry, '', '', cached.raw_display_name || '');
    const rawParts = String(cached.raw_display_name || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const inferredCountry = rawParts.length > 0 ? rawParts[rawParts.length - 1] : '';
    const inferredCity = rawParts.length > 1 ? rawParts[Math.max(0, rawParts.length - 3)] : '';
    return {
      buildingName: cached.building_name || '',
      streetAddress: cached.street_address || '',
      actualCountry: inferredCountry,
      actualCity: inferredCity,
      fromCache: true,
      outOfBounds: !countryOk,
      isOutOfBounds: !countryOk,
    };
  }

  let geo = {
    buildingName: '',
    streetAddress: '',
    rawDisplayName: '',
    country: '',
    countryCode: '',
    actualCity: '',
  };
  try {
    if (APP_CONFIG.geocoderProvider === 'google' && APP_CONFIG.googlePlacesApiKey) {
      geo = await reverseGeocodeGoogle(lat, lng);
    } else {
      geo = await reverseGeocodeNominatim(lat, lng);
      // Respect Nominatim 1 req/s rate limit only when hitting external API
      await sleep(1050);
    }
    const countryOk = isCountryMatching(
      targetCountry,
      geo.country,
      geo.countryCode,
      geo.rawDisplayName
    );
    if (db && countryOk && (geo.buildingName || geo.streetAddress)) {
      db.setGeocodeCache(cacheKey, geo.buildingName, geo.streetAddress, geo.rawDisplayName);
    }
    return {
      buildingName: geo.buildingName || '',
      streetAddress: geo.streetAddress || '',
      actualCountry: geo.country || '',
      actualCity: geo.actualCity || '',
      fromCache: false,
      outOfBounds: !countryOk,
      isOutOfBounds: !countryOk,
    };
  } catch {
    return {
      buildingName: '',
      streetAddress: '',
      actualCountry: '',
      actualCity: '',
      fromCache: false,
      outOfBounds: false,
      isOutOfBounds: false,
    };
  }
}

export function detectScopeStatus({
  lat,
  lng,
  title = '',
  city = '',
  country = '',
  cityBounds = null,
  maxRadiusKm = 40,
  geoOutOfBounds = false,
}) {
  if (geoOutOfBounds) return 'OUT_OF_TARGET';
  if (isForeignOrOtherCityTitle(title, city, country)) return 'OUT_OF_TARGET';
  if (
    cityBounds &&
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !isWithinCityGeofence(lat, lng, cityBounds, maxRadiusKm)
  ) {
    return 'OUT_OF_TARGET';
  }
  return 'IN_TARGET';
}

/**
 * Format final buildingName & streetAddress for a listing from cluster geocode + text fallback.
 * Priority: Source 1 (Title/Description project name) -> Source 2 (Nominatim building/amenity) -> Source 3 ("Chung cư khu vực [Đường/Phường]").
 */
export function applyGeoToListing(listing, geo) {
  const textBuilding = extractBuildingNameFromText(listing.title, listing.description);
  let areaFallback = '';
  if (geo?.streetAddress) {
    const parts = geo.streetAddress
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const areaLabel = parts.slice(0, 2).join(', ');
    if (areaLabel) {
      areaFallback = `Chung cư khu vực ${areaLabel}`;
    }
  }

  const finalBuildingName =
    textBuilding ||
    geo?.buildingName ||
    areaFallback ||
    'Chưa xác định tòa nhà';

  return {
    buildingName: finalBuildingName,
    streetAddress: geo?.streetAddress || listing.city || '',
  };
}

/**
 * Resolve standardized buildingName and streetAddress for a listing using
 * text extraction + Reverse Geocoding (cached in SQLite).
 */
export async function resolveListingLocation(listing, db) {
  const textBuilding = extractBuildingNameFromText(listing.title, listing.description);

  if (typeof listing.lat !== 'number' || typeof listing.lng !== 'number') {
    return {
      buildingName: textBuilding || 'Chưa xác định tòa nhà',
      streetAddress: listing.city || '',
    };
  }

  const geo = await resolveClusterGeocode(listing.lat, listing.lng, db);
  return applyGeoToListing(listing, geo);
}
