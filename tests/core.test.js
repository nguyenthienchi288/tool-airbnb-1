import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { generateDatePairs, isCountryExcluded } from '../src/config/index.js';
import { exportCityReports } from '../src/exporters/excelExporter.js';
import { classifyHighRiseCondo } from '../src/parsers/amenityClassifier.js';
import { parseSearchHtml } from '../src/parsers/niobeParser.js';
import { parsePdpPayloads } from '../src/parsers/pdpParser.js';
import { aggregateBuildingsAndCitySummary } from '../src/services/buildingAggregator.js';
import { deduplicateAndAggregatePrices } from '../src/services/deduplicator.js';
import { decodeAirbnbId, normalizePricePerNight } from '../src/utils/helpers.js';

test('Market Guardrail blocks Vietnam, Indonesia, Malaysia and allows Thailand/Japan', () => {
  assert.equal(isCountryExcluded('Vietnam'), false);
  assert.equal(isCountryExcluded('Việt Nam'), false);
  assert.equal(isCountryExcluded('indonesia'), true);
  assert.equal(isCountryExcluded('MALAYSIA'), true);
  assert.equal(isCountryExcluded('Thailand'), false);
  assert.equal(isCountryExcluded('Japan'), false);
});

test('generateDatePairs produces 10 distinct date pairs', () => {
  const pairs = generateDatePairs(10);
  assert.equal(pairs.length, 10);
  const keys = new Set(pairs.map((p) => p.key));
  assert.equal(keys.size, 10);
  for (const p of pairs) {
    assert.ok(p.nights >= 1);
    assert.match(p.checkin, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(p.checkout, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('decodeAirbnbId decodes Base64 StayListing IDs', () => {
  const b64 = Buffer.from('StayListing:987654321').toString('base64');
  assert.equal(decodeAirbnbId(b64), '987654321');
  assert.equal(decodeAirbnbId('12345678'), '12345678');
});

test('normalizePricePerNight divides total multi-night prices correctly', () => {
  assert.equal(normalizePricePerNight('$150', 'tổng cho 3 đêm', 3), 50);
  assert.equal(normalizePricePerNight('$85', '/ đêm', 2), 85);
});

test('parseSearchHtml extracts StaySearchResult from data-deferred-state-0', () => {
  const b64Id = Buffer.from('StayListing:555000111').toString('base64');
  const mockState = {
    niobeClientData: [
      [
        'StaysSearch',
        {
          data: {
            presentation: {
              staysSearch: {
                results: {
                  searchResults: [
                    {
                      __typename: 'StaySearchResult',
                      title: 'Luxury Sky Condo @ Ashton Asoke',
                      avgRatingLocalized: '4,92 (48)',
                      badges: [{ loggingContext: { badgeType: 'GUEST_FAVORITE' } }],
                      demandStayListing: {
                        id: b64Id,
                        location: { coordinate: { latitude: 13.738, longitude: 100.561 } },
                      },
                      structuredDisplayPrice: {
                        primaryLine: {
                          price: '$160',
                          qualifier: 'cho 2 đêm',
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    ],
  };

  const html = `<html><body><script id="data-deferred-state-0" type="application/json">${JSON.stringify(
    mockState
  )}</script></body></html>`;

  const { listings } = parseSearchHtml(html, 2);
  assert.equal(listings.length, 1);
  assert.equal(listings[0].listingId, '555000111');
  assert.equal(listings[0].pricePerNight, 80);
  assert.equal(listings[0].ratingAverage, 4.92);
  assert.equal(listings[0].ratingCount, 48);
  assert.equal(listings[0].isGuestFavorite, true);
  assert.equal(listings[0].listingUrl, 'https://www.airbnb.com.vn/rooms/555000111');
});

test('parsePdpPayloads extracts AMENITIES_DEFAULT, LOCATION_DEFAULT, and Host Info', () => {
  const mockPdp = {
    sections: [
      {
        sectionId: 'AMENITIES_DEFAULT',
        section: {
          seeAllAmenitiesGroups: [
            {
              amenities: [
                { title: 'Thang máy', available: true },
                { title: 'Hồ bơi chung', available: true },
                { title: 'Phòng tập thể hình', available: true },
              ],
            },
          ],
        },
      },
      {
        sectionId: 'LOCATION_DEFAULT',
        section: { lat: 13.7381, lng: 100.5612 },
      },
      {
        sectionId: 'MEET_YOUR_HOST',
        section: {
          cardData: { userId: '77788899', name: 'Somchai' },
        },
      },
      {
        sectionId: 'OVERVIEW_DEFAULT_V2',
        section: { title: 'Toàn bộ căn hộ chung cư cao cấp tại Bangkok' },
      },
    ],
  };

  const parsed = parsePdpPayloads([mockPdp]);
  assert.equal(parsed.hostId, '77788899');
  assert.equal(parsed.hostName, 'Somchai');
  assert.equal(parsed.lat, 13.7381);
  assert.equal(parsed.amenities.length, 3);
});

test('classifyHighRiseCondo uses Multi-Criteria Scoring System and hard exclusions', () => {
  const yesResult = classifyHighRiseCondo({
    amenities: ['Thang máy', 'Hồ bơi chung', 'Phòng tập thể hình', 'Ban công'],
    propertyType: 'Condo',
    title: 'Ashton Asoke High Floor',
  });
  assert.equal(yesResult.isHighRise, 'YES');
  assert.ok(yesResult.score >= 4);

  // Condo without explicit "Thang máy" keyword still passes if score >= 4
  const yesWithoutElevatorKeyword = classifyHighRiseCondo({
    amenities: ['Hồ bơi chung', 'Gym', 'Ban công'],
    propertyType: 'Condo',
    title: 'Vinhomes Central Park Tầng 18',
  });
  assert.equal(yesWithoutElevatorKeyword.isHighRise, 'YES');
  assert.ok(yesWithoutElevatorKeyword.score >= 4);

  // Hard exclusion: explicit No elevator
  const noElevatorResult = classifyHighRiseCondo({
    amenities: ['No elevator', 'Hồ bơi chung'],
    propertyType: 'Condo',
    title: 'Walk-up Condo',
  });
  assert.equal(noElevatorResult.isHighRise, 'NO');

  // Hard exclusion: Villa
  const villaResult = classifyHighRiseCondo({
    amenities: ['Thang máy', 'Hồ bơi riêng'],
    propertyType: 'Villa',
    title: 'Luxury Villa',
  });
  assert.equal(villaResult.isHighRise, 'NO');
});

test('deduplicateAndAggregatePrices, buildingAggregator, and Excel exporter work end-to-end', async () => {
  const listings = [];
  const priceHistory = [];
  for (let i = 1; i <= 6; i++) {
    const id = String(100000 + i);
    listings.push({
      listingId: id,
      city: 'Bangkok',
      country: 'Thailand',
      title: `Ashton Asoke Unit ${i}`,
      listingUrl: `https://www.airbnb.com.vn/rooms/${id}`,
      propertyType: 'Condo',
      hostId: String(9000 + i),
      hostName: `Host ${i}`,
      hostUrl: `https://www.airbnb.com.vn/users/show/${9000 + i}`,
      lat: 13.738,
      lng: 100.561,
      buildingName: 'Ashton Asoke',
      streetAddress: '21 Asok Montri Rd, Bangkok',
      isHighRise: 'YES',
      matchedAmenities: ['Thang máy', 'Hồ bơi chung', 'Gym'],
      ratingCount: i === 1 ? 45 : 12,
      ratingAverage: 4.9,
      isGuestFavorite: i === 1,
      badgeLabel: i === 1 ? 'GUEST_FAVORITE' : '',
    });
    priceHistory.push(
      { listing_id: id, date_key: '2026-11-20->2026-11-22', price_per_night: 80 },
      { listing_id: id, date_key: '2026-11-27->2026-11-29', price_per_night: 100 }
    );
  }

  const clean = deduplicateAndAggregatePrices(listings, priceHistory);
  assert.equal(clean.length, 6);
  assert.equal(clean[0].minPrice, 80);
  assert.equal(clean[0].maxPrice, 100);
  assert.equal(clean[0].priceSpreadPct, 20);

  const { buildings, citySummary } = aggregateBuildingsAndCitySummary({
    city: 'Bangkok',
    country: 'Thailand',
    rawSearchCount: 12,
    cleanListings: clean,
  });

  assert.equal(buildings.length, 1);
  assert.equal(buildings[0].uniqueHostsCount, 6);
  assert.equal(buildings[0].status, 'ĐẠT (>=5 Host)');
  assert.equal(citySummary.qualifiedBuildings, 1);

  const tmpOut = path.resolve('./data/test_output');
  const { cityReportPath, masterPath } = await exportCityReports({
    city: 'Bangkok',
    country: 'Thailand',
    citySummary,
    buildings,
    cleanListings: clean,
    priceHistoryRows: priceHistory,
    datePairs: [
      { key: '2026-11-20->2026-11-22' },
      { key: '2026-11-27->2026-11-29' },
    ],
    allCitySummaries: [citySummary],
    outputDir: tmpOut,
  });

  assert.equal(fs.existsSync(cityReportPath), true);
  assert.equal(fs.existsSync(masterPath), true);

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(cityReportPath);
  const sheetNames = wb.worksheets.map((s) => s.name);
  assert.deepEqual(sheetNames, [
    'Tong_Quan_Doi_Sanh',
    'Top_10_Toa_Nha_Tiem_Nang',
    'Du_Lieu_Chi_Tiet_Can_Ho',
    'Ma_Tran_Gia_Theo_Ngay',
    'Danh_Muc_Host_Ngoai_Khu_Vuc',
  ]);

  fs.rmSync(tmpOut, { recursive: true, force: true });
});
