import { cleanControlChars, haversineMeters, sleep } from '../../common/helpers';

export interface ReverseGeoResult {
  buildingName: string;
  address: string;
  district: string;
  city: string;
  country: string;
  postal?: string;
  lat?: number;
  lng?: number;
}

const geoCache: Array<{ lat: number; lng: number; data: ReverseGeoResult }> = [];
const nameSearchCache = new Map<string, ReverseGeoResult | null>();
let lastNominatimCallMs = 0;

const GENERIC_AD_PHRASES = [
  'luxury residence',
  'cozy studio',
  'modern apartment',
  'sweet home',
  'gangnam stay',
  'seoul stay',
  'entire rental unit',
  'serviced apartment',
  'private room',
  'cozy home',
  'luxury studio',
  'luxury apartment',
  'modern studio',
  'gangnam residence',
  'seoul residence',
  'seocho residence',
  'gyeongbokgung',
  'gyeongbokgung palace',
  'changdeokgung',
  'namsan',
  'seoul tower',
  'myeongdong',
  'hongdae',
  'itaewon',
  'bukchon',
  'insadong',
  'dongdaemun',
  'lotte world',
  'coex',
  'han river',
  'hangang',
];

const DISTANCE_PREFIX_RX =
  /(?:to|from|near|around|walk\s+to|drive\s+to|away\s+from|min(?:ute)?s?\s+(?:to|from)|subway|station|까지|분\s*거리|에서|分钟|到)\s*$/i;

const GROUND_FLOOR_SHOP_RX =
  /(?:의원|치과|약국|한방|병원|클리닉|죠샌드위치|포케|스타벅스|카페|편의점|세븐일레븐|이마트24|\bCU\b|\bGS25\b)/i;

export function isBlacklistedBuildingName(name: string): boolean {
  const clean = cleanControlChars(name).toLowerCase().trim();
  if (!clean || clean.length < 3) return true;
  if (GROUND_FLOOR_SHOP_RX.test(name)) return true;
  if (GENERIC_AD_PHRASES.some((p) => clean === p || clean.includes(p))) return true;
  return false;
}

const KNOWN_BUILDING_ALIASES: Array<{ rx: RegExp; canonical: string }> = [
  { rx: /(?:지젤\s*시그니티|지젤|zizel\s*signity|zizel\s*suite|giselle\s*signity)/i, canonical: 'Zizel Signity (지젤시그니티)' },
  { rx: /(?:롯데\s*캐슬|lotte\s*castle)/i, canonical: 'Lotte Castle' },
  { rx: /(?:래미안|raemian)/i, canonical: 'Raemian' },
  { rx: /(?:힐스테이트|hillstate)/i, canonical: 'Hillstate' },
  { rx: /(?:푸르지오|prugio)/i, canonical: 'Prugio' },
  { rx: /(?:아크로|acro\s+[a-z]+)/i, canonical: 'Acro' },
  { rx: /(?:아이파크|i-?park)/i, canonical: 'I-Park' },
];

/**
 * Tầng 2: Quét Regex tên tòa nhà / chung cư / Officetel (Anh + Hàn + Trung) từ mô tả & tiêu đề,
 * lọc bỏ các cụm từ quảng cáo rác & các điểm tham quan đứng sau từ chỉ khoảng cách ("20 mins to Gyeongbokgung Palace").
 */
export function extractBuildingNameFromText(text: string): string {
  if (!text) return '';

  for (const alias of KNOWN_BUILDING_ALIASES) {
    if (alias.rx.test(text)) {
      return alias.canonical;
    }
  }

  const patterns = [
    /\b([A-Z][A-Za-z0-9'’&.-]{1,22}(?:\s+[A-Z][A-Za-z0-9'’&.-]{1,22}){0,3}\s+(?:Suite|Suites|Tower|Towers|Officetel|Castle|Heights|Paragon|Signity|Xi|Prugio|Hillstate|Raemian|Acro|I-?Park))\b/g,
    /([가-힣A-Za-z0-9]{2,15}\s*(?:시그니티|오피스텔|레지던스|타워|팰리스|푸르지오|자이|래미안|힐스테이트|롯데캐슬|스위트|캐슬))/g,
  ];

  for (const rx of patterns) {
    for (const m of text.matchAll(rx)) {
      const candidate = cleanControlChars(m[1] || '').replace(/\s+/g, ' ').trim();
      if (!candidate || candidate.length < 4 || candidate.length > 60) continue;
      if (isBlacklistedBuildingName(candidate)) continue;

      const idx = m.index ?? 0;
      const prefix = text.slice(Math.max(0, idx - 35), idx);
      if (DISTANCE_PREFIX_RX.test(prefix)) {
        continue;
      }
      return candidate;
    }
  }
  return '';
}

