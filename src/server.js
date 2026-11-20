import crypto from 'crypto';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  APP_CONFIG,
  CLASSIFICATION_RULES,
  generateDatePairs,
  normalizeText,
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const SHORT_VERSION = 'v1.6.0';
const APP_VERSION = 'v1.6.0 - IN_TARGET vs OUT_OF_TARGET Host Portfolio Split';
const CHANGELOG = [
  'Khóa bán kính tọa độ 40 km + lọc địa danh ngoại/tỉnh khác ở Bước 1, 2 và 3',
  'Tăng tốc Bước 2 lên 8-10 Worker song song (250-500ms) + chặn domain tracking bên thứ 3',
  'Tự động retry PDP 1 lần & lưu SQLite tức thì theo từng Worker',
  'Nhận diện tên tòa nhà từ 3 nguồn (Dự án thương mại -> Nominatim -> Khu vực đường/phường)',
  'Tự động cập nhật thời điểm build từ toàn bộ mã nguồn src/ và public/',
];

function getLatestMtimeInDir(dir) {
  let latest = 0;
  if (!fs.existsSync(dir)) return latest;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      latest = Math.max(latest, getLatestMtimeInDir(fullPath));
    } else if (/\.(js|html)$/i.test(entry.name)) {
      latest = Math.max(latest, fs.statSync(fullPath).mtimeMs);
    }
  }
  return latest;
}

function getBuildTimeFormatted() {
  let latestMs = Date.now();
  try {
    const srcMtime = getLatestMtimeInDir(path.join(PROJECT_ROOT, 'src'));
    const pubMtime = getLatestMtimeInDir(PUBLIC_DIR);
    const maxMtime = Math.max(srcMtime, pubMtime);
    if (maxMtime > 0) {
      latestMs = maxMtime;
    }
  } catch {
    // Fallback to current time
  }
  const d = new Date(latestMs);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (t) => parts.find((p) => p.type === t)?.value || '00';
  return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

app.use(express.json({ limit: '1mb' }));
app.use(
  express.static(PUBLIC_DIR, {
    etag: false,
    lastModified: false,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    },
  })
);

const jobs = new Map();

function createJobRecord(params) {
  const jobId = crypto.randomUUID();
  const job = {
    jobId,
    params,
    status: 'running', // running | completed | stopped | error
    step: 0, // 1..4
    stepLabel: 'Đang khởi tạo...',
    percent: 0,
    logs: [],
    clients: new Set(),
    abortController: new AbortController(),
    browser: null,
    result: null,
    error: null,
    createdAt: new Date().toISOString(),
  };
  jobs.set(jobId, job);
  return job;
}

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function emitJobEvent(job, event, data) {
  if (event === 'log') {
    const entry = {
      ts: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
      level: data.level || 'info',
      message: data.message,
    };
    job.logs.push(entry);
    if (job.logs.length > 500) {
      job.logs.shift();
    }
    for (const res of job.clients) {
      sendSse(res, 'log', entry);
    }
    return;
  }

  if (event === 'progress') {
    job.step = data.step ?? job.step;
    job.stepLabel = data.stepLabel ?? job.stepLabel;
    job.percent = data.percent ?? job.percent;
  }

  for (const res of job.clients) {
    sendSse(res, event, data);
  }
}

