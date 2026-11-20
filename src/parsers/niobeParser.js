import {
  buildListingUrl,
  decodeAirbnbId,
  findObjectsWhere,
  normalizePricePerNight,
} from '../utils/helpers.js';

/**
 * Extract JSON payloads from Airbnb HTML hydration script tags:
 * <script id="data-deferred-state-0" type="application/json">...</script>
 */
export function extractDeferredStateFromHtml(html) {
  if (!html || typeof html !== 'string') return [];
  const states = [];
  const regex =
    /<script[^>]*id=["']data-deferred-state-\d+["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1]);
      states.push(parsed);
    } catch {
      // Ignore malformed script tag
    }
  }
  return states;
}

/**
 * Parse ratingAverage and ratingCount from Airbnb's localized string
 * such as "4,89 (142)" or "4.92 (35)" or "Mới" / "New".
 */
export function parseAvgRatingLocalized(str) {
  if (!str || typeof str !== 'string') {
    return { ratingAverage: 0, ratingCount: 0 };
  }
  const normalized = str.replace(',', '.');
  const avgMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  const countMatch = normalized.match(/\((\d[\d.,]*)\)/);
  const ratingAverage = avgMatch ? parseFloat(avgMatch[1]) : 0;
  const ratingCount = countMatch
    ? parseInt(countMatch[1].replace(/[.,]/g, ''), 10)
    : 0;
  return {
    ratingAverage: Number.isFinite(ratingAverage) ? ratingAverage : 0,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : 0,
  };
}

/**
 * Parse a single StaySearchResult object from Niobe / Hyperloop JSON.
 */
export function parseStaySearchResult(node, nights = 1) {
  if (!node || typeof node !== 'object') return null;

  const rawId =
    node?.demandStayListing?.id ||
    node?.listing?.id ||
    node?.id;
  const listingId = decodeAirbnbId(rawId);
  if (!listingId) return null;

  const title =
    node?.title ||
    node?.name ||
    node?.demandStayListing?.description?.name?.localizedStringWithTranslationPreference ||
    node?.listing?.name ||
    `Airbnb #${listingId}`;

  // Price extraction from structuredDisplayPrice
  const primaryLine = node?.structuredDisplayPrice?.primaryLine || {};
  const priceText =
    primaryLine.discountedPrice ||
    primaryLine.price ||
    primaryLine.originalPrice ||
    node?.priceQuote?.rate?.amountFormatted ||
    null;
  const qualifierText = primaryLine.qualifier || primaryLine.accessibilityLabel || '';
  const pricePerNight = normalizePricePerNight(priceText, qualifierText, nights);

  // Rating & reviews
  let ratingAverage = Number(node?.ratingAverage || node?.avgRating || 0);
  let ratingCount = Number(node?.ratingCount || node?.reviewsCount || 0);
  if ((!ratingAverage || !ratingCount) && node?.avgRatingLocalized) {
    const parsed = parseAvgRatingLocalized(node.avgRatingLocalized);
    if (!ratingAverage) ratingAverage = parsed.ratingAverage;
    if (!ratingCount) ratingCount = parsed.ratingCount;
  }

  // Badges (GUEST_FAVORITE, TOP_X_GUEST_FAVORITE, etc.)
  const badges = Array.isArray(node?.badges) ? node.badges : [];
  const badgeLabels = badges
    .map((b) => b?.loggingContext?.badgeType || b?.text || b?.id || '')
    .filter(Boolean);
  const isGuestFavorite = badgeLabels.some(
    (label) =>
      /GUEST_FAVORITE/i.test(label) ||
      /TOP_.*GUEST_FAVORITE/i.test(label) ||
      /Được khách yêu thích/i.test(label) ||
      /Guest favorite/i.test(label)
  );

  // Optional coordinates if present in search state
  const coord = node?.demandStayListing?.location?.coordinate || node?.listing?.coordinate;
  const lat = typeof coord?.latitude === 'number' ? coord.latitude : null;
  const lng = typeof coord?.longitude === 'number' ? coord.longitude : null;

  return {
    listingId,
    listingUrl: buildListingUrl(listingId),
    title: String(title).trim(),
    pricePerNight,
    ratingAverage,
    ratingCount,
    isGuestFavorite,
    badgeLabel: badgeLabels.join(', '),
    lat,
    lng,
  };
}

/**
 * Extract all StaySearchResult items & nextPageCursor from a Niobe JSON object
 * (either from `data-deferred-state-*` or `/api/v3/StaysSearch` response).
 */
export function parseStaysSearchPayload(jsonPayload, nights = 1) {
  const resultsMap = new Map();
  let nextCursor = null;

  if (!jsonPayload || typeof jsonPayload !== 'object') {
    return { listings: [], nextCursor };
  }

  // Locate StaySearchResult nodes anywhere in niobeClientData or full payload
  const searchNodes = findObjectsWhere(
    jsonPayload,
    (obj) =>
      obj.__typename === 'StaySearchResult' ||
      (obj.demandStayListing && obj.structuredDisplayPrice)
  );

  for (const node of searchNodes) {
    const parsed = parseStaySearchResult(node, nights);
    if (parsed && !resultsMap.has(parsed.listingId)) {
      resultsMap.set(parsed.listingId, parsed);
    }
  }

  // Locate paginationInfo.nextPageCursor
  const paginationNodes = findObjectsWhere(
    jsonPayload,
    (obj) => typeof obj.nextPageCursor === 'string' && obj.nextPageCursor.length > 0
  );
  if (paginationNodes.length > 0) {
    nextCursor = paginationNodes[0].nextPageCursor;
  }

  return {
    listings: Array.from(resultsMap.values()),
    nextCursor,
  };
}

/**
 * Parse all deferred-state script tags from a search page HTML.
 */
export function parseSearchHtml(html, nights = 1) {
  const states = extractDeferredStateFromHtml(html);
  const merged = new Map();
  let nextCursor = null;

  for (const state of states) {
    const { listings, nextCursor: cursor } = parseStaysSearchPayload(state, nights);
    for (const item of listings) {
      if (!merged.has(item.listingId)) {
        merged.set(item.listingId, item);
      }
    }
    if (!nextCursor && cursor) {
      nextCursor = cursor;
    }
  }

  return {
    listings: Array.from(merged.values()),
    nextCursor,
  };
}