const SEOUL_GU_KO_TO_EN: Record<string, string> = {
  서초구: 'Seocho-gu',
  강남구: 'Gangnam-gu',
  송파구: 'Songpa-gu',
  마포구: 'Mapo-gu',
  종로구: 'Jongno-gu',
  중구: 'Jung-gu',
  용산구: 'Yongsan-gu',
  영등포구: 'Yeongdeungpo-gu',
  성동구: 'Seongdong-gu',
  동대문구: 'Dongdaemun-gu',
  서대문구: 'Seodaemun-gu',
  광진구: 'Gwangjin-gu',
  강동구: 'Gangdong-gu',
  동작구: 'Dongjak-gu',
  관악구: 'Gwanak-gu',
};

function normalizeKoreaDistrictAndCity(
  rawDistrict: string,
  rawCity: string,
  fullAddress: string,
): { district: string; city: string } {
  let district = rawDistrict;
  let city = rawCity;
  for (const [ko, en] of Object.entries(SEOUL_GU_KO_TO_EN)) {
    if (city.includes(ko) || fullAddress.includes(ko)) {
      district = en;
      break;
    }
  }
  if (/서울|seoul/i.test(fullAddress) || /구$/.test(rawCity) || /-gu$/i.test(rawCity)) {
    city = 'Seoul';
  }
  return { district, city };
}

async function waitNominatimRateLimit() {
  const elapsed = Date.now() - lastNominatimCallMs;
  if (elapsed < 1100) {
    await sleep(1100 - elapsed);
  }
  lastNominatimCallMs = Date.now();
}

/**
 * Forward Geocoding từ Tên Tòa Nhà + Quận + Thành phố qua ArcGIS FindAddressCandidates (ưu tiên),
 * fallback Nominatim Search nếu ArcGIS không có kết quả chi tiết.
 */
export async function searchAddressByBuildingName(
  buildingName: string,
  district: string,
  city: string,
  streetHint = '',
): Promise<ReverseGeoResult | null> {
  if (!buildingName || isBlacklistedBuildingName(buildingName)) return null;
  const queryName = buildingName.replace(/\([^)]*\)/g, '').trim();
  const queries = [
    streetHint ? `${streetHint}, ${district}, ${city}` : '',
    `${queryName} ${district} ${city}`.trim(),
    `${buildingName} ${district} ${city}`.trim(),
  ].filter(Boolean);

  const cacheKey = queries.join('|').toLowerCase();
  if (nameSearchCache.has(cacheKey)) {
    return nameSearchCache.get(cacheKey) || null;
  }

  for (const q of queries) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const arcUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(q)}&outFields=Match_addr,LongLabel,City,District,Postal,Country&maxLocations=1`;
      const resp = await fetch(arcUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const json: any = await resp.json();
        const cand = Array.isArray(json?.candidates) ? json.candidates[0] : null;
        if (cand && Number(cand.score || 0) >= 75 && cand.address) {
          const attrs = cand.attributes || {};
          const rawAddr = cleanControlChars(attrs.LongLabel || attrs.Match_addr || cand.address || '');
          const { district: normDist, city: normCity } = normalizeKoreaDistrictAndCity(
            cleanControlChars(attrs.District || district || ''),
            cleanControlChars(attrs.City || city || ''),
            rawAddr,
          );
          const postal = cleanControlChars(attrs.Postal || '');
          const country =
            String(attrs.Country || '').toUpperCase() === 'KOR'
              ? 'South Korea'
              : cleanControlChars(attrs.Country || '');
          // Chỉ nhận kết quả ArcGIS nếu có số/tên đường cụ thể (không chỉ mỗi "Seocho-gu, Seoul")
          if (/\d|길|로|ro|st|ave|gil/i.test(rawAddr)) {
            const data: ReverseGeoResult = {
              buildingName,
              address: postal && !rawAddr.includes(postal) ? `${rawAddr} (${postal})` : rawAddr,
              district: normDist || district,
              city: normCity || city,
              country: country || (normCity === 'Seoul' ? 'South Korea' : ''),
              postal,
              lat: cand.location?.y ? Number(cand.location.y) : undefined,
              lng: cand.location?.x ? Number(cand.location.x) : undefined,
            };
            nameSearchCache.set(cacheKey, data);
            return data;
          }
        }
      }
    } catch {
      // Try next query or Nominatim
    }
  }

  // Fallback Nominatim /search
  const q = `${queryName}, ${district}, ${city}`.replace(/,\s*,/g, ',').trim();
  await waitNominatimRateLimit();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=1&accept-language=en`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AirbnbMarketResearchTool/4.7.0 (contact@localhost)',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) {
      nameSearchCache.set(cacheKey, null);
      return null;
    }

    const arr: any[] = await resp.json();
    const hit = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
    if (!hit) {
      nameSearchCache.set(cacheKey, null);
      return null;
    }

    const addr = hit.address || {};
    const rawAddr = cleanControlChars(hit.display_name || '');
    const { district: normDist, city: normCity } = normalizeKoreaDistrictAndCity(
      cleanControlChars(addr.borough || addr.suburb || addr.city_district || addr.district || district || ''),
      cleanControlChars(addr.city || addr.town || addr.state || city || ''),
      rawAddr,
    );
    const data: ReverseGeoResult = {
      buildingName,
      address: rawAddr,
      district: normDist || district,
      city: normCity || city,
      country: cleanControlChars(addr.country || ''),
      postal: cleanControlChars(addr.postcode || ''),
      lat: hit.lat ? Number(hit.lat) : undefined,
      lng: hit.lon ? Number(hit.lon) : undefined,
    };
    nameSearchCache.set(cacheKey, data);
    return data;
  } catch {
    nameSearchCache.set(cacheKey, null);
    return null;
  }
}

