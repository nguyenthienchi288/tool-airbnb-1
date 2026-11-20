import { APP_CONFIG, generateDatePairs } from '../config/index.js';
import { classifyHighRiseCondo } from '../parsers/amenityClassifier.js';
import {
  cleanHostLabel,
  extractHostNameFromHtml,
  extractHostNameFromPayloads,
  isValidHostName,
  parseHostListingsPayloads,
  parseHostProfileHtml,
} from '../parsers/hostParser.js';
import { parseSearchHtml, parseStaysSearchPayload } from '../parsers/niobeParser.js';
import { parsePdpHtml, parsePdpPayloads } from '../parsers/pdpParser.js';
import {
  applyGeoToListing,
  buildGeoClusterKey,
  detectScopeStatus,
  extractBuildingNameFromText,
  isForeignOrOtherCityTitle,
  isWithinCityGeofence,
  resolveClusterGeocode,
} from '../services/geocoder.js';
import { buildListingUrl, buildSearchUrl, randomDelay } from '../utils/helpers.js';

/**
 * Dismiss Airbnb cookie banners, translation popups, or promo modals if present.
 */
async function dismissPopups(page) {
  const selectors = [
    'button[aria-label="Đóng"]',
    'button[aria-label="Close"]',
    'button:has-text("Chấp nhận tất cả")',
    'button:has-text("Accept all")',
  ];

  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 150 }).catch(() => false)) {
        await btn.click({ timeout: 500 }).catch(() => {});
      }
    } catch {
      // Ignore popup dismissal failures
    }
  }
}

/**
 * Safely navigate and wait for network/hydration state.
 */
async function safeGoto(
  page,
  url,
  waitForSelector = 'script[id^="data-deferred-state-"]',
  options = {}
) {
  const timeout = options.timeout ?? APP_CONFIG.pageTimeoutMs;
  const selectorTimeout = options.selectorTimeout ?? 4500;

  await page.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout,
  });
  await page.waitForSelector(waitForSelector, {
    timeout: selectorTimeout,
  }).catch(() => {});
  await dismissPopups(page);
  if (!options.skipDelay) {
    await randomDelay(150, 350);
  }
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const err = new Error('Tác vụ đã bị dừng bởi người dùng.');
    err.name = 'AbortError';
    throw err;
  }
}

async function waitWithDelay(delayMs, signal) {
  throwIfAborted(signal);
  if (typeof delayMs === 'number' && delayMs >= 0) {
    const min = Math.max(200, Math.round(delayMs * 0.8));
    const max = Math.max(min, Math.round(delayMs * 1.2));
    await randomDelay(min, max);
  } else {
    await randomDelay();
  }
  throwIfAborted(signal);
}

/**
 * Split city bounding box into a grid (2x2 = 4 cells, or 3x3 = 9 cells when targetRaw >= 300)
 * so Airbnb's 15-18 page cap per query doesn't limit total city coverage.
 */
export function splitBoundingBoxIntoGrid(cityBounds, targetRaw = 100) {
  if (!cityBounds || typeof cityBounds.centerLat !== 'number' || typeof cityBounds.centerLng !== 'number') {
    return [null];
  }

  const gridSize = targetRaw >= 300 ? 3 : 2;
  let swLat, neLat, swLng, neLng;

  if (Array.isArray(cityBounds.boundingbox) && cityBounds.boundingbox.length === 4) {
    [swLat, neLat, swLng, neLng] = cityBounds.boundingbox;
  } else {
    swLat = cityBounds.centerLat - 0.18;
    neLat = cityBounds.centerLat + 0.18;
    swLng = cityBounds.centerLng - 0.18;
    neLng = cityBounds.centerLng + 0.18;
  }

  const latStep = (neLat - swLat) / gridSize;
  const lngStep = (neLng - swLng) / gridSize;
  const cells = [];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const cSwLat = swLat + r * latStep;
      const cNeLat = cSwLat + latStep;
      const cSwLng = swLng + c * lngStep;
      const cNeLng = cSwLng + lngStep;
      cells.push({
        label: `Grid ${r + 1},${c + 1}`,
        centerLat: (cSwLat + cNeLat) / 2,
        centerLng: (cSwLng + cNeLng) / 2,
        boundingbox: [cSwLat, cNeLat, cSwLng, cNeLng],
      });
    }
  }
  return cells;
}

