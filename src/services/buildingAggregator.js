import { normalizeText } from '../config/index.js';

/**
 * Group high-rise ("YES") listings by normalized Building Name,
 * rank by independent Host count & total listings, and compute city-level summary.
 */
export function aggregateBuildingsAndCitySummary({
  city,
  country,
  rawSearchCount,
  cleanListings,
  minHostsPerBuilding = 5,
}) {
  const minHosts = Math.max(1, Number(minHostsPerBuilding) || 5);
  const validCleanListings = cleanListings.filter(
    (l) => (l.scopeStatus || 'IN_TARGET') === 'IN_TARGET' && l.isHighRise !== 'OUT_OF_BOUNDS'
  );
  const highRiseListings = validCleanListings.filter((l) => l.isHighRise === 'YES');
  const nonHighRiseCount = validCleanListings.length - highRiseListings.length;

  const buildingGroups = new Map();

  for (const item of highRiseListings) {
    const rawBuilding = (item.buildingName || '').trim() || 'Chưa xác định tòa nhà';
    const key = normalizeText(rawBuilding) || `${Number(item.lat || 0).toFixed(3)},${Number(item.lng || 0).toFixed(3)}`;

    if (!buildingGroups.has(key)) {
      buildingGroups.set(key, {
        buildingName: rawBuilding,
        streetAddress: item.streetAddress || '',
        lat: item.lat,
        lng: item.lng,
        listings: [],
        hostsMap: new Map(),
      });
    }

    const group = buildingGroups.get(key);
    group.listings.push(item);

    if (!group.streetAddress && item.streetAddress) {
      group.streetAddress = item.streetAddress;
    }

    const hostKey = item.hostId || normalizeText(item.hostName) || `unknown_${item.listingId}`;
    const rawHostName = (item.hostName || '').trim();
    const isFullHostName = rawHostName.length >= 2;
    const hostDisplay = isFullHostName
      ? rawHostName
      : (item.hostId ? `Host #${item.hostId}` : 'Ẩn danh');

    if (!group.hostsMap.has(hostKey)) {
      group.hostsMap.set(hostKey, hostDisplay);
    } else if (isFullHostName && /^Host #\d+$/.test(group.hostsMap.get(hostKey))) {
      group.hostsMap.set(hostKey, hostDisplay);
    }
  }

  const buildings = [];
  for (const group of buildingGroups.values()) {
    const uniqueHostsCount = group.hostsMap.size;
    const listingsCount = group.listings.length;

    const validAvgPrices = group.listings
      .map((l) => l.avgPrice)
      .filter((p) => typeof p === 'number' && p > 0);
    const validMinPrices = group.listings
      .map((l) => l.minPrice)
      .filter((p) => typeof p === 'number' && p > 0);
    const validMaxPrices = group.listings
      .map((l) => l.maxPrice)
      .filter((p) => typeof p === 'number' && p > 0);
    const validSpreads = group.listings
      .map((l) => l.priceSpreadPct)
      .filter((s) => typeof s === 'number' && s >= 0);

    const minPrice = validMinPrices.length ? Math.min(...validMinPrices) : 0;
    const maxPrice = validMaxPrices.length ? Math.max(...validMaxPrices) : 0;
    const avgPrice = validAvgPrices.length
      ? Number((validAvgPrices.reduce((a, b) => a + b, 0) / validAvgPrices.length).toFixed(2))
      : 0;
    const avgSpreadPct = validSpreads.length
      ? Number((validSpreads.reduce((a, b) => a + b, 0) / validSpreads.length).toFixed(2))
      : 0;

    const bestSellerCount = group.listings.filter(
      (l) => l.isGuestFavorite || (l.ratingCount || 0) > 30
    ).length;

    // Best-selling listing in this building (Guest Favorite + highest ratingCount)
    const sortedByBest = [...group.listings].sort((a, b) => {
      const gfDiff = (b.isGuestFavorite ? 1 : 0) - (a.isGuestFavorite ? 1 : 0);
      if (gfDiff !== 0) return gfDiff;
      return (b.ratingCount || 0) - (a.ratingCount || 0);
    });

    buildings.push({
      buildingName: group.buildingName,
      streetAddress: group.streetAddress,
      coordinates:
        typeof group.lat === 'number' && typeof group.lng === 'number'
          ? `${group.lat.toFixed(5)}, ${group.lng.toFixed(5)}`
          : '',
      uniqueHostsCount,
      listingsCount,
      status: uniqueHostsCount >= minHosts ? `ĐẠT (>=${minHosts} Host)` : `THEO DÕI (<${minHosts} Host)`,
      minPrice,
      maxPrice,
      avgPrice,
      avgSpreadPct,
      bestSellerCount,
      hostNames: Array.from(group.hostsMap.values()).join(', '),
      bestListingUrl: sortedByBest[0]?.listingUrl || '',
    });
  }

  // Sort descending by uniqueHostsCount, then listingsCount, then bestSellerCount
  buildings.sort((a, b) => {
    if (b.uniqueHostsCount !== a.uniqueHostsCount) {
      return b.uniqueHostsCount - a.uniqueHostsCount;
    }
    if (b.listingsCount !== a.listingsCount) {
      return b.listingsCount - a.listingsCount;
    }
    return b.bestSellerCount - a.bestSellerCount;
  });

  buildings.forEach((b, idx) => {
    b.rank = idx + 1;
  });

  const qualifiedBuildings = buildings.filter((b) => b.uniqueHostsCount >= minHosts).length;

  const allValidPrices = validCleanListings
    .map((l) => l.avgPrice)
    .filter((p) => typeof p === 'number' && p > 0);
  const allValidSpreads = validCleanListings
    .map((l) => l.priceSpreadPct)
    .filter((s) => typeof s === 'number' && s >= 0);

  const avgPriceUsd = allValidPrices.length
    ? Number((allValidPrices.reduce((a, b) => a + b, 0) / allValidPrices.length).toFixed(2))
    : 0;
  const avgSpreadPct = allValidSpreads.length
    ? Number((allValidSpreads.reduce((a, b) => a + b, 0) / allValidSpreads.length).toFixed(2))
    : 0;
  const highRisePct = validCleanListings.length
    ? Number(((highRiseListings.length / validCleanListings.length) * 100).toFixed(2))
    : 0;

  const verdict =
    qualifiedBuildings >= 10 && avgSpreadPct >= 10
      ? 'ĐẠT CHUẨN - ƯU TIÊN CHỌN'
      : 'CHƯA ĐẠT CHUẨN';

  const citySummary = {
    city,
    country,
    rawCount: rawSearchCount,
    cleanCount: validCleanListings.length,
    highRiseYesCount: highRiseListings.length,
    highRiseNoCount: nonHighRiseCount,
    highRisePct,
    totalBuildings: buildings.length,
    qualifiedBuildings,
    avgPriceUsd,
    avgSpreadPct,
    verdict,
  };

  return { buildings, citySummary };
}
