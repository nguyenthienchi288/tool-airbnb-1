"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PdpParserService = void 0;
const common_1 = require("@nestjs/common");
const helpers_1 = require("../../common/helpers");
const constants_1 = require("../../config/constants");
let PdpParserService = class PdpParserService {
    extractPriceFromBookIt(bookItData, nights = 1) {
        if (!bookItData || typeof bookItData !== 'object') {
            return { priceRaw: '', totalPriceRaw: '', pricePerNight: 0, totalPrice: 0, currency: 'USD' };
        }
        let priceRaw = '';
        let totalPriceRaw = '';
        const primaryLines = (0, helpers_1.findObjectsWhere)(bookItData, (obj) => obj && typeof obj === 'object' && obj.structuredDisplayPrice?.primaryLine);
        if (primaryLines.length > 0) {
            const pl = primaryLines[0].structuredDisplayPrice.primaryLine;
            totalPriceRaw = String(pl.discountedPrice || pl.price || pl.originalPrice || '').trim();
        }
        const expContainers = (0, helpers_1.findObjectsWhere)(bookItData, (obj) => obj && typeof obj === 'object' && obj.explanationData && Array.isArray(obj.explanationData.priceDetails));
        for (const container of expContainers) {
            for (const detail of container.explanationData.priceDetails) {
                const items = Array.isArray(detail?.items) ? detail.items : [];
                for (const item of items) {
                    const desc = String(item?.description || '');
                    const m = desc.match(/\d+\s+nights?\s*x\s*([^\s]+)/i);
                    if (m?.[1]) {
                        priceRaw = m[1].trim();
                        break;
                    }
                }
                if (priceRaw)
                    break;
            }
            if (priceRaw)
                break;
        }
        if (!priceRaw) {
            const descObjs = (0, helpers_1.findObjectsWhere)(bookItData, (obj) => obj && typeof obj === 'object' && typeof obj.description === 'string' && /\d+\s+nights?\s*x/i.test(obj.description));
            if (descObjs.length > 0) {
                const m = String(descObjs[0].description).match(/\d+\s+nights?\s*x\s*([^\s]+)/i);
                if (m?.[1])
                    priceRaw = m[1].trim();
            }
        }
        if (!totalPriceRaw) {
            const priceStringObjs = (0, helpers_1.findObjectsWhere)(bookItData, (obj) => obj && typeof obj === 'object' && typeof obj.priceString === 'string' && obj.priceString.trim().length > 0);
            if (priceStringObjs.length > 0) {
                totalPriceRaw = String(priceStringObjs[priceStringObjs.length - 1].priceString).trim();
            }
        }
        if (!priceRaw && totalPriceRaw) {
            priceRaw = totalPriceRaw;
        }
        if (priceRaw.includes('__typename')) {
            priceRaw = '';
        }
        const totalNum = Math.round((0, helpers_1.parseNumericAmount)(totalPriceRaw));
        let perNightNum = Math.round((0, helpers_1.parseNumericAmount)(priceRaw));
        if (perNightNum <= 0 && totalNum > 0) {
            perNightNum = Math.round(totalNum / Math.max(1, nights));
        }
        const finalTotal = totalNum > 0 ? totalNum : Math.round(perNightNum * Math.max(1, nights));
        const currency = (0, helpers_1.detectCurrencyFromText)(priceRaw || totalPriceRaw, 'USD');
        return {
            priceRaw,
            totalPriceRaw,
            pricePerNight: perNightNum,
            totalPrice: finalTotal,
            currency,
        };
    }
    parseOverviewItems(items) {
        let guestsText = '';
        let bedroomsText = '';
        let bedsText = '';
        let bathroomsText = '';
        for (const raw of items) {
            const item = raw.trim();
            const low = item.toLowerCase();
            if ((low.includes('guest') || low.includes('khách')) && !guestsText) {
                guestsText = item;
            }
            else if ((low.includes('bedroom') || low.includes('studio') || low.includes('phòng ngủ')) && !bedroomsText) {
                bedroomsText = item;
            }
            else if ((low.includes('bed') || low.includes('giường')) && !low.includes('bedroom') && !bedsText) {
                bedsText = item;
            }
            else if ((low.includes('bath') || low.includes('phòng tắm')) && !bathroomsText) {
                bathroomsText = item;
            }
        }
        const extractNum = (txt, isStudio = false) => {
            if (isStudio && /studio/i.test(txt))
                return 1;
            const m = txt.match(/(\d+(?:\.\d+)?)/);
            return m ? Number(m[1]) : 0;
        };
        return {
            guestsText,
            bedroomsText,
            bedsText,
            bathroomsText,
            guests: Math.round(extractNum(guestsText)),
            bedrooms: Math.round(extractNum(bedroomsText, true)),
            beds: Math.round(extractNum(bedsText)),
            bathrooms: extractNum(bathroomsText),
        };
    }
    detectBuildingAndHighRise(params) {
        const combined = `${params.title || ''} ${params.subtitle || ''} ${params.description || ''} ${params.locationText || ''}`;
        const m = combined.match(constants_1.KNOWN_BUILDING_REGEX);
        const buildingName = m ? (0, helpers_1.cleanControlChars)(m[1]) : '';
        const fullText = `${combined} ${(params.amenities || []).join(' ')}`.toLowerCase();
        const isHighRise = buildingName.length > 0 ||
            constants_1.HIGH_RISE_KEYWORDS.some((kw) => fullText.includes(kw))
            ? 1
            : 0;
        return { buildingName, isHighRise };
    }
    cleanHostName(raw) {
        let text = (0, helpers_1.cleanControlChars)(raw);
        text = text
            .replace(/^(Hosted by|Host:|Chủ nhà:|Thông tin về|About|Meet your host)\s+/i, '')
            .trim();
        if (!text || text.length <= 1)
            return '';
        return text;
    }
    async extractFromPage(params) {
        const { page, listingId, url, locationQuery, checkIn, checkOut, nights, bookItData } = params;
        let jsonData = null;
        try {
            const deferredLoc = page.locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]').first();
            if ((await deferredLoc.count()) > 0) {
                const rawJson = await deferredLoc.innerText();
                if (rawJson) {
                    jsonData = JSON.parse(rawJson);
                }
            }
        }
        catch {
            jsonData = null;
        }
        let title = '';
        try {
            const h1 = page.locator('h1').first();
            if ((await h1.count()) > 0) {
                const candidateTitle = (0, helpers_1.cleanControlChars)(await h1.innerText());
                if ((0, helpers_1.isInvalidBlockedTitle)(candidateTitle)) {
                    return null;
                }
                title = candidateTitle;
            }
        }
        catch {
        }
        if (!title && jsonData) {
            const titleObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && (obj.listingTitle || obj.ogDescription));
            if (titleObjs.length > 0) {
                const candidateTitle = (0, helpers_1.cleanControlChars)(titleObjs[0].listingTitle || titleObjs[0].ogDescription);
                if (!(0, helpers_1.isInvalidBlockedTitle)(candidateTitle)) {
                    title = candidateTitle;
                }
            }
        }
        let subtitle = '';
        try {
            const h2 = page.locator('h2').first();
            if ((await h2.count()) > 0) {
                subtitle = (0, helpers_1.cleanControlChars)(await h2.innerText());
            }
        }
        catch {
        }
        if (!subtitle && jsonData) {
            const propObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && (obj.sharingConfig?.propertyType || obj.sectionData?.title));
            if (propObjs.length > 0) {
                subtitle = (0, helpers_1.cleanControlChars)(propObjs[0].sharingConfig?.propertyType || propObjs[0].sectionData?.title);
            }
        }
        let overviewItems = [];
        try {
            const ol = page.locator('ol').first();
            if ((await ol.count()) > 0) {
                const olText = await ol.innerText();
                overviewItems = olText
                    .split(/[·\n]+/)
                    .map((s) => s.trim())
                    .filter(Boolean);
            }
        }
        catch {
        }
        const parsedOverview = this.parseOverviewItems(overviewItems);
        if (jsonData) {
            const scObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && obj.sharingConfig);
            if (scObjs.length > 0) {
                const sc = scObjs[0].sharingConfig;
                if (!parsedOverview.guests && sc.personCapacity) {
                    parsedOverview.guests = Number(sc.personCapacity) || 0;
                    parsedOverview.guestsText = `${parsedOverview.guests} guests`;
                }
                if ((!parsedOverview.bedrooms || !parsedOverview.beds || !parsedOverview.bathrooms) && typeof sc.title === 'string') {
                    const fallback = this.parseOverviewItems(sc.title.split('·'));
                    if (!parsedOverview.guests) {
                        parsedOverview.guests = fallback.guests;
                        parsedOverview.guestsText = fallback.guestsText;
                    }
                    if (!parsedOverview.bedrooms) {
                        parsedOverview.bedrooms = fallback.bedrooms;
                        parsedOverview.bedroomsText = fallback.bedroomsText;
                    }
                    if (!parsedOverview.beds) {
                        parsedOverview.beds = fallback.beds;
                        parsedOverview.bedsText = fallback.bedsText;
                    }
                    if (!parsedOverview.bathrooms) {
                        parsedOverview.bathrooms = fallback.bathrooms;
                        parsedOverview.bathroomsText = fallback.bathroomsText;
                    }
                }
            }
        }
        let description = '';
        if (jsonData) {
            const htmlObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && typeof obj.htmlText === 'string' && obj.htmlText.length > 10);
            if (htmlObjs.length > 0) {
                description = (0, helpers_1.cleanControlChars)(htmlObjs.map((o) => o.htmlText).join(' ').slice(0, 1500));
            }
        }
        let imagesCount = 0;
        if (jsonData) {
            const mediaObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && Array.isArray(obj.mediaItems));
            for (const m of mediaObjs) {
                if (m.mediaItems.length > imagesCount) {
                    imagesCount = m.mediaItems.length;
                }
            }
            if (imagesCount === 0) {
                const previewObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && Array.isArray(obj.previewImages));
                if (previewObjs.length > 0) {
                    imagesCount = previewObjs[0].previewImages.length;
                }
            }
        }
        let lat = null;
        let lng = null;
        const amenitiesSet = new Set();
        if (jsonData) {
            const coordObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj &&
                typeof obj === 'object' &&
                typeof obj.lat === 'number' &&
                typeof obj.lng === 'number' &&
                Math.abs(obj.lat) <= 90 &&
                Math.abs(obj.lng) <= 180);
            if (coordObjs.length > 0) {
                lat = coordObjs[0].lat;
                lng = coordObjs[0].lng;
            }
            const amenityGroups = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj &&
                typeof obj === 'object' &&
                (Array.isArray(obj.seeAllAmenitiesGroups) || Array.isArray(obj.previewAmenitiesGroups)));
            for (const container of amenityGroups) {
                const groups = container.seeAllAmenitiesGroups || container.previewAmenitiesGroups || [];
                for (const group of groups) {
                    const items = Array.isArray(group?.amenities) ? group.amenities : [];
                    for (const a of items) {
                        if (a?.available !== false && typeof a?.title === 'string' && a.title.trim()) {
                            amenitiesSet.add((0, helpers_1.cleanControlChars)(a.title));
                        }
                    }
                }
            }
        }
        let hostId = '';
        let hostUrl = '';
        if (jsonData) {
            const ctxObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && obj.pdpContext?.hostId);
            if (ctxObjs.length > 0) {
                hostId = String(ctxObjs[0].pdpContext.hostId).trim();
            }
        }
        if (!hostId) {
            try {
                const hostLink = page.locator('a[href*="/users/show/"]').first();
                if ((await hostLink.count()) > 0) {
                    const href = (await hostLink.getAttribute('href')) || '';
                    const m = href.match(/\/users\/show\/(\d+)/);
                    if (m?.[1])
                        hostId = m[1];
                }
            }
            catch {
            }
        }
        if (hostId) {
            hostUrl = `${constants_1.AIRBNB_BASE_URL}/users/show/${hostId}`;
        }
        let hostName = '';
        try {
            const hostedBy = page.locator('text=/^Hosted by /i').first();
            if ((await hostedBy.count()) > 0) {
                hostName = this.cleanHostName(await hostedBy.innerText());
            }
        }
        catch {
        }
        if (!hostName && jsonData) {
            const cardObjs = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj && typeof obj === 'object' && (obj.cardData?.name || obj.smartName || obj.hostAvatar?.title));
            for (const obj of cardObjs) {
                const candidate = this.cleanHostName(obj.cardData?.name || obj.smartName || obj.hostAvatar?.title || '');
                if (candidate) {
                    hostName = candidate;
                    break;
                }
            }
        }
        const priceInfo = this.extractPriceFromBookIt(bookItData, nights);
        if (!title && !hostUrl) {
            return null;
        }
        const amenitiesArr = Array.from(amenitiesSet);
        const { buildingName, isHighRise } = this.detectBuildingAndHighRise({
            title,
            subtitle,
            description,
            amenities: amenitiesArr,
        });
        return {
            listing_id: listingId,
            location_query: locationQuery,
            checkin: checkIn,
            checkout: checkOut,
            nights,
            title,
            url,
            subtitle,
            guests_text: parsedOverview.guestsText,
            bedrooms_text: parsedOverview.bedroomsText,
            beds_text: parsedOverview.bedsText,
            bathrooms_text: parsedOverview.bathroomsText,
            guests: parsedOverview.guests,
            bedrooms: parsedOverview.bedrooms,
            beds: parsedOverview.beds,
            bathrooms: parsedOverview.bathrooms,
            description,
            price_per_night: priceInfo.pricePerNight,
            total_price: priceInfo.totalPrice,
            price_raw: priceInfo.priceRaw,
            total_price_raw: priceInfo.totalPriceRaw,
            currency: priceInfo.currency,
            building_name: buildingName,
            is_high_rise: isHighRise,
            collection_status: 'Mới thu thập',
            images_count: imagesCount,
            lat,
            lng,
            amenities: amenitiesArr,
            host_id: hostId,
            host_name: hostName,
            host_url: hostUrl,
            pdp_scraped: 1,
        };
    }
    extractSearchListingsFromJson(jsonData, meta) {
        if (!jsonData || typeof jsonData !== 'object')
            return [];
        const resultsMap = new Map();
        const candidates = (0, helpers_1.findObjectsWhere)(jsonData, (obj) => obj &&
            typeof obj === 'object' &&
            (obj.demandStayListing || (obj.listing && (obj.listing.id || obj.listing.name))));
        for (const item of candidates) {
            const demand = item.demandStayListing;
            const legacy = item.listing;
            const rawId = demand?.id || legacy?.id || item.listingId || item.id;
            const listingId = (0, helpers_1.decodeAirbnbId)(rawId);
            if (!listingId || resultsMap.has(listingId))
                continue;
            const title = (0, helpers_1.cleanControlChars)(demand?.description?.name?.localizedStringWithTranslationPreference ||
                legacy?.name ||
                item.title ||
                '');
            const roomType = (0, helpers_1.cleanControlChars)(legacy?.roomTypeCategory || item.subtitle || legacy?.roomType || '');
            const locationText = (0, helpers_1.cleanControlChars)(legacy?.city || legacy?.localizedCityName || item.locationText || meta.locationQuery);
            const lat = typeof demand?.location?.coordinate?.latitude === 'number'
                ? demand.location.coordinate.latitude
                : typeof legacy?.coordinate?.latitude === 'number'
                    ? legacy.coordinate.latitude
                    : null;
            const lng = typeof demand?.location?.coordinate?.longitude === 'number'
                ? demand.location.coordinate.longitude
                : typeof legacy?.coordinate?.longitude === 'number'
                    ? legacy.coordinate.longitude
                    : null;
            const primaryLine = item.structuredDisplayPrice?.primaryLine ||
                item.pricingQuote?.structuredStayDisplayPrice?.primaryLine ||
                null;
            const priceText = String(primaryLine?.discountedPrice || primaryLine?.price || primaryLine?.originalPrice || '').trim();
            const qualifierText = String(primaryLine?.qualifier || '').trim();
            const { pricePerNight, totalPrice } = (0, helpers_1.normalizePriceBreakdown)(priceText, qualifierText, meta.nights);
            const currency = (0, helpers_1.detectCurrencyFromText)(priceText, 'USD');
            let rating = 0;
            let reviewsCount = 0;
            const ratingLabel = String(item.avgRatingA11yLabel || item.avgRatingLocalized || '');
            const rMatch = ratingLabel.match(/(\d+[.,]\d+|\d+)/);
            if (rMatch) {
                rating = parseFloat(rMatch[1].replace(',', '.')) || 0;
            }
            const revMatch = ratingLabel.match(/(\d+)\s*(?:reviews?|đánh giá|nhận xét)/i);
            if (revMatch) {
                reviewsCount = parseInt(revMatch[1], 10) || 0;
            }
            const hostNameRaw = (0, helpers_1.cleanControlChars)(item.hostName || legacy?.user?.firstName || item.primaryHost?.firstName || '');
            const hostName = hostNameRaw.length > 1 ? hostNameRaw : '';
            const { buildingName, isHighRise } = this.detectBuildingAndHighRise({
                title,
                subtitle: roomType,
                locationText,
            });
            resultsMap.set(listingId, {
                listing_id: listingId,
                location_query: meta.locationQuery,
                checkin: meta.checkIn,
                checkout: meta.checkOut,
                nights: meta.nights,
                title,
                url: (0, helpers_1.buildRoomUrl)(listingId, meta.checkIn, meta.checkOut),
                subtitle: roomType,
                guests_text: '',
                bedrooms_text: '',
                beds_text: '',
                bathrooms_text: '',
                guests: 0,
                bedrooms: 0,
                beds: 0,
                bathrooms: 0,
                description: '',
                price_per_night: pricePerNight,
                total_price: totalPrice,
                price_raw: priceText,
                total_price_raw: '',
                currency,
                rating,
                reviews_count: reviewsCount,
                location_text: locationText,
                building_name: buildingName,
                is_high_rise: isHighRise,
                collection_status: 'Chưa đọc PDP (Dừng sớm)',
                images_count: 0,
                lat,
                lng,
                amenities: [],
                host_id: '',
                host_name: hostName,
                host_url: '',
                pdp_scraped: 0,
            });
        }
        return Array.from(resultsMap.values());
    }
};
exports.PdpParserService = PdpParserService;
exports.PdpParserService = PdpParserService = __decorate([
    (0, common_1.Injectable)()
], PdpParserService);
//# sourceMappingURL=pdp-parser.service.js.map