#!/usr/bin/env node
import cliProgress from 'cli-progress';
import { Command } from 'commander';
import ora from 'ora';
import {
  APP_CONFIG,
  generateDatePairs,
  isCountryExcluded,
} from './config/index.js';
import { exportCityReports } from './exporters/excelExporter.js';
import {
  classifyAndGeocodeListings,
  expandHostPortfolios,
  scanMultiDateSearch,
} from './scraper/airbnbScraper.js';
import { launchAirbnbBrowser } from './scraper/browser.js';
import { aggregateBuildingsAndCitySummary } from './services/buildingAggregator.js';
import { deduplicateAndAggregatePrices } from './services/deduplicator.js';
import { fetchCityBounds } from './services/geocoder.js';
import { MarketDatabase } from './storage/database.js';

const program = new Command();

program
  .name('airbnb-market-cli')
  .description(
    'Cong cu CLI thu thap, phan loai chung cu cao tang va xuat bao cao Excel OTA Arbitrage tu airbnb.com.vn'
  )
  .requiredOption('-c, --city <city>', 'Ten thanh pho muc tieu (VD: "Bangkok")')
  .requiredOption('-C, --country <country>', 'Ten quoc gia muc tieu (VD: "Thailand")')
  .option('-i, --iterations <number>', 'So lan quet khung ngay (mac dinh: 10)', '10')
  .option('-t, --target <number>', 'So can tho muc tieu (mac dinh: 100)', '100')
  .option('--headed', 'Mo trinh duyet co giao dien (mac dinh: headless)', false)
  .option('--skip-host-expansion', 'Bo qua buoc mo rong danh sach theo Host', false)
  .option('--export-only', 'Chi tong hop va xuat Excel tu du lieu SQLite da luu', false)
  .option('--radius <km>', 'Ban kinh Geofence toi da quanh tam thanh pho (mac dinh: 40 km)', '40')
  .parse(process.argv);

const opts = program.opts();