/**
 * Step 1: Parallel Grid + Multi-date search scan on airbnb.com.vn
 */
export async function scanMultiDateSearch({
  context,
  db,
  city,
  country,
  iterations = 10,
  targetRaw = 100,
  cityBounds = null,
  maxRadiusKm = 40,
  hasProxy = false,
  delayMs,
  signal,
  onProgress,
}) {
  const datePairs = generateDatePairs(iterations);
  const gridCells = splitBoundingBoxIntoGrid(cityBounds, targetRaw);
  const rawSearchIds = new Set();
  let totalRawObservations = 0;

  // Build task matrix (datePair x gridCell)
  const tasks = [];
  for (const pair of datePairs) {
    for (const cell of gridCells) {
      tasks.push({ pair, cell });
    }
  }

  const searchConcurrency = hasProxy ? Math.min(5, tasks.length) : 1;
  let nextTaskIdx = 0;
  let completedTasks = 0;

  const workers = Array.from({ length: searchConcurrency }, async () => {
    const page = await context.newPage();
    const capturedGraphqlPayloads = [];
    let currentNights = 1;

    const onResp = async (response) => {
      const url = response.url();
      if (url.includes('/api/v3/StaysSearch') && response.status() === 200) {
        try {
          const json = await response.json();
          capturedGraphqlPayloads.push({ json, nights: currentNights });
        } catch {
          // Ignore non-JSON or aborted responses
        }
      }
    };
    page.on('response', onResp);

    try {
      while (true) {
        throwIfAborted(signal);
        if (rawSearchIds.size >= targetRaw && completedTasks >= datePairs.length) {
          break;
        }
        const idx = nextTaskIdx++;
        if (idx >= tasks.length) break;

        const { pair, cell } = tasks[idx];
        currentNights = pair.nights;
        capturedGraphqlPayloads.length = 0;

        const searchUrl = buildSearchUrl(city, pair.checkin, pair.checkout, country, cell || cityBounds);
        try {
          await safeGoto(page, searchUrl, 'script[id^="data-deferred-state-"]', {
            timeout: hasProxy ? 8000 : APP_CONFIG.pageTimeoutMs,
            selectorTimeout: 3000,
            skipDelay: true,
          });
        } catch {
          // 1 quick retry on slow proxy IP
          try {
            await safeGoto(page, searchUrl, 'script[id^="data-deferred-state-"]', {
              timeout: 8000,
              selectorTimeout: 3000,
              skipDelay: true,
            });
          } catch {
            completedTasks += 1;
            continue;
          }
        }

        const html = await page.content().catch(() => '');
        const { listings: htmlListings } = parseSearchHtml(html, pair.nights);

        const pairListings = new Map();
        for (const item of htmlListings) {
          pairListings.set(item.listingId, item);
        }

        // Paginate up to 3 pages per cell/date if needed
        let pageNum = 1;
        while (rawSearchIds.size < targetRaw && pageNum < 4) {
          const nextBtn = page
            .locator('a[aria-label*="Tiếp"], a[aria-label*="Next"], button[aria-label*="Tiếp"], button[aria-label*="Next"]')
            .first();
          const isVisible = await nextBtn.isVisible().catch(() => false);
          if (!isVisible) break;

          await nextBtn.click({ timeout: 3000 }).catch(() => {});
          await randomDelay(hasProxy ? 600 : 1800, hasProxy ? 1100 : 2800);
          pageNum += 1;

          for (const payload of capturedGraphqlPayloads.splice(0)) {
            const { listings: gqlListings } = parseStaysSearchPayload(payload.json, payload.nights);
            for (const item of gqlListings) {
              if (!pairListings.has(item.listingId)) {
                pairListings.set(item.listingId, item);
              }
            }
          }
        }

        for (const payload of capturedGraphqlPayloads.splice(0)) {
          const { listings: gqlListings } = parseStaysSearchPayload(payload.json, payload.nights);
          for (const item of gqlListings) {
            if (!pairListings.has(item.listingId)) {
              pairListings.set(item.listingId, item);
            }
          }
        }

        // Persist IN_TARGET listings & price_history immediately
        for (const item of pairListings.values()) {
          if (
            cityBounds &&
            typeof item.lat === 'number' &&
            typeof item.lng === 'number' &&
            !isWithinCityGeofence(item.lat, item.lng, cityBounds, maxRadiusKm)
          ) {
            continue;
          }
          if (isForeignOrOtherCityTitle(item.title, city, country)) {
            continue;
          }
          rawSearchIds.add(item.listingId);
          totalRawObservations += 1;

          db.upsertListing({
            ...item,
            city,
            country,
            source: 'search',
            scopeStatus: 'IN_TARGET',
            targetCity: city,
            actualCountry: country,
            actualCity: city,
          });

          if (item.pricePerNight) {
            db.upsertPriceRecord({
              listingId: item.listingId,
              city,
              dateKey: pair.key,
              checkin: pair.checkin,
              checkout: pair.checkout,
              nights: pair.nights,
              pricePerNight: item.pricePerNight,
            });
          }
        }

        completedTasks += 1;
        if (onProgress) {
          onProgress({
            iteration: completedTasks,
            totalIterations: tasks.length,
            dateKey: cell ? `${pair.key} [${cell.label}]` : pair.key,
            foundThisRun: pairListings.size,
            uniqueSoFar: rawSearchIds.size,
          });
        }

        if (hasProxy) {
          await randomDelay(150, 300);
        } else {
          await waitWithDelay(delayMs, signal);
        }
      }
    } finally {
      page.off('response', onResp);
      await page.close().catch(() => {});
    }
  });

  await Promise.all(workers);

  return {
    datePairs,
    gridCount: gridCells.length,
    uniqueSearchCount: rawSearchIds.size,
    totalRawObservations,
  };
}

