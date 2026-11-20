"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBlacklistedBuildingName = isBlacklistedBuildingName;
exports.extractBuildingNameFromText = extractBuildingNameFromText;
exports.searchAddressByBuildingName = searchAddressByBuildingName;
exports.reverseGeocodeCoords = reverseGeocodeCoords;
const helpers_1 = require("../../common/helpers");
const geoCache = [];
const nameSearchCache = new Map();
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
];
function isBlacklistedBuildingName(name) {
    const clean = (0, helpers_1.cleanControlChars)(name).toLowerCase().trim();
    if (!clean || clean.length < 3)
        return true;
    if (GENERIC_AD_PHRASES.some((p) => clean === p || clean.includes(p)))
        return true;
    return false;
}
const KNOWN_BUILDING_ALIASES = [
    { rx: /(?:지젤\s*시그니티|zizel\s*signity|zizel\s*suite)/i, canonical: 'Zizel Signity (지젤시그니티)' },
    { rx: /(?:롯데\s*캐슬|lotte\s*castle)/i, canonical: 'Lotte Castle' },
    { rx: /(?:래미안|raemian)/i, canonical: 'Raemian' },
    { rx: /(?:힐스테이트|hillstate)/i, canonical: 'Hillstate' },
    { rx: /(?:푸르지오|prugio)/i, canonical: 'Prugio' },
    { rx: /(?:아크로|acro\s+[a-z]+)/i, canonical: 'Acro' },
    { rx: /(?:아이파크|i-?park)/i, canonical: 'I-Park' },
];
function extractBuildingNameFromText(text) {
    if (!text)
        return '';
    for (const alias of KNOWN_BUILDING_ALIASES) {
        if (alias.rx.test(text)) {
            return alias.canonical;
        }
    }
    const patterns = [
        /\b([A-Z][A-Za-z0-9'’&.-]{1,22}(?:\s+[A-Z][A-Za-z0-9'’&.-]{1,22}){0,3}\s+(?:Suite|Suites|Tower|Towers|Officetel|Castle|Palace|Heights|Paragon|Signity|Xi|Prugio|Hillstate|Raemian|Acro|I-?Park))\b/,
        /([가-힣A-Za-z0-9]{2,15}\s*(?:시그니티|오피스텔|타워|레지던스|아파트|자이|푸르지오|힐스테이트|래미안|스위트|캐슬))/,
    ];
    for (const rx of patterns) {
        const m = text.match(rx);
        if (m && m[1]) {
            const candidate = (0, helpers_1.cleanControlChars)(m[1]).replace(/\s+/g, ' ').trim();
            if (candidate.length >= 4 && candidate.length <= 60 && !isBlacklistedBuildingName(candidate)) {
                return candidate;
            }
        }
    }
    return '';
}
async function waitNominatimRateLimit() {
    const elapsed = Date.now() - lastNominatimCallMs;
    if (elapsed < 1100) {
        await (0, helpers_1.sleep)(1100 - elapsed);
    }
    lastNominatimCallMs = Date.now();
}
async function searchAddressByBuildingName(buildingName, district, city) {
    if (!buildingName || isBlacklistedBuildingName(buildingName))
        return null;
    const queryName = buildingName.replace(/\([^)]*\)/g, '').trim();
    const q = [queryName, district, city].filter(Boolean).join(', ');
    if (!q)
        return null;
    const cacheKey = q.toLowerCase();
    if (nameSearchCache.has(cacheKey)) {
        return nameSearchCache.get(cacheKey) || null;
    }
    await waitNominatimRateLimit();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=jsonv2&addressdetails=1&limit=1&accept-language=en`;
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'AirbnbMarketResearchTool/4.2.0 (contact@localhost)',
            },
        });
        clearTimeout(timer);
        if (!resp.ok) {
            nameSearchCache.set(cacheKey, null);
            return null;
        }
        const arr = await resp.json();
        const hit = Array.isArray(arr) && arr.length > 0 ? arr[0] : null;
        if (!hit) {
            nameSearchCache.set(cacheKey, null);
            return null;
        }
        const addr = hit.address || {};
        const districtRes = (0, helpers_1.cleanControlChars)(addr.borough || addr.suburb || addr.city_district || addr.district || district || '');
        const cityRes = (0, helpers_1.cleanControlChars)(addr.city || addr.town || addr.state || city || '');
        const countryRes = (0, helpers_1.cleanControlChars)(addr.country || '');
        const data = {
            buildingName,
            address: (0, helpers_1.cleanControlChars)(hit.display_name || ''),
            district: districtRes,
            city: cityRes,
            country: countryRes,
            lat: hit.lat ? Number(hit.lat) : undefined,
            lng: hit.lon ? Number(hit.lon) : undefined,
        };
        nameSearchCache.set(cacheKey, data);
        return data;
    }
    catch {
        nameSearchCache.set(cacheKey, null);
        return null;
    }
}
async function reverseGeocodeCoords(lat, lng) {
    if (lat === null || lng === null || lat === 0 || lng === 0)
        return null;
    const cached = geoCache.find((c) => (0, helpers_1.haversineMeters)(c.lat, c.lng, lat, lng) <= 60);
    if (cached)
        return cached.data;
    await waitNominatimRateLimit();
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=en`;
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'AirbnbMarketResearchTool/4.2.0 (contact@localhost)',
            },
        });
        clearTimeout(timer);
        if (!resp.ok)
            return null;
        const json = await resp.json();
        const addr = json?.address || {};
        const buildingCandidate = (0, helpers_1.cleanControlChars)(json?.name || addr.building || addr.residential || addr.apartments || addr.commercial || '');
        const buildingName = isBlacklistedBuildingName(buildingCandidate) ? '' : buildingCandidate;
        const roadLine = [addr.house_number, addr.road].filter(Boolean).join(' ');
        const district = (0, helpers_1.cleanControlChars)(addr.borough || addr.suburb || addr.city_district || addr.district || addr.county || '');
        const city = (0, helpers_1.cleanControlChars)(addr.city || addr.town || addr.state || '');
        const country = (0, helpers_1.cleanControlChars)(addr.country || '');
        const fullAddress = (0, helpers_1.cleanControlChars)(json?.display_name || '') ||
            [roadLine, addr.neighbourhood || addr.quarter, district, city, country]
                .filter(Boolean)
                .join(', ');
        const data = {
            buildingName,
            address: fullAddress,
            district,
            city,
            country,
        };
        geoCache.push({ lat, lng, data });
        return data;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=geo-enrichment.js.map