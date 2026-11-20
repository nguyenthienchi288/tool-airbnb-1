/**
 * Merge search listings & host-expanded listings, deduplicate strictly by listingId,
 * and compute price statistics from historical date-pair observations.
 */
export function computeListingPriceStats(priceRecords = []) {
  const validPrices = priceRecords
    .map((r) => Number(r.price_per_night ?? r.pricePerNight))
    .filter((p) => Number.isFinite(p) && p > 0);

  if (validPrices.length === 0) {
    return {
      minPrice: null,
      maxPrice: null,
      avgPrice: null,
      priceSpreadPct: 0,
    };
  }

  const minPrice = Math.min(...validPrices);
  const maxPrice = Math.max(...validPrices);
  const sum = validPrices.reduce((acc, v) => acc + v, 0);
  const avgPrice = Number((sum / validPrices.length).toFixed(2));
  const priceSpreadPct =
    maxPrice > 0 ? Number((((maxPrice - minPrice) / maxPrice) * 100).toFixed(2)) : 0;

  return {
    minPrice: Number(minPrice.toFixed(2)),
    maxPrice: Number(maxPrice.toFixed(2)),
    avgPrice,
    priceSpreadPct,
  };
}

export function deduplicateAndAggregatePrices(listings, priceHistoryRows) {
  const byListing = new Map();
  for (const item of listings) {
    if (!item?.listingId) continue;
    if (!byListing.has(item.listingId)) {
      byListing.set(item.listingId, { ...item });
    } else {
      const existing = byListing.get(item.listingId);
      byListing.set(item.listingId, {
        ...existing,
        ...item,
        title: item.title || existing.title,
        hostId: item.hostId || existing.hostId,
        hostName: item.hostName || existing.hostName,
        hostUrl: item.hostUrl || existing.hostUrl,
        ratingCount: Math.max(item.ratingCount || 0, existing.ratingCount || 0),
        ratingAverage: item.ratingAverage || existing.ratingAverage || 0,
        isGuestFavorite: Boolean(item.isGuestFavorite || existing.isGuestFavorite),
      });
    }
  }

  const pricesByListingId = new Map();
  for (const row of priceHistoryRows) {
    const id = row.listing_id || row.listingId;
    if (!pricesByListingId.has(id)) {
      pricesByListingId.set(id, []);
    }
    pricesByListingId.get(id).push(row);
  }

  const cleanListings = [];
  for (const [listingId, listing] of byListing.entries()) {
    const records = pricesByListingId.get(listingId) || [];
    const stats = computeListingPriceStats(records);
    cleanListings.push({
      ...listing,
      minPrice: stats.minPrice ?? listing.minPrice ?? null,
      maxPrice: stats.maxPrice ?? listing.maxPrice ?? null,
      avgPrice: stats.avgPrice ?? listing.avgPrice ?? null,
      priceSpreadPct:
        records.length > 0 ? stats.priceSpreadPct : listing.priceSpreadPct || 0,
    });
  }

  return cleanListings;
}