/**
 * Tầng 3: Reverse Geocoding ưu tiên ArcGIS World Geocoding API (trả chuẩn District, Address, Postal, CountryCode tại Hàn Quốc),
 * fallback Nominatim nếu ArcGIS lỗi.
 */
export async function reverseGeocodeCoords(
  lat: number | null,
  lng: number | null,
): Promise<ReverseGeoResult | null> {
  if (lat === null || lng === null || lat === 0 || lng === 0) return null;

  const cached = geoCache.find((c) => haversineMeters(c.lat, c.lng, lat, lng) <= 60);
  if (cached) return cached.data;

  // 1. ArcGIS World GeocodeServer (miễn phí, không cần API key, trả chuẩn Seocho-gu / Seoul / KOR)
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const arcUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${encodeURIComponent(lng)},${encodeURIComponent(lat)}&langCode=en`;
    const resp = await fetch(arcUrl, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const json: any = await resp.json();
      const addr = json?.address;
      if (addr && !json?.error) {
        const countryCode = String(addr.CountryCode || '').toUpperCase();
        const country =
          countryCode === 'KOR'
            ? 'South Korea'
            : countryCode === 'VNM'
              ? 'Vietnam'
              : countryCode === 'JPN'
                ? 'Japan'
                : cleanControlChars(addr.CntryName || countryCode || '');
        const fullAddress = cleanControlChars(
          addr.LongLabel || addr.Match_addr || addr.Address || '',
        );
        const rawDistrict = cleanControlChars(
          addr.District || addr.Neighborhood || addr.Subregion || '',
        );
        const rawCity = cleanControlChars(addr.City || addr.Region || '');
        const { district, city } = normalizeKoreaDistrictAndCity(
          rawDistrict,
          rawCity,
          fullAddress,
        );
        const buildingCandidate = cleanControlChars(addr.PlaceName || '');
        const buildingName = isBlacklistedBuildingName(buildingCandidate) ? '' : buildingCandidate;

        const data: ReverseGeoResult = {
          buildingName,
          address: fullAddress,
          district,
          city,
          country,
          postal: cleanControlChars(addr.Postal || ''),
        };
        if (data.address || data.district) {
          geoCache.push({ lat, lng, data });
          return data;
        }
      }
    }
  } catch {
    // Fallback to Nominatim
  }

  // 2. Fallback Nominatim
  await waitNominatimRateLimit();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=en`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'AirbnbMarketResearchTool/4.6.0 (contact@localhost)',
      },
    });
    clearTimeout(timer);
    if (!resp.ok) return null;

    const json: any = await resp.json();
    const addr = json?.address || {};
    const buildingCandidate = cleanControlChars(
      json?.name || addr.building || addr.residential || addr.apartments || addr.commercial || '',
    );
    const buildingName = isBlacklistedBuildingName(buildingCandidate) ? '' : buildingCandidate;
    const roadLine = [addr.house_number, addr.road].filter(Boolean).join(' ');
    const district = cleanControlChars(
      addr.borough || addr.suburb || addr.city_district || addr.district || addr.county || '',
    );
    const city = cleanControlChars(addr.city || addr.town || addr.state || '');
    const country = cleanControlChars(addr.country || '');
    const fullAddress =
      cleanControlChars(json?.display_name || '') ||
      [roadLine, addr.neighbourhood || addr.quarter, district, city, country]
        .filter(Boolean)
        .join(', ');

    const data: ReverseGeoResult = {
      buildingName,
      address: fullAddress,
      district,
      city,
      country,
      postal: cleanControlChars(addr.postcode || ''),
    };
    geoCache.push({ lat, lng, data });
    return data;
  } catch {
    return null;
  }
}