const BLOCKED_THIRD_PARTY_DOMAINS = [
  'google-analytics.com',
  'googletagmanager.com',
  'maps.googleapis.com',
  'maps.gstatic.com',
  'doubleclick.net',
  'facebook.net',
  'facebook.com',
  'bugsnag.com',
  'sentry.io',
  'hotjar.com',
  'segment.io',
  'segment.com',
  'datadoghq.com',
  'newrelic.com',
  'tiktok.com',
  'bing.com',
  'branch.io',
  'appsflyer.com',
];

async function attachPdpRouteFilter(page) {
  await page.route('**/*', (route) => {
    const req = route.request();
    const type = req.resourceType();
    if (type === 'image' || type === 'media' || type === 'font' || type === 'stylesheet') {
      return route.abort();
    }
    const url = req.url().toLowerCase();
    if (BLOCKED_THIRD_PARTY_DOMAINS.some((domain) => url.includes(domain))) {
      return route.abort();
    }
    return route.continue();
  });
}

async function fetchListingPdpAttempt(page, listingUrl, gotoTimeoutMs = 6000) {
  const pdpPayloads = [];
  const onResponse = async (response) => {
    const url = response.url();
    if (
      (url.includes('StaysPdpSections') ||
        url.includes('StayPdpSections') ||
        url.includes('PdpPlatformSections')) &&
      response.status() === 200
    ) {
      try {
        pdpPayloads.push(await response.json());
      } catch {
        // Ignore
      }
    }
  };

  page.on('response', onResponse);
  try {
    await safeGoto(
      page,
      listingUrl,
      'script[id^="data-deferred-state"], [data-section-id="AMENITIES_DEFAULT"], [data-section-id="MEET_YOUR_HOST"]',
      { timeout: gotoTimeoutMs, selectorTimeout: 1500, skipDelay: true }
    );
    await randomDelay(100, 200);
    const html = await page.content();
    const htmlParsed = parsePdpHtml(html);
    const gqlParsed = pdpPayloads.length > 0 ? parsePdpPayloads(pdpPayloads) : {};

    let hostName = gqlParsed.hostName || htmlParsed.hostName || '';
    if (!isValidHostName(hostName)) {
      hostName = '';
      const hostDom = await page
        .locator('[data-section-id="MEET_YOUR_HOST"] h1, [data-section-id="MEET_YOUR_HOST"] h2, [data-section-id="MEET_YOUR_HOST"] h3')
        .allInnerTexts()
        .catch(() => []);
      const valid = hostDom
        .map((t) => cleanHostLabel(t))
        .find((t) => isValidHostName(t));
      if (valid) hostName = valid;
    }

    let amenities =
      gqlParsed.amenities?.length > 0
        ? gqlParsed.amenities
        : htmlParsed.amenities || [];
    if (amenities.length === 0) {
      const domAmens = await page
        .locator('[data-section-id="AMENITIES_DEFAULT"] div')
        .allInnerTexts()
        .catch(() => []);
      amenities = Array.from(
        new Set(
          domAmens
            .map((t) => t.trim())
            .filter(
              (t) =>
                t &&
                t.length > 2 &&
                t.length < 60 &&
                !/Nơi này có những gì|What this place offers|Hiển thị tất cả|Show all|Không có:/i.test(t)
            )
        )
      );
    }

    return {
      title: gqlParsed.title || htmlParsed.title || '',
      hostId: gqlParsed.hostId || htmlParsed.hostId || '',
      hostName,
      hostUrl: gqlParsed.hostUrl || htmlParsed.hostUrl || '',
      lat: gqlParsed.lat ?? htmlParsed.lat ?? null,
      lng: gqlParsed.lng ?? htmlParsed.lng ?? null,
      propertyType: gqlParsed.propertyType || htmlParsed.propertyType || '',
      description: gqlParsed.description || htmlParsed.description || '',
      amenities,
      unavailableAmenities:
        gqlParsed.unavailableAmenities?.length > 0
          ? gqlParsed.unavailableAmenities
          : htmlParsed.unavailableAmenities || [],
      ratingAverage: gqlParsed.ratingAverage || htmlParsed.ratingAverage || 0,
      ratingCount: gqlParsed.ratingCount || htmlParsed.ratingCount || 0,
      isGuestFavorite: Boolean(gqlParsed.isGuestFavorite || htmlParsed.isGuestFavorite),
    };
  } finally {
    page.off('response', onResponse);
  }
}