async function main() {
  const city = opts.city.trim();
  const country = opts.country.trim();
  const iterations = Math.max(1, parseInt(opts.iterations, 10) || 10);
  const targetRaw = Math.max(1, parseInt(opts.target, 10) || 100);

  // =========================================================================
  // MARKET GUARDRAIL: Block Vietnam, Indonesia, Malaysia immediately
  // =========================================================================
  if (isCountryExcluded(country)) {
    console.error(
      `\n[BI CHAN - MARKET GUARDRAIL] Quoc gia "${country}" nam trong danh sach loai tru bat buoc (Vietnam, Indonesia, Malaysia).\nDung chuong trinh ngay lap tuc.`
    );
    process.exit(1);
  }

  console.log('====================================================================');
  console.log(` AIRBNB.COM.VN MARKET RESEARCH CLI - OTA ARBITRAGE`);
  console.log(` Muc tieu: ${city}, ${country} | Khung ngay: ${iterations} | Target tho: ${targetRaw}`);
  console.log('====================================================================\n');

  const startTimeMs = Date.now();
  const db = new MarketDatabase(APP_CONFIG.dbPath);
  const maxRadiusKm = Math.max(5, parseFloat(opts.radius) || 40);
  const cityBounds = await fetchCityBounds(city, country);
  if (cityBounds) {
    console.log(
      `[Geofence] Tam "${city}, ${country}": (${cityBounds.centerLat.toFixed(5)}, ${cityBounds.centerLng.toFixed(5)}) | Ban kinh hop le: <= ${maxRadiusKm} km`
    );
  }
  let datePairs = generateDatePairs(iterations);
  let rawSearchCount = 0;

  try {
    if (!opts.exportOnly) {
      const browserSpinner = ora('Dang khoi tao trinh duyet Playwright (locale: vi-VN)...').start();
      const { browser, context, hasProxy } = await launchAirbnbBrowser({
        headless: !opts.headed,
      });
      const gridDim = targetRaw >= 300 ? '3x3' : '2x2';
      const modeLabel = hasProxy
        ? `Proxy Mode: ACTIVE (15 Workers | Grid Search ${gridDim})`
        : `Direct Mode (8 Workers | Grid Search ${gridDim})`;
      browserSpinner.succeed(`Da khoi tao trinh duyet Playwright (${modeLabel}).`);

      try {
        // -----------------------------------------------------------------
        // STEP 1: Multi-date + Grid search scan
        // -----------------------------------------------------------------
        console.log('\n[Buoc 1/4] Quet luoi ban do & da khung ngay...');
        const searchBar = new cliProgress.SingleBar(
          {
            format:
              '  Quet luoi |{bar}| {percentage}% | {value}/{total} tac vu | Can duy nhat: {uniqueSoFar}',
          },
          cliProgress.Presets.shades_classic
        );
        const expectedTasks = iterations * (cityBounds ? (targetRaw >= 300 ? 9 : 4) : 1);
        searchBar.start(expectedTasks, 0, { uniqueSoFar: 0 });

        const searchResult = await scanMultiDateSearch({
          context,
          db,
          city,
          country,
          iterations,
          targetRaw,
          cityBounds,
          maxRadiusKm,
          hasProxy,
          onProgress: ({ iteration, totalIterations, uniqueSoFar }) => {
            if (totalIterations) searchBar.setTotal(totalIterations);
            searchBar.update(iteration, { uniqueSoFar });
          },
        });

        searchBar.stop();
        datePairs = searchResult.datePairs;
        rawSearchCount = searchResult.totalRawObservations;
        console.log(
          `  -> Hoan tat Buoc 1: Thu thap ${rawSearchCount} luot hien thi (${searchResult.uniqueSearchCount} can duy nhat).\n`
        );

        // -----------------------------------------------------------------
        // STEP 2: Host Portfolio Expansion
        // -----------------------------------------------------------------
        console.log('[Buoc 2/4] Truy cap chi tiet phong & Mo rong danh sach theo Host...');
        const pdpSpinner = ora('Dang quet thong tin PDP & mo rong Host Portfolio...').start();

        await expandHostPortfolios({
          context,
          db,
          city,
          country,
          cityBounds,
          maxRadiusKm,
          hasProxy,
          skipHostExpansion: Boolean(opts.skipHostExpansion),
          onPdpProgress: (done, total, listingId) => {
            pdpSpinner.text = `Dang doc PDP & AMENITIES_DEFAULT (${done}/${total}) - ID: ${listingId}`;
            if (done === 1 || done % 10 === 0 || done === total) {
              console.log(`  [PDP] ${done}/${total} (ID: ${listingId})`);
            }
          },
          onHostProgress: (done, total, hostName, count) => {
            pdpSpinner.text = `Dang mo rong Host (${done}/${total}): ${hostName} (+${count} can)`;
            if (done === 1 || done % 5 === 0 || done === total) {
              console.log(`  [Host] ${done}/${total}: ${hostName} (+${count} can)`);
            }
          },
        });

        pdpSpinner.succeed('Hoan tat quet PDP & mo rong Host Portfolio.');
      } finally {
        await browser.close();
      }
    } else {
      console.log('[Che do Export-Only] Doc du lieu da luu trong SQLite...');
    }

    // ---------------------------------------------------------------------
    // STEP 4 (part 1): Classify High-Rise & Reverse Geocode Building Names
    // ---------------------------------------------------------------------
    console.log('\n[Buoc 3/4] Phan loai chung cu cao tang (AMENITIES_DEFAULT) & Dinh vi toa nha...');
    const geoSpinner = ora('Dang phan loai & Reverse Geocoding dia chi toa nha...').start();
    await classifyAndGeocodeListings({
      db,
      city,
      country,
      cityBounds,
      maxRadiusKm,
      onProgress: (done, total) => {
        geoSpinner.text = `Dang phan loai & dinh vi toa nha (${done}/${total})...`;
      },
      onClusterProgress: (done, total, _geoKey, count) => {
        geoSpinner.text = `[Geo] Dang dinh vi cum toa nha ${done}/${total} (${count} can)...`;
        if (done === 1 || done % 5 === 0 || done === total) {
          console.log(`  [Geo] Dang dinh vi cum toa nha ${done}/${total} (${count} can)`);
        }
      },
    });
    geoSpinner.succeed('Da phan loai & chuan hoa dia chi toa nha.');

    // ---------------------------------------------------------------------
    // STEP 3 & 4 (part 2): Deduplicate, Price Stats & Building Aggregation
    // ---------------------------------------------------------------------
    const allListings = db.getListingsByCity(city);
    const priceHistoryRows = db.getPriceHistoryByCity(city);
    const cleanListings = deduplicateAndAggregatePrices(allListings, priceHistoryRows);

    // Persist computed price stats back to SQLite
    for (const item of cleanListings) {
      db.upsertListing(item);
    }

    const inTargetListings = cleanListings.filter(
      (l) => (l.scopeStatus || 'IN_TARGET') === 'IN_TARGET'
    );
    const outOfTargetListings = cleanListings.filter(
      (l) => l.scopeStatus === 'OUT_OF_TARGET'
    );

    if (rawSearchCount === 0) {
      rawSearchCount = priceHistoryRows.length || inTargetListings.length;
    }

    const { buildings, citySummary } = aggregateBuildingsAndCitySummary({
      city,
      country,
      rawSearchCount,
      cleanListings: inTargetListings,
    });

    db.upsertCitySummary(citySummary);
    const allCitySummaries = db.getAllCitySummaries();

    // ---------------------------------------------------------------------
    // EXPORT EXCEL REPORTS
    // ---------------------------------------------------------------------
    console.log('\n[Buoc 4/4] Dang xuat bao cao Excel (.xlsx) chuyen sau...');
    const exportSpinner = ora('Dang tao 4 Sheet bao cao + Sheet ngoai vung & cap nhat Master_City_Comparison.xlsx...').start();

    const { cityReportPath, masterPath } = await exportCityReports({
      city,
      country,
      citySummary,
      buildings,
      cleanListings: inTargetListings,
      outOfTargetListings,
      priceHistoryRows,
      datePairs,
      allCitySummaries,
    });

    exportSpinner.succeed('Xuat bao cao Excel thanh cong!');

    const elapsedSec = ((Date.now() - startTimeMs) / 1000).toFixed(1);
    console.log('\n==================== KET QUA PHAN TICH THI TRUONG ====================');
    console.log(` Thanh pho / Quoc gia      : ${city}, ${country}`);
    console.log(` Thoi gian thuc thi        : ${elapsedSec} giay`);
    console.log(` Tong can IN_TARGET        : ${citySummary.cleanCount} (Ngoai vung Host: ${outOfTargetListings.length})`);
    console.log(` Chung cu cao tang (YES)   : ${citySummary.highRiseYesCount} (${citySummary.highRisePct}%)`);
    console.log(` Toa nha dat chuan (>=5H)  : ${citySummary.qualifiedBuildings} / ${citySummary.totalBuildings} toa`);
    console.log(` Gia TB/dem (USD)          : $${citySummary.avgPriceUsd}`);
    console.log(` Bien do gia TB theo ngay  : ${citySummary.avgSpreadPct}%`);
    console.log(` Danh gia (Verdict)        : ${citySummary.verdict}`);
    console.log('----------------------------------------------------------------------');
    console.log(` File bao cao thanh pho    : ${cityReportPath}`);
    console.log(` File doi sanh da TP       : ${masterPath}`);
    console.log('======================================================================\n');
  } finally {
    db.close();
  }
}

main().catch((err) => {
  console.error('\n[LOI HE THONG]', err);
  process.exit(1);
});
