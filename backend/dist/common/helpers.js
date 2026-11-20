"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sleep = sleep;
exports.randomDelay = randomDelay;
exports.cleanControlChars = cleanControlChars;
exports.decodeAirbnbId = decodeAirbnbId;
exports.buildListingUrl = buildListingUrl;
exports.buildHostProfileUrl = buildHostProfileUrl;
exports.buildSearchUrl = buildSearchUrl;
exports.parsePriceBucketsText = parsePriceBucketsText;
exports.buildRoomUrl = buildRoomUrl;
exports.parseProxyUrl = parseProxyUrl;
exports.calculateNights = calculateNights;
exports.parseNumericAmount = parseNumericAmount;
exports.detectCurrencyFromText = detectCurrencyFromText;
exports.normalizePriceBreakdown = normalizePriceBreakdown;
exports.findObjectsWhere = findObjectsWhere;
exports.formatDateStamp = formatDateStamp;
exports.sanitizeFilename = sanitizeFilename;
exports.haversineMeters = haversineMeters;
exports.isInvalidBlockedTitle = isInvalidBlockedTitle;
const constants_1 = require("../config/constants");
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function randomDelay(minMs = 600, maxMs = 1400) {
    const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
    return sleep(ms);
}
function cleanControlChars(text) {
    if (!text)
        return '';
    return String(text)
        .replace(/<br\s*\/?>/gi, ' ')
        .replace(/<\/?b>/gi, '')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
        .trim();
}
function decodeAirbnbId(rawId) {
    if (!rawId)
        return null;
    const str = String(rawId).trim();
    if (/^\d+$/.test(str))
        return str;
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
        if (match)
            return match[1];
    }
    catch {
    }
    const fallbackMatch = str.match(/(\d{5,})/);
    return fallbackMatch ? fallbackMatch[1] : null;
}
function buildListingUrl(listingId) {
    return `${constants_1.AIRBNB_BASE_URL}/rooms/${listingId}`;
}
function buildHostProfileUrl(hostId) {
    return `${constants_1.AIRBNB_BASE_URL}/users/show/${hostId}`;
}
function buildSearchUrl(params) {
    const { cityName, checkIn, checkOut, minPrice, maxPrice, entireHomeOnly = true, currency = 'VND', } = params;
    let url = `${constants_1.AIRBNB_BASE_URL}/s/${encodeURIComponent(cityName)}/homes` +
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
function parsePriceBucketsText(raw) {
    const text = (raw || '').trim();
    if (!text)
        return [...constants_1.DEFAULT_PRICE_BUCKETS_VND];
    const parsed = [];
    for (const part of text.split(',')) {
        const token = part.trim();
        if (!token)
            continue;
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
    return parsed.length > 0 ? parsed : [...constants_1.DEFAULT_PRICE_BUCKETS_VND];
}
function buildRoomUrl(roomId, checkIn, checkOut) {
    if (checkIn && checkOut) {
        return `${constants_1.AIRBNB_BASE_URL}/rooms/${roomId}?check_in=${encodeURIComponent(checkIn)}&check_out=${encodeURIComponent(checkOut)}&locale=en`;
    }
    return `${constants_1.AIRBNB_BASE_URL}/rooms/${roomId}?locale=en`;
}
function parseProxyUrl(raw) {
    const value = (raw || '').trim();
    if (!value)
        return undefined;
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
    }
    catch {
        return { server: value };
    }
}
function calculateNights(checkIn, checkOut) {
    const d1 = new Date(checkIn);
    const d2 = new Date(checkOut);
    if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()))
        return 1;
    const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(1, diff);
}
function parseNumericAmount(priceText) {
    if (typeof priceText === 'number' && Number.isFinite(priceText)) {
        return Math.max(0, Math.round(priceText * 100) / 100);
    }
    if (!priceText || typeof priceText !== 'string')
        return 0;
    const cleaned = priceText.replace(/[^\d.,]/g, '').trim();
    if (!cleaned)
        return 0;
    let normalized = cleaned;
    if (cleaned.includes(',') && cleaned.includes('.')) {
        const lastComma = cleaned.lastIndexOf(',');
        const lastDot = cleaned.lastIndexOf('.');
        if (lastDot > lastComma) {
            normalized = cleaned.replace(/,/g, '');
        }
        else {
            normalized = cleaned.replace(/\./g, '').replace(',', '.');
        }
    }
    else if (cleaned.includes(',')) {
        const parts = cleaned.split(',');
        if (parts[parts.length - 1].length === 3) {
            normalized = cleaned.replace(/,/g, '');
        }
        else {
            normalized = cleaned.replace(',', '.');
        }
    }
    else if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length > 2 || (parts.length === 2 && parts[1].length === 3)) {
            normalized = cleaned.replace(/\./g, '');
        }
    }
    const num = parseFloat(normalized);
    return Number.isFinite(num) && num > 0 ? Math.round(num * 100) / 100 : 0;
}
function detectCurrencyFromText(priceText, fallback = 'USD') {
    if (!priceText || typeof priceText !== 'string')
        return fallback;
    if (priceText.includes('₫') || /vnd/i.test(priceText))
        return 'VND';
    if (priceText.includes('$') || /usd/i.test(priceText))
        return 'USD';
    if (priceText.includes('€') || /eur/i.test(priceText))
        return 'EUR';
    if (priceText.includes('฿') || /thb/i.test(priceText))
        return 'THB';
    return fallback;
}
function normalizePriceBreakdown(priceText, qualifierText = '', nights = 1) {
    const amount = parseNumericAmount(priceText);
    if (amount <= 0)
        return { pricePerNight: 0, totalPrice: 0 };
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
    const perNight = Math.round(amount);
    return {
        pricePerNight: perNight,
        totalPrice: Math.round(perNight * Math.max(1, nights)),
    };
}
function findObjectsWhere(root, predicate, results = [], visited = new WeakSet()) {
    if (!root || typeof root !== 'object')
        return results;
    if (visited.has(root))
        return results;
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
function formatDateStamp(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
function sanitizeFilename(name) {
    return String(name || 'Unknown')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '');
}
function haversineMeters(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
function isInvalidBlockedTitle(title) {
    const t = String(title || '').trim().toLowerCase();
    if (!t)
        return true;
    return (t === 'stay tuned' ||
        t.includes('stay tuned') ||
        t.includes('temporarily unavailable') ||
        t.includes('error code: 503') ||
        t.includes('pardon our interruption') ||
        t.includes('429 too many requests') ||
        t.includes('verify you are human'));
}
//# sourceMappingURL=helpers.js.map