/**
 * Fetch PDP details (/rooms/[ID]) with 6000ms timeout and 1 automatic retry (8000ms) if empty/timed out.
 */
async function fetchListingPdp(page, listingUrl) {
  try {
    const first = await fetchListingPdpAttempt(page, listingUrl, 8000);
    if (first.amenities.length === 0 && (first.lat === null || first.lng === null)) {
      return await fetchListingPdpAttempt(page, listingUrl, 8000);
    }
    return first;
  } catch {
    return await fetchListingPdpAttempt(page, listingUrl, 8000);
  }
}

/**
 * Parallel Worker Pool for PDP scraping (4-5 tabs) with SQLite cache reuse.
 */
async function runPdpWorkerPool({
  context,
  db,
  listings,
  city,
  country,
  cityBounds = null,
  maxRadiusKm = 40,
  hasProxy = false,
  concurrency = 8,
  signal,
  onPdpProgress,
}) {
  if (!listings.length) return;

  const total = listings.length;
  let completed = 0;
  const toFetch = [];

  // Check SQLite cache before opening any browser tabs
  for (const listing of listings) {
    throwIfAborted(signal);
    const cached = db.getCachedPdpByListingId(listing.listingId);
    if (cached && cached.allAmenities?.length > 0 && cached.hostId && cached.lat != null && cached.lng != null) {
      const finalLat = listing.lat ?? cached.lat;
      const finalLng = listing.lng ?? cached.lng;
      const finalTitle = listing.title || cached.title;
      const scopeStatus = detectScopeStatus({
        lat: finalLat,
        lng: finalLng,
        title: finalTitle,
        city,
        country,
        cityBounds,
        maxRadiusKm,
      });

      db.upsertListing({
        ...listing,
        title: finalTitle,
        propertyType: listing.propertyType || cached.propertyType,
        hostId: listing.hostId || cached.hostId,
        hostName: listing.hostName || cached.hostName,
        hostUrl: listing.hostUrl || cached.hostUrl,
        lat: finalLat,
        lng: finalLng,
        description: listing.description || cached.description,
        allAmenities: cached.allAmenities,
        ratingAverage: listing.ratingAverage || cached.ratingAverage,
        ratingCount: Math.max(listing.ratingCount || 0, cached.ratingCount || 0),
        isGuestFavorite: listing.isGuestFavorite || cached.isGuestFavorite,
        pdpFetched: true,
        scopeStatus,
        targetCity: city,
      });
      completed += 1;
      if (onPdpProgress) {
        onPdpProgress(completed, total, `${listing.listingId} (cache)`);
      }
    } else {
      toFetch.push(listing);
    }
  }

  if (toFetch.length === 0) return;

  let nextIdx = 0;
  const workerCount = Math.min(concurrency, toFetch.length);

  const workers = Array.from({ length: workerCount }, async () => {
    const workerPage = await context.newPage();
    await attachPdpRouteFilter(workerPage);
    try {
      while (true) {
        throwIfAborted(signal);
        const idx = nextIdx++;
        if (idx >= toFetch.length) break;

        const listing = toFetch[idx];
        await randomDelay(hasProxy ? 100 : 250, hasProxy ? 250 : 500);
        throwIfAborted(signal);

        try {
          const pdp = await fetchListingPdp(workerPage, listing.listingUrl);
          const finalLat = pdp.lat ?? listing.lat;
          const finalLng = pdp.lng ?? listing.lng;
          const finalTitle = listing.title || pdp.title;

          const hasCoords = typeof finalLat === 'number' && typeof finalLng === 'number';
          const scopeStatus = hasCoords
            ? detectScopeStatus({
                lat: finalLat,
                lng: finalLng,
                title: finalTitle,
                city,
                country,
                cityBounds,
                maxRadiusKm,
              })
            : 'OUT_OF_TARGET';

          // Save immediately to SQLite with scopeStatus (IN_TARGET vs OUT_OF_TARGET)
          db.upsertListing({
            ...listing,
            ...pdp,
            title: finalTitle,
            hostId: listing.hostId || pdp.hostId,
            hostName:
              (pdp.hostName && pdp.hostName.length > 1 ? pdp.hostName : '') ||
              listing.hostName,
            hostUrl: listing.hostUrl || pdp.hostUrl,
            ratingAverage: listing.ratingAverage || pdp.ratingAverage,
            ratingCount: Math.max(listing.ratingCount || 0, pdp.ratingCount || 0),
            isGuestFavorite: listing.isGuestFavorite || pdp.isGuestFavorite,
            allAmenities: pdp.amenities,
            city,
            country,
            pdpFetched: true,
            scopeStatus,
            targetCity: city,
          });
        } catch {
          // Continue gracefully on individual PDP error
        }

        completed += 1;
        if (onPdpProgress) {
          onPdpProgress(completed, total, listing.listingId);
        }
      }
    } finally {
      await workerPage.close().catch(() => {});
    }
  });

  await Promise.all(workers);
}