function parseKeywordsInput(keywords) {
  if (!keywords || typeof keywords !== 'object') return null;
  const toList = (val) => {
    if (Array.isArray(val)) {
      return val.map((s) => String(s).trim()).filter(Boolean);
    }
    if (typeof val === 'string') {
      return val
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    return [];
  };

  return {
    mandatory: toList(keywords.mandatory),
    bonus: toList(keywords.bonus),
    excluded: toList(keywords.excluded),
  };
}

async function runScraperJob(job) {
  const {
    city,
    country,
    iterations,
    targetRaw,
    minHostsPerBuilding,
    maxRadiusKm = 40,
    proxyUrl,
    headless,
    delayMs,
    keywords,
    skipHostExpansion,
    exportOnly,
  } = job.params;

  const startTimeMs = Date.now();
  const customRules = parseKeywordsInput(keywords);
  const signal = job.abortController.signal;
  const db = new MarketDatabase(APP_CONFIG.dbPath);

  let datePairs = generateDatePairs(iterations);
  let rawSearchCount = 0;

  try {
    emitJobEvent(job, 'log', {
      level: 'info',
      message: `Bắt đầu tác vụ: ${city}, ${country} | Khung ngày: ${iterations} | Target thô: ${targetRaw} | Ngưỡng Host/tòa: >=${minHostsPerBuilding} | Geofence: <=${maxRadiusKm} km`,
    });

    const cityBounds = await fetchCityBounds(city, country);
    if (cityBounds) {
      emitJobEvent(job, 'log', {
        level: 'info',
        message: `[Geofence] Tâm "${city}, ${country}": (${cityBounds.centerLat.toFixed(5)}, ${cityBounds.centerLng.toFixed(5)}) | Bán kính: ${maxRadiusKm} km`,
      });
    }

    if (!exportOnly) {
      emitJobEvent(job, 'progress', {
        step: 1,
        stepLabel: 'Khởi tạo trình duyệt Playwright...',
        percent: 5,
      });
      emitJobEvent(job, 'log', {
        level: 'info',
        message: `Đang mở Playwright Chromium (headless=${headless}${proxyUrl ? `, proxy=${proxyUrl}` : ''})...`,
      });

      const { browser, context, hasProxy } = await launchAirbnbBrowser({
        headless,
        proxyUrl,
      });
      job.browser = browser;

      const gridDim = targetRaw >= 300 ? '3x3' : '2x2';
      emitJobEvent(job, 'log', {
        level: 'success',
        message: hasProxy
          ? `Proxy Mode: ACTIVE (15 Workers | Grid Search ${gridDim})`
          : `Direct Mode (8 Workers | Grid Search ${gridDim})`,
      });

      try {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

        // Step 1: Multi-date + Grid search scan
        emitJobEvent(job, 'progress', {
          step: 1,
          stepLabel: `Bước 1/4: Quét lưới ${gridDim} & đa khung ngày`,
          percent: 10,
        });
        emitJobEvent(job, 'log', {
          level: 'step',
          message: `[Bước 1/4] Đang quét lưới ${gridDim} & đa khung ngày trên airbnb.com.vn...`,
        });

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
          delayMs,
          signal,
          onProgress: ({ iteration, totalIterations, dateKey, foundThisRun, uniqueSoFar }) => {
            const pct = 10 + Math.round((iteration / totalIterations) * 25);
            emitJobEvent(job, 'progress', {
              step: 1,
              stepLabel: `Bước 1/4: Quét khung ngày ${iteration}/${totalIterations} (${dateKey})`,
              percent: pct,
            });
            emitJobEvent(job, 'log', {
              level: 'info',
              message: `  [Search ${iteration}/${totalIterations}] ${dateKey}: +${foundThisRun} căn (Tổng duy nhất: ${uniqueSoFar})`,
            });
          },
        });

        datePairs = searchResult.datePairs;
        rawSearchCount = searchResult.totalRawObservations;
        emitJobEvent(job, 'log', {
          level: 'success',
          message: `-> Hoàn tất Bước 1: ${rawSearchCount} lượt hiển thị (${searchResult.uniqueSearchCount} căn duy nhất).`,
        });

        // Step 2: Host Portfolio Expansion
        emitJobEvent(job, 'progress', {
          step: 2,
          stepLabel: 'Bước 2/4: Truy cập PDP & Mở rộng danh sách theo Host',
          percent: 38,
        });
        emitJobEvent(job, 'log', {
          level: 'step',
          message: '[Bước 2/4] Đang đọc chi tiết phòng (PDP) & mở rộng Host Portfolio...',
        });

        await expandHostPortfolios({
          context,
          db,
          city,
          country,
          cityBounds,
          maxRadiusKm,
          hasProxy,
          skipHostExpansion: Boolean(skipHostExpansion),
          delayMs,
          signal,
          onPdpProgress: (done, total, listingId) => {
            const pct = 38 + Math.round((done / Math.max(1, total)) * 22);
            emitJobEvent(job, 'progress', {
              step: 2,
              stepLabel: `Bước 2/4: Đọc PDP & AMENITIES_DEFAULT (${done}/${total})`,
              percent: pct,
            });
            if (done === 1 || done % 5 === 0 || done === total) {
              emitJobEvent(job, 'log', {
                level: 'info',
                message: `  [PDP] ${done}/${total} - ID: ${listingId}`,
              });
            }
          },
          onHostProgress: (done, total, hostName, count) => {
            const pct = 60 + Math.round((done / Math.max(1, total)) * 12);
            emitJobEvent(job, 'progress', {
              step: 2,
              stepLabel: `Bước 2/4: Mở rộng Host (${done}/${total})`,
              percent: pct,
            });
            emitJobEvent(job, 'log', {
              level: 'info',
              message: `  [Host ${done}/${total}] ${hostName} (+${count} căn)`,
            });
          },
        });

        emitJobEvent(job, 'log', {
          level: 'success',
          message: '-> Hoàn tất Bước 2: Đã quét PDP & mở rộng Host Portfolio.',
        });
      } finally {
        job.browser = null;
        await browser.close().catch(() => {});
      }
    } else {
      emitJobEvent(job, 'log', {
        level: 'info',
        message: '[Chế độ Export-Only] Bỏ qua cào web, đọc trực tiếp dữ liệu từ SQLite...',
      });
    }

    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    // Step 3: Classify High-Rise & Reverse Geocode & Aggregate
    emitJobEvent(job, 'progress', {
      step: 3,
      stepLabel: 'Bước 3/4: Phân loại chung cư cao tầng & Định vị tòa nhà',
      percent: 75,
    });
    emitJobEvent(job, 'log', {
      level: 'step',
      message: '[Bước 3/4] Đang phân loại AMENITIES_DEFAULT & Reverse Geocoding tòa nhà...',
    });

    await classifyAndGeocodeListings({
      db,
      city,
      country,
      cityBounds,
      maxRadiusKm,
      rules: customRules,
      signal,
      onClusterProgress: (done, total, _geoKey, count) => {
        const pct = 75 + Math.round((done / Math.max(1, total)) * 15);
        emitJobEvent(job, 'progress', {
          step: 3,
          stepLabel: `Bước 3/4: Định vị cụm tòa nhà (${done}/${total})`,
          percent: pct,
        });
        if (done === 1 || done % 3 === 0 || done === total) {
          emitJobEvent(job, 'log', {
            level: 'info',
            message: `  [Geo] Đang định vị cụm tòa nhà ${done}/${total} (${count} căn)...`,
          });
        }
      },
    });

    const allListings = db.getListingsByCity(city);
    const priceHistoryRows = db.getPriceHistoryByCity(city);
    const cleanListings = deduplicateAndAggregatePrices(allListings, priceHistoryRows);

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
      minHostsPerBuilding,
    });

    db.upsertCitySummary(citySummary);
    const allCitySummaries = db.getAllCitySummaries();

    emitJobEvent(job, 'log', {
      level: 'success',
      message: `-> Hoàn tất Bước 3: ${inTargetListings.length} căn đúng vùng (${outOfTargetListings.length} căn ngoài vùng) | ${citySummary.highRiseYesCount} cao tầng YES (${citySummary.highRisePct}%) | ${citySummary.qualifiedBuildings}/${citySummary.totalBuildings} tòa đạt chuẩn (>=${minHostsPerBuilding} Host).`,
    });

    // Step 4: Export Excel
    emitJobEvent(job, 'progress', {
      step: 4,
      stepLabel: 'Bước 4/4: Xuất báo cáo Excel (.xlsx)',
      percent: 92,
    });
    emitJobEvent(job, 'log', {
      level: 'step',
      message: '[Bước 4/4] Đang tạo file Excel báo cáo thành phố & cập nhật Master_City_Comparison.xlsx...',
    });

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

    const cityReportFile = path.basename(cityReportPath);
    const masterFile = path.basename(masterPath);

    const elapsedSec = ((Date.now() - startTimeMs) / 1000).toFixed(1);
    job.status = 'completed';
    job.result = {
      citySummary,
      cityReportFile,
      masterFile,
      elapsedSec,
      inTargetCount: inTargetListings.length,
      outOfTargetCount: outOfTargetListings.length,
    };

    emitJobEvent(job, 'progress', {
      step: 4,
      stepLabel: `Hoàn tất xuất Excel trong ${elapsedSec}s!`,
      percent: 100,
    });
    emitJobEvent(job, 'log', {
      level: 'success',
      message: `-> Hoàn tất trong ${elapsedSec}s | IN_TARGET: ${inTargetListings.length} căn | Đã xuất: ${cityReportFile} & ${masterFile}`,
    });
    emitJobEvent(job, 'done', {
      status: 'completed',
      result: job.result,
    });
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted) {
      job.status = 'stopped';
      emitJobEvent(job, 'log', {
        level: 'warn',
        message: 'Tác vụ đã bị dừng theo yêu cầu. Đã đóng trình duyệt Playwright.',
      });
      emitJobEvent(job, 'stopped', { status: 'stopped' });
    } else {
      job.status = 'error';
      job.error = err?.message || String(err);
      emitJobEvent(job, 'log', {
        level: 'error',
        message: `[LỖI] ${job.error}`,
      });
      emitJobEvent(job, 'error', { status: 'error', error: job.error });
    }
  } finally {
    db.close();
  }
}

