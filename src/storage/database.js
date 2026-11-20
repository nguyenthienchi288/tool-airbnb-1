import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { APP_CONFIG } from '../config/index.js';

const require = createRequire(import.meta.url);

function openSqliteDatabase(dbPath) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbPath);
    db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    return db;
  } catch {
    const BetterSqlite3 = require('better-sqlite3');
    const db = new BetterSqlite3(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 5000');
    return db;
  }
}

export class MarketDatabase {
  constructor(dbPath = APP_CONFIG.dbPath) {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = openSqliteDatabase(dbPath);
    this.initSchema();
  }

  initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS city_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        raw_count INTEGER DEFAULT 0,
        clean_count INTEGER DEFAULT 0,
        highrise_yes_count INTEGER DEFAULT 0,
        highrise_no_count INTEGER DEFAULT 0,
        highrise_pct REAL DEFAULT 0,
        total_buildings INTEGER DEFAULT 0,
        qualified_buildings INTEGER DEFAULT 0,
        avg_price_usd REAL DEFAULT 0,
        avg_spread_pct REAL DEFAULT 0,
        verdict TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        UNIQUE(city, country)
      );

      CREATE TABLE IF NOT EXISTS listings (
        listing_id TEXT NOT NULL,
        city TEXT NOT NULL,
        country TEXT NOT NULL,
        title TEXT,
        listing_url TEXT,
        source TEXT DEFAULT 'search',
        property_type TEXT,
        host_id TEXT,
        host_name TEXT,
        host_url TEXT,
        lat REAL,
        lng REAL,
        building_name TEXT,
        street_address TEXT,
        is_high_rise TEXT DEFAULT 'NO',
        high_rise_reason TEXT,
        matched_amenities_json TEXT DEFAULT '[]',
        all_amenities_json TEXT DEFAULT '[]',
        description TEXT,
        rating_count INTEGER DEFAULT 0,
        rating_average REAL DEFAULT 0,
        is_guest_favorite INTEGER DEFAULT 0,
        badge_label TEXT DEFAULT '',
        min_price REAL,
        max_price REAL,
        avg_price REAL,
        price_spread_pct REAL DEFAULT 0,
        pdp_fetched INTEGER DEFAULT 0,
        scope_status TEXT DEFAULT 'IN_TARGET',
        target_city TEXT,
        actual_country TEXT DEFAULT '',
        actual_city TEXT DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY (listing_id, city)
      );

      CREATE TABLE IF NOT EXISTS price_history (
        listing_id TEXT NOT NULL,
        city TEXT NOT NULL,
        date_key TEXT NOT NULL,
        checkin TEXT NOT NULL,
        checkout TEXT NOT NULL,
        nights INTEGER DEFAULT 1,
        price_per_night REAL NOT NULL,
        PRIMARY KEY (listing_id, city, date_key)
      );

      CREATE TABLE IF NOT EXISTS hosts_expanded (
        host_id TEXT NOT NULL,
        city TEXT NOT NULL,
        host_name TEXT,
        host_url TEXT,
        listings_count INTEGER DEFAULT 0,
        expanded_at TEXT NOT NULL,
        PRIMARY KEY (host_id, city)
      );

      CREATE TABLE IF NOT EXISTS geocode_cache (
        cache_key TEXT PRIMARY KEY,
        building_name TEXT,
        street_address TEXT,
        raw_display_name TEXT,
        updated_at TEXT NOT NULL
      );
    `);

    // Safe migration for existing SQLite databases
    const migrations = [
      "ALTER TABLE listings ADD COLUMN scope_status TEXT DEFAULT 'IN_TARGET'",
      'ALTER TABLE listings ADD COLUMN target_city TEXT',
      "ALTER TABLE listings ADD COLUMN actual_country TEXT DEFAULT ''",
      "ALTER TABLE listings ADD COLUMN actual_city TEXT DEFAULT ''",
    ];
    for (const sql of migrations) {
      try {
        this.db.exec(sql);
      } catch {
        // Column already exists
      }
    }
  }

  upsertListing(listing) {
    const stmt = this.db.prepare(`
      INSERT INTO listings (
        listing_id, city, country, title, listing_url, source, property_type,
        host_id, host_name, host_url, lat, lng, building_name, street_address,
        is_high_rise, high_rise_reason, matched_amenities_json, all_amenities_json,
        description, rating_count, rating_average, is_guest_favorite, badge_label,
        min_price, max_price, avg_price, price_spread_pct, pdp_fetched,
        scope_status, target_city, actual_country, actual_city, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
      ON CONFLICT(listing_id, city) DO UPDATE SET
        title = COALESCE(excluded.title, listings.title),
        listing_url = COALESCE(excluded.listing_url, listings.listing_url),
        source = CASE WHEN listings.source = 'search' THEN 'search' ELSE excluded.source END,
        property_type = COALESCE(excluded.property_type, listings.property_type),
        host_id = COALESCE(excluded.host_id, listings.host_id),
        host_name = COALESCE(excluded.host_name, listings.host_name),
        host_url = COALESCE(excluded.host_url, listings.host_url),
        lat = COALESCE(excluded.lat, listings.lat),
        lng = COALESCE(excluded.lng, listings.lng),
        building_name = COALESCE(excluded.building_name, listings.building_name),
        street_address = COALESCE(excluded.street_address, listings.street_address),
        is_high_rise = COALESCE(excluded.is_high_rise, listings.is_high_rise),
        high_rise_reason = COALESCE(excluded.high_rise_reason, listings.high_rise_reason),
        matched_amenities_json = CASE
          WHEN excluded.matched_amenities_json != '[]' THEN excluded.matched_amenities_json
          ELSE listings.matched_amenities_json
        END,
        all_amenities_json = CASE
          WHEN excluded.all_amenities_json != '[]' THEN excluded.all_amenities_json
          ELSE listings.all_amenities_json
        END,
        description = COALESCE(excluded.description, listings.description),
        rating_count = MAX(COALESCE(excluded.rating_count, 0), COALESCE(listings.rating_count, 0)),
        rating_average = COALESCE(excluded.rating_average, listings.rating_average),
        is_guest_favorite = MAX(COALESCE(excluded.is_guest_favorite, 0), COALESCE(listings.is_guest_favorite, 0)),
        badge_label = CASE
          WHEN excluded.badge_label != '' THEN excluded.badge_label
          ELSE listings.badge_label
        END,
        min_price = COALESCE(excluded.min_price, listings.min_price),
        max_price = COALESCE(excluded.max_price, listings.max_price),
        avg_price = COALESCE(excluded.avg_price, listings.avg_price),
        price_spread_pct = COALESCE(excluded.price_spread_pct, listings.price_spread_pct),
        pdp_fetched = MAX(COALESCE(excluded.pdp_fetched, 0), COALESCE(listings.pdp_fetched, 0)),
        scope_status = COALESCE(excluded.scope_status, listings.scope_status),
        target_city = COALESCE(excluded.target_city, listings.target_city),
        actual_country = CASE
          WHEN excluded.actual_country != '' THEN excluded.actual_country
          ELSE listings.actual_country
        END,
        actual_city = CASE
          WHEN excluded.actual_city != '' THEN excluded.actual_city
          ELSE listings.actual_city
        END,
        updated_at = excluded.updated_at
    `);

    stmt.run(
      listing.listingId,
      listing.city,
      listing.country,
      listing.title || null,
      listing.listingUrl || null,
      listing.source || 'search',
      listing.propertyType || null,
      listing.hostId || null,
      listing.hostName && String(listing.hostName).trim().length >= 2
        ? String(listing.hostName).trim()
        : null,
      listing.hostUrl || null,
      listing.lat ?? null,
      listing.lng ?? null,
      listing.buildingName || null,
      listing.streetAddress || null,
      listing.isHighRise || 'NO',
      listing.highRiseReason || null,
      JSON.stringify(listing.matchedAmenities || []),
      JSON.stringify(listing.allAmenities || []),
      listing.description || null,
      listing.ratingCount || 0,
      listing.ratingAverage || 0,
      listing.isGuestFavorite ? 1 : 0,
      listing.badgeLabel || '',
      listing.minPrice ?? null,
      listing.maxPrice ?? null,
      listing.avgPrice ?? null,
      listing.priceSpreadPct ?? 0,
      listing.pdpFetched ? 1 : 0,
      listing.scopeStatus || 'IN_TARGET',
      listing.targetCity || listing.city || null,
      listing.actualCountry || '',
      listing.actualCity || '',
      new Date().toISOString()
    );
  }

  upsertPriceRecord({ listingId, city, dateKey, checkin, checkout, nights, pricePerNight }) {
    if (!pricePerNight || !Number.isFinite(pricePerNight)) return;
    const stmt = this.db.prepare(`
      INSERT INTO price_history (listing_id, city, date_key, checkin, checkout, nights, price_per_night)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(listing_id, city, date_key) DO UPDATE SET
        price_per_night = excluded.price_per_night
    `);
    stmt.run(listingId, city, dateKey, checkin, checkout, nights, pricePerNight);
  }

  markHostExpanded({ hostId, city, hostName, hostUrl, listingsCount }) {
    const stmt = this.db.prepare(`
      INSERT INTO hosts_expanded (host_id, city, host_name, host_url, listings_count, expanded_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(host_id, city) DO UPDATE SET
        listings_count = excluded.listings_count,
        expanded_at = excluded.expanded_at
    `);
    stmt.run(hostId, city, hostName || '', hostUrl || '', listingsCount || 0, new Date().toISOString());
  }

  isHostExpanded(hostId, city) {
    const row = this.db
      .prepare('SELECT 1 FROM hosts_expanded WHERE host_id = ? AND city = ?')
      .get(hostId, city);
    return Boolean(row);
  }

  mapListingRow(r) {
    if (!r) return null;
    return {
      listingId: r.listing_id,
      city: r.city,
      country: r.country,
      title: r.title || '',
      listingUrl: r.listing_url || '',
      source: r.source || 'search',
      propertyType: r.property_type || '',
      hostId: r.host_id || '',
      hostName: r.host_name || '',
      hostUrl: r.host_url || '',
      lat: r.lat,
      lng: r.lng,
      buildingName: r.building_name || '',
      streetAddress: r.street_address || '',
      isHighRise: r.is_high_rise || 'NO',
      highRiseReason: r.high_rise_reason || '',
      matchedAmenities: JSON.parse(r.matched_amenities_json || '[]'),
      allAmenities: JSON.parse(r.all_amenities_json || '[]'),
      description: r.description || '',
      ratingCount: r.rating_count || 0,
      ratingAverage: r.rating_average || 0,
      isGuestFavorite: Boolean(r.is_guest_favorite),
      badgeLabel: r.badge_label || '',
      minPrice: r.min_price,
      maxPrice: r.max_price,
      avgPrice: r.avg_price,
      priceSpreadPct: r.price_spread_pct || 0,
      pdpFetched: Boolean(r.pdp_fetched),
      scopeStatus: r.scope_status || 'IN_TARGET',
      targetCity: r.target_city || r.city || '',
      actualCountry: r.actual_country || '',
      actualCity: r.actual_city || '',
    };
  }

  getCachedPdpByListingId(listingId) {
    const r = this.db
      .prepare(
        `SELECT * FROM listings
         WHERE listing_id = ?
           AND (
             pdp_fetched = 1
             OR (
               all_amenities_json IS NOT NULL AND all_amenities_json != '[]'
               AND host_id IS NOT NULL AND host_id != ''
               AND lat IS NOT NULL AND lng IS NOT NULL
             )
           )
         ORDER BY pdp_fetched DESC, updated_at DESC
         LIMIT 1`
      )
      .get(listingId);
    return this.mapListingRow(r);
  }

  getListingsByCity(city) {
    const rows = this.db.prepare('SELECT * FROM listings WHERE city = ?').all(city);
    return rows.map((r) => this.mapListingRow(r));
  }

  getPriceHistoryByCity(city) {
    return this.db
      .prepare('SELECT * FROM price_history WHERE city = ?')
      .all(city);
  }

  getGeocodeCache(cacheKey) {
    return this.db.prepare('SELECT * FROM geocode_cache WHERE cache_key = ?').get(cacheKey);
  }

  deleteGeocodeCache(cacheKey) {
    this.db.prepare('DELETE FROM geocode_cache WHERE cache_key = ?').run(cacheKey);
  }

  deleteListing(listingId, city) {
    this.db.prepare('DELETE FROM listings WHERE listing_id = ? AND city = ?').run(listingId, city);
    this.db.prepare('DELETE FROM price_history WHERE listing_id = ? AND city = ?').run(listingId, city);
  }

  setGeocodeCache(cacheKey, buildingName, streetAddress, rawDisplayName) {
    this.db
      .prepare(
        `INSERT INTO geocode_cache (cache_key, building_name, street_address, raw_display_name, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(cache_key) DO UPDATE SET
           building_name = excluded.building_name,
           street_address = excluded.street_address,
           raw_display_name = excluded.raw_display_name,
           updated_at = excluded.updated_at`
      )
      .run(cacheKey, buildingName || '', streetAddress || '', rawDisplayName || '', new Date().toISOString());
  }

  upsertCitySummary(summary) {
    this.db
      .prepare(
        `INSERT INTO city_runs (
          city, country, raw_count, clean_count, highrise_yes_count, highrise_no_count,
          highrise_pct, total_buildings, qualified_buildings, avg_price_usd, avg_spread_pct,
          verdict, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(city, country) DO UPDATE SET
          raw_count = excluded.raw_count,
          clean_count = excluded.clean_count,
          highrise_yes_count = excluded.highrise_yes_count,
          highrise_no_count = excluded.highrise_no_count,
          highrise_pct = excluded.highrise_pct,
          total_buildings = excluded.total_buildings,
          qualified_buildings = excluded.qualified_buildings,
          avg_price_usd = excluded.avg_price_usd,
          avg_spread_pct = excluded.avg_spread_pct,
          verdict = excluded.verdict,
          updated_at = excluded.updated_at`
      )
      .run(
        summary.city,
        summary.country,
        summary.rawCount || 0,
        summary.cleanCount || 0,
        summary.highRiseYesCount || 0,
        summary.highRiseNoCount || 0,
        summary.highRisePct || 0,
        summary.totalBuildings || 0,
        summary.qualifiedBuildings || 0,
        summary.avgPriceUsd || 0,
        summary.avgSpreadPct || 0,
        summary.verdict || '',
        new Date().toISOString()
      );
  }

  getAllCitySummaries() {
    return this.db.prepare('SELECT * FROM city_runs ORDER BY qualified_buildings DESC, clean_count DESC').all();
  }

  close() {
    this.db.close();
  }
}