/**
 * Step 2: Visit PDP (8-10 parallel tabs) to get Host IDs, then expand each Host's portfolio via /users/show/[Host_ID].
 */
export async function expandHostPortfolios({
  context,
  db,
  city,
  country,
  cityBounds = null,
  maxRadiusKm = 40,
  hasProxy = false,
  skipHostExpansion = false,
  concurrency,
  signal,
  onPdpProgress,
  onHostProgress,
}) {
  const effectiveConcurrency = concurrency || (hasProxy ? 15 : 8);

  // 2A. Fetch PDP in parallel for initial search listings that haven't been fetched yet
  let currentListings = db.getListingsByCity(city);
  const pendingInitialPdp = currentListings.filter((l) => !l.pdpFetched);

  await runPdpWorkerPool({
    context,
    db,
    listings: pendingInitialPdp,
    city,
    country,
    cityBounds,
    maxRadiusKm,
    hasProxy,
    concurrency: effectiveConcurrency,
    signal,
    onPdpProgress,
  });

  // 2B. Host Portfolio Expansion with 8s timeout & Circuit Breaker (5 consecutive 0-listing hosts)
  if (!skipHostExpansion) {
    currentListings = db.getListingsByCity(city);
    const hostsToExpand = new Map();
    for (const l of currentListings) {
      if (l.hostId && !db.isHostExpanded(l.hostId, city)) {
        hostsToExpand.set(l.hostId, {
          hostId: l.hostId,
          hostName: l.hostName,
          hostUrl: l.hostUrl,
        });
      }
    }

    const hostList = Array.from(hostsToExpand.values());
    if (hostList.length > 0) {
      const page = await context.newPage();
      let consecutiveZeroHosts = 0;
      const CIRCUIT_BREAKER_LIMIT = 5;

      try {
        for (let i = 0; i < hostList.length; i++) {
          throwIfAborted(signal);
          const host = hostList[i];
          const hostGqlPayloads = [];
          const onHostResp = async (response) => {
            const url = response.url();
            if (
              (/StaysUserProfile|UserProfile|HostListings|niobe/i.test(url) ||
                url.includes('/api/v3/')) &&
              response.status() === 200
            ) {
              try {
                const ctype = response.headers()['content-type'] || '';
                if (ctype.includes('json') || /StaysUserProfile|UserProfile|HostListings/i.test(url)) {
                  hostGqlPayloads.push(await response.json());
                }
              } catch {
                // Ignore non-JSON
              }
            }
          };

          page.on('response', onHostResp);
          let expandedListings = [];
          let resolvedHostName =
            host.hostName && host.hostName.trim().length > 1 ? host.hostName.trim() : '';

          try {
            await page.goto(host.hostUrl, {
              waitUntil: 'domcontentloaded',
              timeout: 12000,
            });
            await dismissPopups(page);

            // Wait for React Passport Profile to render listing cards (2.5s - 3.5s or selector)
            await page
              .waitForSelector('a[href*="/rooms/"]', { timeout: 5000 })
              .catch(() => {});
            await randomDelay(2500, 3500);

            // Click "Hiển thị tất cả" / "Show all" listings button if present
            const showAllBtn = page
              .locator(
                'button:has-text("Hiển thị tất cả"), button:has-text("Show all"), a:has-text("Xem tất cả")'
              )
              .first();
            if (await showAllBtn.isVisible().catch(() => false)) {
              await showAllBtn.click({ timeout: 2000 }).catch(() => {});
              await randomDelay(1800, 2200);
            }

            const html = await page.content();
            const parsedHostName =
              extractHostNameFromPayloads(hostGqlPayloads) ||
              extractHostNameFromHtml(html);
            if (parsedHostName && parsedHostName.length > 1) {
              resolvedHostName = parsedHostName;
            } else if (!resolvedHostName) {
              const domHeadings = await page
                .locator('main h1, main h2, h1, h2')
                .allInnerTexts()
                .catch(() => []);
              const validHeading = domHeadings
                .map((t) =>
                  t
                    .replace(/^(?:Chủ nhà|Host|Hosted by|Gặp gỡ|Meet your host(?:,)?|Thông tin về|About|Bài đăng của|Listings by|Hỏi)\s*:?\s*/i, '')
                    .replace(/\s+về$/i, '')
                    .trim()
                )
                .find(
                  (t) =>
                    t.length > 1 &&
                    !/^(gặp gỡ|meet your host|chủ nhà|host|superhost|chủ nhà siêu cấp|profile|hồ sơ|thông tin về|about|airbnb|đánh giá|reviews)$/i.test(
                      t
                    ) &&
                    !/khách nói gì|what guests|nói gì về|đánh giá từ|reviews about|mục cho thuê|listings/i.test(
                      t
                    )
                );
              if (validHeading) {
                resolvedHostName = validHeading;
              }
            }

            // (a) GraphQL payloads + (b) HTML data-deferred-state + (c) Live DOM <a href*="/rooms/">
            const fromHtml = parseHostProfileHtml(html, city);
            const fromGql =
              hostGqlPayloads.length > 0
                ? parseHostListingsPayloads(hostGqlPayloads, city)
                : [];
            const domRoomLinks = await page
              .locator('a[href*="/rooms/"]')
              .evaluateAll((els) =>
                els.map((el) => ({
                  href: el.getAttribute('href') || '',
                  text: (el.innerText || '').trim(),
                }))
              )
              .catch(() => []);

            const mergedHostMap = new Map();
            for (const item of [...fromGql, ...fromHtml]) {
              if (!mergedHostMap.has(item.listingId)) {
                mergedHostMap.set(item.listingId, item);
              }
            }
            for (const link of domRoomLinks) {
              const m = link.href.match(/\/rooms\/(\d{5,})/);
              if (m && !mergedHostMap.has(m[1])) {
                const id = m[1];
                mergedHostMap.set(id, {
                  listingId: id,
                  listingUrl: buildListingUrl(id),
                  title: link.text ? link.text.split('\n')[0].trim() : `Airbnb #${id}`,
                  propertyType: '',
                  ratingAverage: 0,
                  ratingCount: 0,
                  source: 'host_expansion',
                });
              }
            }

            expandedListings = Array.from(mergedHostMap.values());

            for (const exp of expandedListings) {
              const scopeStatus = detectScopeStatus({
                lat: exp.lat,
                lng: exp.lng,
                title: exp.title,
                city,
                country,
                cityBounds,
                maxRadiusKm,
              });
              db.upsertListing({
                ...exp,
                city,
                country,
                hostId: host.hostId,
                hostName: resolvedHostName,
                hostUrl: host.hostUrl,
                source: 'host_expansion',
                scopeStatus,
                targetCity: city,
                // Smart Host Expansion: skip expensive PDP tabs for OUT_OF_TARGET listings
                pdpFetched: scopeStatus === 'OUT_OF_TARGET',
              });
            }

            db.markHostExpanded({
              hostId: host.hostId,
              city,
              hostName: resolvedHostName,
              hostUrl: host.hostUrl,
              listingsCount: expandedListings.length,
            });
          } catch {
            // Continue to next host on 8s timeout or error
          } finally {
            page.off('response', onHostResp);
          }

          if (onHostProgress) {
            onHostProgress(
              i + 1,
              hostList.length,
              resolvedHostName || host.hostId,
              expandedListings.length
            );
          }

          if (expandedListings.length === 0) {
            consecutiveZeroHosts += 1;
            if (consecutiveZeroHosts >= CIRCUIT_BREAKER_LIMIT) {
              console.log(
                `  [Circuit Breaker] ${CIRCUIT_BREAKER_LIMIT} Host liên tiếp trả về 0 căn. Dừng mở rộng Host để chuyển sang Bước 3.`
              );
              break;
            }
          } else {
            consecutiveZeroHosts = 0;
          }

          await randomDelay(400, 900);
          throwIfAborted(signal);
        }
      } finally {
        await page.close().catch(() => {});
      }
    }

    // 2C. Smart Host Expansion: only fetch PDP in parallel for IN_TARGET newly discovered listings
    const afterHostListings = db.getListingsByCity(city);
    const pendingExpandedPdp = afterHostListings.filter(
      (l) => !l.pdpFetched && (l.scopeStatus || 'IN_TARGET') === 'IN_TARGET'
    );

    await runPdpWorkerPool({
      context,
      db,
      listings: pendingExpandedPdp,
      city,
      country,
      cityBounds,
      maxRadiusKm,
      hasProxy,
      concurrency: effectiveConcurrency,
      signal,
      onPdpProgress,
    });
  }
}