// ============================================================================
// API ROUTES
// ============================================================================

const DEFAULT_EXCLUDED_COUNTRIES = [ 'Indonesia', 'Malaysia'];

function isCountryInExcludedList(country, excludedCountries) {
  const normCountry = normalizeText(country);
  if (!normCountry) return false;
  for (const item of excludedCountries) {
    const normItem = normalizeText(item);
    if (!normItem) continue;
    if (normCountry === normItem) return true;
    if (normItem.length > 2 && normCountry.includes(normItem)) return true;
  }
  return false;
}

app.get('/api/system/version', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.json({
    version: APP_VERSION,
    shortVersion: SHORT_VERSION,
    updatedAt: getBuildTimeFormatted(),
    changelog: CHANGELOG,
  });
});

app.get('/api/config/defaults', (_req, res) => {
  res.json({
    excludedCountries: DEFAULT_EXCLUDED_COUNTRIES,
    iterations: 10,
    targetRaw: 100,
    minHostsPerBuilding: 5,
    headless: APP_CONFIG.headless,
    delayMs: Math.round((APP_CONFIG.minDelayMs + APP_CONFIG.maxDelayMs) / 2),
    keywords: {
      mandatory: CLASSIFICATION_RULES.elevatorKeywords,
      bonus: CLASSIFICATION_RULES.complexAmenities.flatMap((c) => c.keywords),
      excluded: CLASSIFICATION_RULES.excludedPropertyKeywords,
    },
  });
});

