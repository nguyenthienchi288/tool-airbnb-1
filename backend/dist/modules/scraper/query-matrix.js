"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateStrategicDateWindows = generateStrategicDateWindows;
exports.buildSearchCombinations = buildSearchCombinations;
const helpers_1 = require("../../common/helpers");
const constants_1 = require("../../config/constants");
function toIsoDate(d) {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
function addDays(base, days) {
    const d = new Date(base.getTime());
    d.setDate(d.getDate() + days);
    return d;
}
function formatShortDate(iso) {
    if (!iso || !iso.includes('-'))
        return iso;
    const parts = iso.split('-');
    if (parts.length !== 3)
        return iso;
    return `${parts[2]}/${parts[1]}`;
}
function formatDateWindowLabel(checkIn, checkOut, customLabel) {
    if (!checkIn || !checkOut)
        return customLabel || 'Flexible';
    return `${formatShortDate(checkIn)}-${formatShortDate(checkOut)}`;
}
function generateStrategicDateWindows(baseDate = new Date()) {
    const today = new Date(baseDate.getFullYear(), baseDate.getMonth(), baseDate.getDate());
    const dayOfWeek = today.getDay();
    const daysToNextMonday = ((8 - dayOfWeek) % 7) || 7;
    const nearIn = addDays(today, 2);
    const nearOut = addDays(nearIn, 2);
    const midWeekIn = addDays(today, daysToNextMonday + 1);
    const midWeekOut = addDays(midWeekIn, 2);
    const weekendIn = addDays(today, daysToNextMonday + 4);
    const weekendOut = addDays(weekendIn, 2);
    const farIn = addDays(today, 35);
    const farOut = addDays(farIn, 3);
    return [
        { checkIn: toIsoDate(nearIn), checkOut: toIsoDate(nearOut), label: 'Cận ngày (2 đêm)' },
        { checkIn: toIsoDate(midWeekIn), checkOut: toIsoDate(midWeekOut), label: 'Giữa tuần tới (T3-T5)' },
        { checkIn: toIsoDate(weekendIn), checkOut: toIsoDate(weekendOut), label: 'Cuối tuần tới (T6-CN)' },
        { checkIn: toIsoDate(farIn), checkOut: toIsoDate(farOut), label: 'Đặt xa (35 ngày, 3 đêm)' },
    ];
}
function shuffleInPlace(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
}
function buildSearchCombinations(input) {
    const rawKeywords = input.keywords && input.keywords.length > 0
        ? input.keywords
        : input.cityName
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean);
    const keywordSet = new Set();
    for (const kw of rawKeywords) {
        const clean = kw.trim();
        if (clean)
            keywordSet.add(clean);
    }
    if (keywordSet.size === 0 && input.cityName.trim()) {
        keywordSet.add(input.cityName.trim());
    }
    const keywords = Array.from(keywordSet);
    const dateMap = new Map();
    const addWindow = (w) => {
        const ci = (w.checkIn || '').trim();
        const co = (w.checkOut || '').trim();
        if ((!ci && co) || (ci && !co))
            return;
        const key = `${ci}__${co}`;
        if (!dateMap.has(key)) {
            dateMap.set(key, { checkIn: ci, checkOut: co, label: w.label });
        }
    };
    if (input.dateWindows && input.dateWindows.length > 0) {
        for (const w of input.dateWindows)
            addWindow(w);
    }
    else if (input.checkIn?.trim() && input.checkOut?.trim()) {
        addWindow({ checkIn: input.checkIn.trim(), checkOut: input.checkOut.trim() });
    }
    if (input.autoGenerateStrategicDates) {
        for (const w of generateStrategicDateWindows())
            addWindow(w);
    }
    if (input.includeFlexibleDates || dateMap.size === 0) {
        addWindow({ checkIn: '', checkOut: '', label: 'Flexible' });
    }
    const dateWindows = Array.from(dateMap.values());
    let priceBuckets;
    if (!input.enablePriceSlicing) {
        priceBuckets = [{ min: 0, max: null, label: 'Tất cả mức giá', splitDepth: 0 }];
    }
    else if (input.priceBucketsText && input.priceBucketsText.trim()) {
        priceBuckets = (0, helpers_1.parsePriceBucketsText)(input.priceBucketsText).map((b) => ({
            ...b,
            splitDepth: 0,
        }));
    }
    else if (input.cityName.toLowerCase().includes('seoul')) {
        priceBuckets = constants_1.SEOUL_PRICE_BUCKETS_VND.map((b) => ({ ...b, splitDepth: 0 }));
    }
    else {
        priceBuckets = (0, helpers_1.parsePriceBucketsText)().map((b) => ({ ...b, splitDepth: 0 }));
    }
    const combinations = [];
    for (const keyword of keywords) {
        for (const dw of dateWindows) {
            const nights = dw.checkIn && dw.checkOut ? (0, helpers_1.calculateNights)(dw.checkIn, dw.checkOut) : 1;
            const dateLabel = formatDateWindowLabel(dw.checkIn, dw.checkOut, dw.label);
            for (const bucket of priceBuckets) {
                combinations.push({
                    index: 0,
                    total: 0,
                    keyword,
                    checkIn: dw.checkIn,
                    checkOut: dw.checkOut,
                    dateLabel,
                    nights,
                    bucket: { ...bucket },
                });
            }
        }
    }
    shuffleInPlace(combinations);
    const total = combinations.length;
    combinations.forEach((c, idx) => {
        c.index = idx + 1;
        c.total = total;
    });
    return {
        combinations,
        keywordsCount: keywords.length,
        dateWindowsCount: dateWindows.length,
        priceBucketsCount: priceBuckets.length,
    };
}
//# sourceMappingURL=query-matrix.js.map