/**
 * Step 3/4: Classify all listings in DB (YES/NO high-rise) first,
 * skip Geocoding for NO listings, and Reverse Geocode YES listings once per ~100m spatial cluster.
 */
export async function classifyAndGeocodeListings({
  db,
  city,
  country = '',
  cityBounds = null,
  maxRadiusKm = 40,
  rules = null,
  signal,
  onProgress,
  onClusterProgress,
}) {
  const listings = db.getListingsByCity(city);
  const clusters = new Map();
  let processed = 0;

  // 1. Enforce Geofence + Title Check + Classify all listings first; only queue YES listings needing geo into spatial clusters
  for (const listing of listings) {
    throwIfAborted(signal);

    const scopeStatus = detectScopeStatus({
      lat: listing.lat,
      lng: listing.lng,
      title: listing.title,
      city,
      country,
      cityBounds,
      maxRadiusKm,
    });

    const hasValidCoords = typeof listing.lat === 'number' && typeof listing.lng === 'number';
    if (!hasValidCoords || scopeStatus === 'OUT_OF_TARGET') {
      // Keep OUT_OF_TARGET in DB for Host External Portfolio; resolve actualCountry/actualCity if missing
      if (hasValidCoords && (!listing.actualCountry || !listing.actualCity)) {
        const geoKey = buildGeoClusterKey(listing.lat, listing.lng);
        if (!clusters.has(geoKey)) {
          clusters.set(geoKey, {
            geoKey,
            lat: listing.lat,
            lng: listing.lng,
            items: [],
          });
        }
        clusters.get(geoKey).items.push({
          listing: { ...listing, scopeStatus: 'OUT_OF_TARGET' },
          classification: {
            isHighRise: listing.isHighRise || 'NO',
            reason: listing.highRiseReason || 'Ngoài khu vực mục tiêu (OUT_OF_TARGET)',
            matchedAmenities: listing.matchedAmenities || [],
          },
          isOutTargetCluster: true,
        });
      } else {
        db.upsertListing({
          ...listing,
          scopeStatus: 'OUT_OF_TARGET',
          targetCity: city,
        });
        processed += 1;
        if (onProgress) onProgress(processed, listings.length);
      }
      continue;
    }

    const classification = classifyHighRiseCondo({
      amenities: listing.allAmenities,
      propertyType: listing.propertyType,
      description: listing.description,
      title: listing.title,
      rules,
    });

    if (classification.isHighRise !== 'YES') {
      // Skip Reverse Geocoding API for NO listings
      const textBuilding =
        listing.buildingName ||
        extractBuildingNameFromText(listing.title, listing.description) ||
        '';
      db.upsertListing({
        ...listing,
        isHighRise: classification.isHighRise,
        highRiseReason: classification.reason,
        matchedAmenities: classification.matchedAmenities,
        buildingName: textBuilding,
        streetAddress: listing.streetAddress || listing.city || '',
      });
      processed += 1;
      if (onProgress) onProgress(processed, listings.length);
      continue;
    }

    if (listing.buildingName && listing.streetAddress && (!country || !/indonesia|bekasi|jakarta|thailand|bangkok|malaysia/i.test(listing.streetAddress) || /vietnam|viet nam|ho chi minh/i.test(country) === false)) {
      // If country is Vietnam and streetAddress has foreign city/country, re-validate via cluster geocode
      const looksForeign =
        country &&
        listing.streetAddress &&
        /\b(indonesia|bekasi|jakarta|thailand|bangkok|malaysia|kuala lumpur|japan|tokyo|greece|filothei|athens)\b/i.test(
          listing.streetAddress
        ) &&
        !new RegExp(country, 'i').test(listing.streetAddress);

      if (!looksForeign) {
        db.upsertListing({
          ...listing,
          isHighRise: classification.isHighRise,
          highRiseReason: classification.reason,
          matchedAmenities: classification.matchedAmenities,
        });
        processed += 1;
        if (onProgress) onProgress(processed, listings.length);
        continue;
      }
    }

    if (typeof listing.lat !== 'number' || typeof listing.lng !== 'number') {
      const fallback = applyGeoToListing(listing, { buildingName: '', streetAddress: '' });
      db.upsertListing({
        ...listing,
        isHighRise: classification.isHighRise,
        highRiseReason: classification.reason,
        matchedAmenities: classification.matchedAmenities,
        buildingName: listing.buildingName || fallback.buildingName,
        streetAddress: listing.streetAddress || fallback.streetAddress,
      });
      processed += 1;
      if (onProgress) onProgress(processed, listings.length);
      continue;
    }

    const geoKey = buildGeoClusterKey(listing.lat, listing.lng);
    if (!clusters.has(geoKey)) {
      clusters.set(geoKey, {
        geoKey,
        lat: listing.lat,
        lng: listing.lng,
        items: [],
      });
    }
    clusters.get(geoKey).items.push({ listing, classification });
  }

  // 2. Geocode each unique ~100m spatial cluster ONCE & post-check Country
  const clusterList = Array.from(clusters.values());
  const totalClusters = clusterList.length;

  for (let i = 0; i < totalClusters; i++) {
    throwIfAborted(signal);
    const cluster = clusterList[i];

    if (onClusterProgress) {
      onClusterProgress(i + 1, totalClusters, cluster.geoKey, cluster.items.length);
    }

    const geo = await resolveClusterGeocode(cluster.lat, cluster.lng, db, country);

    for (const entry of cluster.items) {
      const { listing, classification, isOutTargetCluster } = entry;
      const finalScope =
        isOutTargetCluster || geo.isOutOfBounds || geo.outOfBounds
          ? 'OUT_OF_TARGET'
          : 'IN_TARGET';
      const resolved = applyGeoToListing(listing, geo);
      db.upsertListing({
        ...listing,
        isHighRise: classification.isHighRise,
        highRiseReason: classification.reason,
        matchedAmenities: classification.matchedAmenities,
        buildingName: resolved.buildingName,
        streetAddress: resolved.streetAddress,
        scopeStatus: finalScope,
        targetCity: city,
        actualCountry: geo.actualCountry || (finalScope === 'IN_TARGET' ? country : ''),
        actualCity: geo.actualCity || (finalScope === 'IN_TARGET' ? city : ''),
      });
      processed += 1;
      if (onProgress) onProgress(processed, listings.length);
    }
  }
}