app.post('/api/jobs/start', (req, res) => {
  const {
    city,
    country,
    excludedCountries,
    iterations = 10,
    targetRaw = 100,
    minHostsPerBuilding = 5,
    proxyUrl = '',
    headless = true,
    delayMs = 3000,
    keywords = null,
    skipHostExpansion = false,
    exportOnly = false,
  } = req.body || {};

  const cleanCity = String(city || '').trim();
  const cleanCountry = String(country || '').trim();

  if (!cleanCity || !cleanCountry) {
    return res.status(400).json({ error: 'Vui lòng nhập đầy đủ Thành phố và Quốc gia.' });
  }

  const activeExcludedCountries = Array.isArray(excludedCountries)
    ? excludedCountries.map((c) => String(c).trim()).filter(Boolean)
    : DEFAULT_EXCLUDED_COUNTRIES;

  if (isCountryInExcludedList(cleanCountry, activeExcludedCountries)) {
    return res.status(400).json({
      error: `Quốc gia "${cleanCountry}" nằm trong danh sách quốc gia loại trừ (${activeExcludedCountries.join(', ')}).`,
    });
  }

  // Prevent overlapping active browser jobs
  for (const existing of jobs.values()) {
    if (existing.status === 'running') {
      return res.status(409).json({
        error: `Đang có tác vụ chạy (${existing.params.city}). Vui lòng dừng trước khi tạo tác vụ mới.`,
        activeJobId: existing.jobId,
      });
    }
  }

  const job = createJobRecord({
    city: cleanCity,
    country: cleanCountry,
    iterations: Math.max(1, parseInt(iterations, 10) || 10),
    targetRaw: Math.max(1, parseInt(targetRaw, 10) || 100),
    minHostsPerBuilding: Math.max(1, parseInt(minHostsPerBuilding, 10) || 5),
    maxRadiusKm: Math.max(5, parseFloat(req.body?.maxRadiusKm) || 40),
    proxyUrl: String(proxyUrl || '').trim(),
    headless: Boolean(headless),
    delayMs: Math.max(200, parseInt(delayMs, 10) || 3000),
    keywords,
    skipHostExpansion: Boolean(skipHostExpansion),
    exportOnly: Boolean(exportOnly),
  });

  // Launch asynchronously
  runScraperJob(job);

  return res.json({
    jobId: job.jobId,
    status: job.status,
  });
});

app.get('/api/jobs/:jobId/stream', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy jobId.' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Replay current state & logs
  sendSse(res, 'progress', {
    step: job.step,
    stepLabel: job.stepLabel,
    percent: job.percent,
  });
  for (const entry of job.logs) {
    sendSse(res, 'log', entry);
  }

  if (job.status === 'completed') {
    sendSse(res, 'done', { status: 'completed', result: job.result });
  } else if (job.status === 'stopped') {
    sendSse(res, 'stopped', { status: 'stopped' });
  } else if (job.status === 'error') {
    sendSse(res, 'error', { status: 'error', error: job.error });
  }

  job.clients.add(res);
  req.on('close', () => {
    job.clients.delete(res);
  });
});

app.post('/api/jobs/:jobId/stop', async (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) {
    return res.status(404).json({ error: 'Không tìm thấy jobId.' });
  }

  if (job.status === 'running') {
    job.abortController.abort();
    if (job.browser) {
      await job.browser.close().catch(() => {});
      job.browser = null;
    }
    job.status = 'stopped';
  }

  return res.json({ jobId: job.jobId, status: job.status });
});

