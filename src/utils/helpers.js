import { AIRBNB_BASE_URL, APP_CONFIG } from '../config/index.js';

/**
 * Sleep for a random duration between min and max ms (natural human-like pacing).
 */
export async function randomDelay(
  minMs = APP_CONFIG.minDelayMs,
  maxMs = APP_CONFIG.maxDelayMs
) {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Decode Airbnb Base64 ID (e.g. "U3RheUxpc3Rpbmc6MTIzNDU2Nzg=" -> "12345678").
 * If already numeric, returns as-is.
 */
export function decodeAirbnbId(rawId) {
  if (!rawId) return null;
  const str = String(rawId).trim();
  if (/^\d+$/.test(str)) return str;

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
    if (match) return match[1];
  } catch {
    // Ignore decode failure
  }

  const fallbackMatch = str.match(/(\d{5,})/);
  return fallbackMatch ? fallbackMatch[1] : null;
}

/**
 * Build canonical Airbnb.com.vn URLs.
 */
export function buildListingUrl(listingId) {
  return `${AIRBNB_BASE_URL}/rooms/${listingId}`;
}

export function buildHostProfileUrl(hostId) {
  return `${AIRBNB_BASE_URL}/users/show/${hostId}`;
}

export function buildSearchUrl(city, checkin, checkout, country = '', cityBounds = null) {
  const locationQuery = country ? `${city}, ${country}` : city;
  let url =
    `${AIRBNB_BASE_URL}/s/${encodeURIComponent(locationQuery)}/homes` +
    `?refinement_paths%5B%5D=%2Fhomes` +
    `&query=${encodeURIComponent(locationQuery)}` +
    `&checkin=${checkin}` +
    `&checkout=${checkout}` +
    `&room_types%5B%5D=Entire%20home%2Fapt` +
    `&currency=USD`;

  if (cityBounds && Array.isArray(cityBounds.boundingbox) && cityBounds.boundingbox.length === 4) {
    const [swLat, neLat, swLng, neLng] = cityBounds.boundingbox;
    url += `&ne_lat=${neLat}&ne_lng=${neLng}&sw_lat=${swLat}&sw_lng=${swLng}&search_by_map=true`;
  } else if (cityBounds && typeof cityBounds.centerLat === 'number' && typeof cityBounds.centerLng === 'number') {
    const dLat = 0.22;
    const dLng = 0.22;
    url += `&ne_lat=${(cityBounds.centerLat + dLat).toFixed(5)}&ne_lng=${(cityBounds.centerLng + dLng).toFixed(5)}&sw_lat=${(cityBounds.centerLat - dLat).toFixed(5)}&sw_lng=${(cityBounds.centerLng - dLng).toFixed(5)}&search_by_map=true`;
  }
  return url;
}

/**
 * Parse price string (e.g. "$125", "$1,240 USD", "125 $") to a floating number.
 */
export function parseUsdAmount(priceText) {
  if (typeof priceText === 'number' && Number.isFinite(priceText)) {
    return priceText;
  }
  if (!priceText || typeof priceText !== 'string') return null;

  // Remove currency symbols, whitespace, and non-numeric except dot and comma
  const cleaned = priceText.replace(/[^\d.,]/g, '').trim();
  if (!cleaned) return null;

  // Handle thousand separators vs decimal separators
  // In USD format on Airbnb (e.g. "$1,234" or "$123.45"):
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized = cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) {
    // If 3 digits after comma, it's a thousand separator ($1,200)
    const parts = cleaned.split(',');
    if (parts[parts.length - 1].length === 3) {
      normalized = cleaned.replace(/,/g, '');
    } else {
      normalized = cleaned.replace(',', '.');
    }
  }

  const num = parseFloat(normalized);
  return Number.isFinite(num) && num > 0 ? num : null;
}

/**
 * Normalize total/nightly price to USD per night based on qualifier and nights count.
 */
export function normalizePricePerNight(priceText, qualifierText, fallbackNights = 1) {
  const amount = parseUsdAmount(priceText);
  if (amount === null) return null;

  const q = (qualifierText || '').toLowerCase();

  // Check explicit multi-night qualifier first (e.g. "cho 2 đêm", "for 3 nights")
  const nightMatch = q.match(/(\d+)\s*(đêm|nights?)/i);
  if (nightMatch) {
    const n = parseInt(nightMatch[1], 10);
    if (n > 1) return Number((amount / n).toFixed(2));
    if (n === 1) return Number(amount.toFixed(2));
  }

  // Check explicit total qualifier ("tổng", "total")
  if (q.includes('tổng') || q.includes('total')) {
    return Number((amount / Math.max(1, fallbackNights)).toFixed(2));
  }

  // Single-night qualifier ("/ đêm", "đêm", "night")
  if (q.includes('đêm') || q.includes('night')) {
    return Number(amount.toFixed(2));
  }

  // Default: if fallbackNights > 1 and amount looks like a multi-night total?
  // Usually Airbnb primaryLine.price with qualifier "cho 2 đêm" / "total" has the qualifier,
  // and without qualifier or with "/ đêm" it's per night.
  return Number(amount.toFixed(2));
}

/**
 * Safe recursive object traversal helper to find objects matching a predicate.
 */
export function findObjectsWhere(root, predicate, results = [], visited = new WeakSet()) {
  if (!root || typeof root !== 'object') return results;
  if (visited.has(root)) return results;
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

export function formatDateStamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function sanitizeFilename(name) {
  return String(name || 'Unknown')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
