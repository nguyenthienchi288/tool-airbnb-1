"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAirbnbSearchUrl = parseAirbnbSearchUrl;
exports.checkBoundingBox = checkBoundingBox;
const common_1 = require("@nestjs/common");
const helpers_1 = require("../../common/helpers");
const KNOWN_PLACE_MAP = {
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
function parseNullableFloat(val) {
    if (!val || !val.trim())
        return null;
    const num = Number(val);
    return Number.isFinite(num) ? num : null;
}
function inferCityCountry(rawLoc) {
    const clean = rawLoc.trim();
    if (!clean)
        return { display: 'Unknown', city: 'Unknown', country: '' };
    const key = clean.toLowerCase();
    if (KNOWN_PLACE_MAP[key])
        return KNOWN_PLACE_MAP[key];
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
function parseAirbnbSearchUrl(rawUrl) {
    const trimmed = (rawUrl || '').trim();
    if (!trimmed) {
        throw new common_1.BadRequestException('Vui lòng dán đường dẫn URL Airbnb hợp lệ.');
    }
    let parsed;
    try {
        parsed = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    }
    catch {
        throw new common_1.BadRequestException('URL không đúng định dạng. Vui lòng kiểm tra lại.');
    }
    if (!/airbnb\./i.test(parsed.hostname)) {
        throw new common_1.BadRequestException('URL phải thuộc tên miền Airbnb (airbnb.com, airbnb.cn, airbnb.com.vn...).');
    }
    const pathMatch = parsed.pathname.match(/\/s\/([^/]+)/i);
    const rawLocationPath = pathMatch ? decodeURIComponent(pathMatch[1]) : '';
    const inferred = inferCityCountry(rawLocationPath.replace(/--/g, ', '));
    const params = parsed.searchParams;
    const checkIn = (params.get('checkin') || '').trim();
    const checkOut = (params.get('checkout') || '').trim();
    const nights = checkIn && checkOut ? (0, helpers_1.calculateNights)(checkIn, checkOut) : 1;
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
function checkBoundingBox(lat, lng, mapBounds, jitterToleranceDeg = 0.0015) {
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
    if (lat >= minLat - jitterToleranceDeg &&
        lat <= maxLat + jitterToleranceDeg &&
        lng >= minLng - jitterToleranceDeg &&
        lng <= maxLng + jitterToleranceDeg) {
        return { status: 'nearby', label: 'Lân cận khung (Jitter)' };
    }
    return { status: 'outside', label: 'Ngoài khung bản đồ' };
}
//# sourceMappingURL=url-parser.js.map