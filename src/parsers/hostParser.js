import { normalizeText } from '../config/index.js';
import { buildListingUrl, decodeAirbnbId, findObjectsWhere } from '../utils/helpers.js';
import { extractDeferredStateFromHtml, parseAvgRatingLocalized } from './niobeParser.js';

export function cleanHostLabel(raw) {
  return String(raw || '')
    .replace(
      /^(?:Chủ nhà|Host|Hosted by|Gặp gỡ|Meet your host(?:,)?|Meet|Thông tin về|About|Bài đăng của|Listings by|Hỏi)\s*:?\s*/i,
      ''
    )
    .replace(/\s+về$/i, '')
    .trim();
}

export function isValidHostName(name) {
  if (!name || typeof name !== 'string') return false;
  const trimmed = cleanHostLabel(name);
  // Reject 1-character avatar initials (e.g. "L", "G", "T") and generic UI/review headings
  if (trimmed.length < 2) return false;
  if (
    /^(gặp gỡ|meet your host|meet|chủ nhà|host|superhost|chủ nhà siêu cấp|profile|hồ sơ|thông tin về|about|airbnb|đánh giá|reviews)$/i.test(
      trimmed
    ) ||
    /khách nói gì|what guests|nói gì về|đánh giá từ|reviews about|mục cho thuê|listings/i.test(
      trimmed
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Extract full hostName from Passport Profile JSON payloads (`smartName`, `firstName`, etc.).
 */
export function extractHostNameFromPayloads(payloads) {
  const list = Array.isArray(payloads) ? payloads : [payloads];

  for (const root of list) {
    if (!root || typeof root !== 'object') continue;

    const candidates = findObjectsWhere(
      root,
      (obj) =>
        typeof obj.smartName === 'string' ||
        typeof obj.firstName === 'string' ||
        typeof obj.hostName === 'string' ||
        (obj.__typename && /UserProfile|Passport/i.test(obj.__typename) && typeof obj.name === 'string')
    );

    for (const node of candidates) {
      const raw = node.smartName || node.firstName || node.hostName || node.name;
      if (isValidHostName(raw)) {
        return cleanHostLabel(raw);
      }
    }
  }
  return '';
}

function cityMatches(nodeCity, title, targetCity) {
  const normTarget = normalizeText(targetCity)
    .replace(/\b(city|thanh pho|tp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normTarget) return true;

  const normNodeCity = normalizeText(nodeCity);
  if (!normNodeCity) return true;

  if (normNodeCity.includes(normTarget) || normTarget.includes(normNodeCity)) {
    return true;
  }
  if (normalizeText(title).includes(normTarget)) {
    return true;
  }
  // Keep district/ward names (e.g. "Quận 1", "Thảo Điền")
  if (/\b(quan|district|phuong|ward|binh thanh|thu duc|cau giay)\b/.test(normNodeCity)) {
    return true;
  }
  return false;
}

/**
 * Parse listings from a Host Profile page (`/users/show/[Host_ID]`)
 * using `data-deferred-state-*` or `UserProfile` / `HostListings` GraphQL JSON.
 */
export function parseHostListingsPayloads(payloads, targetCity = '') {
  const list = Array.isArray(payloads) ? payloads : [payloads];
  const resultsMap = new Map();

  for (const root of list) {
    if (!root || typeof root !== 'object') continue;

    // 1. Recursive search for listing objects, demandStayListing, or listingId nodes
    const candidates = findObjectsWhere(
      root,
      (obj) =>
        Boolean(obj.demandStayListing?.id) ||
        Boolean(obj.listingId) ||
        (obj.__typename && /Listing/i.test(obj.__typename) && (obj.id || obj.listingId)) ||
        (typeof obj.id === 'string' &&
          (obj.name || obj.title || obj.seoTitle) &&
          (obj.roomType ||
            obj.propertyType ||
            obj.avgRating !== undefined ||
            obj.contextualPictures ||
            obj.pictureUrl))
    );

    for (const node of candidates) {
      const listingId = decodeAirbnbId(
        node.listingId || node.demandStayListing?.id || node.id
      );
      if (!listingId) continue;

      const title =
        node.name ||
        node.title ||
        node.seoTitle ||
        `Airbnb #${listingId}`;

      const nodeCity = node.city || node.localizedCity || node.location || '';
      if (!cityMatches(nodeCity, title, targetCity)) {
        continue;
      }

      let ratingAverage = Number(node.avgRating || node.starRating || 0);
      let ratingCount = Number(node.reviewsCount || node.reviewCount || 0);
      if ((!ratingAverage || !ratingCount) && node.ratingA11yLabel) {
        const parsed = parseAvgRatingLocalized(node.ratingA11yLabel);
        if (!ratingAverage) ratingAverage = parsed.ratingAverage;
        if (!ratingCount) ratingCount = parsed.ratingCount;
      }

      if (!resultsMap.has(listingId)) {
        resultsMap.set(listingId, {
          listingId,
          listingUrl: buildListingUrl(listingId),
          title: String(title).trim(),
          propertyType: node.propertyType || node.roomType || '',
          ratingAverage,
          ratingCount,
          source: 'host_expansion',
        });
      }
    }
  }

  return Array.from(resultsMap.values());
}

export function parseHostProfileHtml(html, targetCity = '') {
  const states = extractDeferredStateFromHtml(html);
  const listings = parseHostListingsPayloads(states, targetCity);

  // Fallback: extract <a href="/rooms/[ID]"> links directly from HTML if JSON yielded nothing
  if (listings.length === 0 && typeof html === 'string') {
    const seen = new Set();
    const regex = /href=["'](?:https?:\/\/[^"']*)?\/rooms\/(\d{5,})[^"']*["']/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const listingId = match[1];
      if (seen.has(listingId)) continue;
      seen.add(listingId);
      listings.push({
        listingId,
        listingUrl: buildListingUrl(listingId),
        title: `Airbnb #${listingId}`,
        propertyType: '',
        ratingAverage: 0,
        ratingCount: 0,
        source: 'host_expansion',
      });
    }
  }

  return listings;
}

export function extractHostNameFromHtml(html) {
  const states = extractDeferredStateFromHtml(html);
  const fromJson = extractHostNameFromPayloads(states);
  if (fromJson) return fromJson;

  if (typeof html === 'string') {
    for (const tag of ['h1', 'h2']) {
      const tagRegex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
      let match;
      while ((match = tagRegex.exec(html)) !== null) {
        const clean = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        if (isValidHostName(clean)) {
          return cleanHostLabel(clean);
        }
      }
    }
  }
  return '';
}