app.get('/api/reports', (_req, res) => {
  try {
    if (!fs.existsSync(APP_CONFIG.outputDir)) {
      return res.json({ files: [] });
    }
    const entries = fs.readdirSync(APP_CONFIG.outputDir);
    const files = entries
      .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
      .map((name) => {
        const fullPath = path.join(APP_CONFIG.outputDir, name);
        const stat = fs.statSync(fullPath);
        return {
          name,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    return res.json({ files });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get('/api/reports/download/:filename', (req, res) => {
  const safeName = path.basename(req.params.filename || '');
  if (!safeName || !safeName.toLowerCase().endsWith('.xlsx')) {
    return res.status(400).json({ error: 'Tên file không hợp lệ.' });
  }

  const filePath = path.join(APP_CONFIG.outputDir, safeName);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Không tìm thấy file báo cáo.' });
  }

  return res.download(filePath, safeName);
});

app.get('/api/db/preview', (req, res) => {
  const requestedCity = String(req.query.city || '').trim();
  const minHosts = Math.max(1, parseInt(req.query.minHosts, 10) || 5);

  if (!fs.existsSync(APP_CONFIG.dbPath)) {
    return res.json({
      cities: [],
      selectedCity: '',
      citySummary: null,
      topBuildings: [],
      recentListings: [],
    });
  }

  const db = new MarketDatabase(APP_CONFIG.dbPath);
  try {
    const cityRuns = db.getAllCitySummaries();
    const cities = cityRuns.map((c) => c.city);

    let selectedCity = requestedCity;
    if (!selectedCity && cities.length > 0) {
      selectedCity = cities[0];
    }

    if (!selectedCity) {
      const firstRow = db.db.prepare('SELECT DISTINCT city FROM listings LIMIT 1').get();
      selectedCity = firstRow?.city || '';
    }

    if (!selectedCity) {
      return res.json({
        cities: [],
        selectedCity: '',
        citySummary: null,
        topBuildings: [],
        recentListings: [],
      });
    }

    const listings = db.getListingsByCity(selectedCity);
    const inTargetAll = listings.filter((l) => (l.scopeStatus || 'IN_TARGET') === 'IN_TARGET');
    const outOfTargetAll = listings.filter((l) => l.scopeStatus === 'OUT_OF_TARGET');

    const matchedSummary = cityRuns.find((c) => c.city === selectedCity) || null;
    const { buildings, citySummary } = aggregateBuildingsAndCitySummary({
      city: selectedCity,
      country: matchedSummary?.country || listings[0]?.country || '',
      rawSearchCount: matchedSummary?.raw_count || inTargetAll.length,
      cleanListings: inTargetAll,
      minHostsPerBuilding: minHosts,
    });

    const mapPreviewRow = (l) => ({
      listingId: l.listingId,
      title: l.title || `(ID ${l.listingId})`,
      buildingName: l.buildingName || 'Chưa xác định',
      hostId: l.hostId || '',
      hostName:
        l.hostName && l.hostName.trim().length >= 2
          ? l.hostName.trim()
          : l.hostId
          ? `Host #${l.hostId}`
          : 'Ẩn danh',
      isHighRise: l.isHighRise,
      highRiseReason: l.highRiseReason || '',
      avgPrice: l.avgPrice,
      priceSpreadPct: l.priceSpreadPct,
      listingUrl: l.listingUrl,
      scopeStatus: l.scopeStatus || 'IN_TARGET',
      actualCountry: l.actualCountry || '',
      actualCity: l.actualCity || l.streetAddress || '',
      coordinates:
        typeof l.lat === 'number' && typeof l.lng === 'number'
          ? `${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}`
          : '',
    });

    const recentListings = inTargetAll.slice(0, 40).map(mapPreviewRow);
    const outOfTargetListings = outOfTargetAll.slice(0, 50).map(mapPreviewRow);

    return res.json({
      cities,
      selectedCity,
      citySummary,
      topBuildings: buildings.slice(0, 20),
      recentListings,
      outOfTargetListings,
      counts: {
        inTarget: inTargetAll.length,
        outOfTarget: outOfTargetAll.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  } finally {
    db.close();
  }
});

app.listen(PORT, () => {
  console.log(`\n============================================================`);
  console.log(` Airbnb Market Web UI dang chay tai: http://localhost:${PORT}`);
  console.log(` Thu muc tinh: ${PUBLIC_DIR}`);
  console.log(`============================================================\n`);
});
