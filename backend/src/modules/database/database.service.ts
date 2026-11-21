import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { haversineMeters, isInvalidBlockedTitle } from '../../common/helpers';
import { HostListingRecord, RoomRecord } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  private db: any;

  constructor(private readonly appConfig: AppConfigService) {}

  onModuleInit() {
    this.ensureOpen();
  }

  onModuleDestroy() {
    this.close();
  }

  private ensureOpen() {
    if (this.db) return;
    const dbPath = this.appConfig.dbPath;
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { DatabaseSync } = require('node:sqlite');
      this.db = new DatabaseSync(dbPath);
      this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
    } catch {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const BetterSqlite3 = require('better-sqlite3');
      this.db = new BetterSqlite3(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
    }
    this.initSchema();
  }

  private addColumnIfMissing(table: string, column: string, definition: string) {
    const cols: any[] = this.db.prepare(`PRAGMA table_info(${table})`).all();
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
    }
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS listings (
        listing_id TEXT PRIMARY KEY,
        location_query TEXT DEFAULT '',
        check_in TEXT DEFAULT '',
        check_out TEXT DEFAULT '',
        nights INTEGER DEFAULT 1,
        title TEXT DEFAULT '',
        url TEXT DEFAULT '',
        room_type TEXT DEFAULT '',
        max_guests INTEGER DEFAULT 0,
        bedrooms INTEGER DEFAULT 0,
        beds INTEGER DEFAULT 0,
        bathrooms REAL DEFAULT 0,
        guests_text TEXT DEFAULT '',
        bedrooms_text TEXT DEFAULT '',
        beds_text TEXT DEFAULT '',
        bathrooms_text TEXT DEFAULT '',
        description TEXT DEFAULT '',
        price_per_night INTEGER DEFAULT 0,
        total_price INTEGER DEFAULT 0,
        price_raw TEXT DEFAULT '',
        total_price_raw TEXT DEFAULT '',
        currency TEXT DEFAULT 'USD',
        images_count INTEGER DEFAULT 0,
        lat REAL,
        lng REAL,
        amenities_json TEXT DEFAULT '[]',
        host_id TEXT DEFAULT '',
        host_name TEXT DEFAULT '',
        host_url TEXT DEFAULT '',
        pdp_scraped INTEGER DEFAULT 1,
        scraped_at TEXT DEFAULT ''
      );

      CREATE INDEX IF NOT EXISTS idx_listings_loc ON listings(location_query);
      CREATE INDEX IF NOT EXISTS idx_listings_host ON listings(host_id);

      CREATE TABLE IF NOT EXISTS host_listings (
        host_id TEXT NOT NULL,
        listing_id TEXT NOT NULL,
        host_name TEXT DEFAULT '',
        location_query TEXT DEFAULT '',
        title TEXT DEFAULT '',
        url TEXT DEFAULT '',
        property_type TEXT DEFAULT '',
        guests_text TEXT DEFAULT '',
        bedrooms_text TEXT DEFAULT '',
        beds_text TEXT DEFAULT '',
        bathrooms_text TEXT DEFAULT '',
        guests INTEGER DEFAULT 0,
        bedrooms INTEGER DEFAULT 0,
        beds INTEGER DEFAULT 0,
        bathrooms REAL DEFAULT 0,
        description TEXT DEFAULT '',
        price_per_night INTEGER DEFAULT 0,
        total_price INTEGER DEFAULT 0,
        price_raw TEXT DEFAULT '',
        total_price_raw TEXT DEFAULT '',
        currency TEXT DEFAULT 'USD',
        images_count INTEGER DEFAULT 0,
        lat REAL,
        lng REAL,
        amenities_json TEXT DEFAULT '[]',
        host_url TEXT DEFAULT '',
        scraped_at TEXT DEFAULT '',
        PRIMARY KEY (host_id, listing_id)
      );
    `);

    // Ensure compatibility with existing DBs from previous versions
    this.addColumnIfMissing('listings', 'guests_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'bedrooms_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'beds_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'bathrooms_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'description', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'price_raw', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'total_price_raw', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'images_count', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('listings', 'rating', 'REAL DEFAULT 0');
    this.addColumnIfMissing('listings', 'reviews_count', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('listings', 'location_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'building_name', "TEXT DEFAULT ''");
    this.addColumnIfMissing('listings', 'is_high_rise', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('listings', 'collection_status', "TEXT DEFAULT ''");

    this.addColumnIfMissing('host_listings', 'location_query', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'guests_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'bedrooms_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'beds_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'bathrooms_text', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'guests', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('host_listings', 'description', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'total_price', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('host_listings', 'price_raw', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'total_price_raw', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'images_count', 'INTEGER DEFAULT 0');
    this.addColumnIfMissing('host_listings', 'lat', 'REAL');
    this.addColumnIfMissing('host_listings', 'lng', 'REAL');
    this.addColumnIfMissing('host_listings', 'amenities_json', "TEXT DEFAULT '[]'");
    this.addColumnIfMissing('host_listings', 'host_url', "TEXT DEFAULT ''");
    this.addColumnIfMissing('host_listings', 'is_in_target', 'INTEGER DEFAULT 1');

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_host_listings_loc ON host_listings(location_query);`);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS building_clusters (
        cluster_id TEXT PRIMARY KEY,
        city_name TEXT DEFAULT '',
        listing_ids_json TEXT DEFAULT '[]',
        center_lat REAL,
        center_lng REAL,
        building_name TEXT DEFAULT '',
        address_note TEXT DEFAULT '',
        updated_at TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS geo_building_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        center_lat REAL NOT NULL,
        center_lng REAL NOT NULL,
        building_name TEXT NOT NULL,
        address_note TEXT DEFAULT '',
        updated_at TEXT DEFAULT ''
      );

      CREATE TABLE IF NOT EXISTS tab2_room_cache (
        listing_id TEXT PRIMARY KEY,
        job_url_hash TEXT DEFAULT '',
        room_json TEXT NOT NULL,
        is_complete INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT ''
      );
    `);
  }

  close() {
    if (this.db) {
      try {
        this.db.close();
      } catch {
        // Ignore
      }
      this.db = null;
    }
  }

  getAllRoomIds(): Set<string> {
    this.ensureOpen();
    const rows: any[] = this.db.prepare(`SELECT listing_id FROM listings`).all();
    return new Set(rows.map((r) => String(r.listing_id)));
  }

  upsertTab2RoomCache(listingId: string, urlHash: string, roomJson: string, isComplete: boolean) {
    this.ensureOpen();
    this.db
      .prepare(
        `
        INSERT INTO tab2_room_cache (listing_id, job_url_hash, room_json, is_complete, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(listing_id) DO UPDATE SET
          job_url_hash = excluded.job_url_hash,
          room_json = excluded.room_json,
          is_complete = excluded.is_complete,
          updated_at = excluded.updated_at
        `,
      )
      .run(listingId, urlHash, roomJson, isComplete ? 1 : 0, new Date().toISOString());
  }

  getTab2CachedRooms(listingIds: string[]): Map<string, { room: any; isComplete: boolean }> {
    this.ensureOpen();
    const out = new Map<string, { room: any; isComplete: boolean }>();
    if (listingIds.length === 0) return out;
    const stmt = this.db.prepare(
      `SELECT listing_id, room_json, is_complete FROM tab2_room_cache WHERE listing_id = ?`,
    );
    for (const id of listingIds) {
      const row: any = stmt.get(id);
      if (row && row.room_json) {
        try {
          const parsedRoom = JSON.parse(row.room_json);
          if (parsedRoom) {
            const rawLink = String(parsedRoom.hostAirbnbLink || '');
            const idMatch =
              rawLink.match(/\/users\/(?:show|profile)\/(\d+)/i)?.[1] ||
              (typeof parsedRoom.hostId === 'string' && /^\d+$/.test(parsedRoom.hostId.trim())
                ? parsedRoom.hostId.trim()
                : '');
            if (idMatch) {
              parsedRoom.hostAirbnbLink = `https://www.airbnb.com/users/show/${idMatch}`;
            }
          }
          out.set(String(row.listing_id), {
            room: parsedRoom,
            isComplete: Number(row.is_complete) === 1,
          });
        } catch {
          // Ignore malformed cache
        }
      }
    }
    return out;
  }

  clearTab2RoomCache(listingIds?: string[]) {
    this.ensureOpen();
    if (listingIds && listingIds.length > 0) {
      const stmt = this.db.prepare(`DELETE FROM tab2_room_cache WHERE listing_id = ?`);
      for (const id of listingIds) {
        stmt.run(id);
      }
      return;
    }
    this.db.exec(`DELETE FROM tab2_room_cache`);
  }

  getCompletedRoomIds(): Set<string> {
    this.ensureOpen();
    const rows: any[] = this.db
      .prepare(
        `
        SELECT listing_id
        FROM listings
        WHERE pdp_scraped = 1
          AND amenities_json IS NOT NULL
          AND amenities_json != '[]'
          AND length(host_name) > 1
        `,
      )
      .all();
    return new Set(rows.map((r) => String(r.listing_id)));
  }

  upsertRoom(room: RoomRecord) {
    this.ensureOpen();
    const validHostName = room.host_name && room.host_name.trim().length > 1 ? room.host_name.trim() : '';
    const safeTitle = isInvalidBlockedTitle(room.title) ? '' : room.title.trim();
    let resolvedBuildingName = (room.building_name || '').trim();
    let resolvedHighRise = room.is_high_rise ? 1 : 0;

    if (!resolvedBuildingName && room.lat !== null && room.lng !== null && room.lat !== 0 && room.lng !== 0) {
      const cached = this.findCachedBuildingByCoords(room.lat, room.lng, 50);
      if (cached) {
        resolvedBuildingName = cached.building_name;
        resolvedHighRise = 1;
      }
    }

    const pdpScrapedFlag = room.pdp_scraped === 0 ? 0 : 1;
    const statusText =
      room.collection_status ||
      (pdpScrapedFlag === 1 ? 'Mới thu thập' : 'Chưa đọc PDP (Dừng sớm)');
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO listings (
          listing_id, location_query, check_in, check_out, nights, title, url, room_type,
          max_guests, bedrooms, beds, bathrooms, guests_text, bedrooms_text, beds_text, bathrooms_text,
          description, price_per_night, total_price, price_raw, total_price_raw, currency,
          rating, reviews_count, location_text, building_name, is_high_rise, collection_status,
          images_count, lat, lng, amenities_json, host_id, host_name, host_url, pdp_scraped, scraped_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(listing_id) DO UPDATE SET
          location_query = CASE WHEN excluded.location_query != '' THEN excluded.location_query ELSE listings.location_query END,
          check_in = CASE WHEN excluded.check_in != '' THEN excluded.check_in ELSE listings.check_in END,
          check_out = CASE WHEN excluded.check_out != '' THEN excluded.check_out ELSE listings.check_out END,
          nights = CASE WHEN excluded.nights > 0 THEN excluded.nights ELSE listings.nights END,
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE listings.title END,
          url = CASE WHEN excluded.url != '' THEN excluded.url ELSE listings.url END,
          room_type = CASE WHEN excluded.room_type != '' THEN excluded.room_type ELSE listings.room_type END,
          max_guests = CASE WHEN excluded.max_guests > 0 THEN excluded.max_guests ELSE listings.max_guests END,
          bedrooms = CASE WHEN excluded.bedrooms > 0 THEN excluded.bedrooms ELSE listings.bedrooms END,
          beds = CASE WHEN excluded.beds > 0 THEN excluded.beds ELSE listings.beds END,
          bathrooms = CASE WHEN excluded.bathrooms > 0 THEN excluded.bathrooms ELSE listings.bathrooms END,
          guests_text = CASE WHEN excluded.guests_text != '' THEN excluded.guests_text ELSE listings.guests_text END,
          bedrooms_text = CASE WHEN excluded.bedrooms_text != '' THEN excluded.bedrooms_text ELSE listings.bedrooms_text END,
          beds_text = CASE WHEN excluded.beds_text != '' THEN excluded.beds_text ELSE listings.beds_text END,
          bathrooms_text = CASE WHEN excluded.bathrooms_text != '' THEN excluded.bathrooms_text ELSE listings.bathrooms_text END,
          description = CASE WHEN excluded.description != '' THEN excluded.description ELSE listings.description END,
          price_per_night = CASE WHEN excluded.price_per_night > 0 THEN excluded.price_per_night ELSE listings.price_per_night END,
          total_price = CASE WHEN excluded.total_price > 0 THEN excluded.total_price ELSE listings.total_price END,
          price_raw = CASE WHEN excluded.price_raw != '' THEN excluded.price_raw ELSE listings.price_raw END,
          total_price_raw = CASE WHEN excluded.total_price_raw != '' THEN excluded.total_price_raw ELSE listings.total_price_raw END,
          currency = CASE WHEN excluded.currency != '' THEN excluded.currency ELSE listings.currency END,
          rating = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE listings.rating END,
          reviews_count = CASE WHEN excluded.reviews_count > 0 THEN excluded.reviews_count ELSE listings.reviews_count END,
          location_text = CASE WHEN excluded.location_text != '' THEN excluded.location_text ELSE listings.location_text END,
          building_name = CASE WHEN excluded.building_name != '' THEN excluded.building_name ELSE listings.building_name END,
          is_high_rise = MAX(COALESCE(listings.is_high_rise, 0), excluded.is_high_rise),
          collection_status = CASE WHEN excluded.pdp_scraped = 1 THEN excluded.collection_status WHEN listings.pdp_scraped = 1 THEN 'Dữ liệu có sẵn' ELSE excluded.collection_status END,
          images_count = CASE WHEN excluded.images_count > 0 THEN excluded.images_count ELSE listings.images_count END,
          lat = COALESCE(excluded.lat, listings.lat),
          lng = COALESCE(excluded.lng, listings.lng),
          amenities_json = CASE WHEN excluded.amenities_json != '[]' THEN excluded.amenities_json ELSE listings.amenities_json END,
          host_id = CASE WHEN excluded.host_id != '' THEN excluded.host_id ELSE listings.host_id END,
          host_name = CASE WHEN length(excluded.host_name) > 1 THEN excluded.host_name ELSE listings.host_name END,
          host_url = CASE WHEN excluded.host_url != '' THEN excluded.host_url ELSE listings.host_url END,
          pdp_scraped = MAX(listings.pdp_scraped, excluded.pdp_scraped),
          scraped_at = excluded.scraped_at
        `,
      )
      .run(
        room.listing_id,
        room.location_query,
        room.checkin,
        room.checkout,
        room.nights,
        safeTitle,
        room.url,
        room.subtitle,
        room.guests,
        room.bedrooms,
        room.beds,
        room.bathrooms,
        room.guests_text,
        room.bedrooms_text,
        room.beds_text,
        room.bathrooms_text,
        room.description,
        Math.round(room.price_per_night || 0),
        Math.round(room.total_price || 0),
        room.price_raw,
        room.total_price_raw,
        room.currency,
        Number(room.rating || 0),
        Math.round(Number(room.reviews_count || 0)),
        room.location_text || '',
        resolvedBuildingName,
        resolvedHighRise,
        statusText,
        room.images_count,
        room.lat,
        room.lng,
        JSON.stringify(room.amenities || []),
        room.host_id,
        validHostName,
        room.host_url,
        pdpScrapedFlag,
        now,
      );
  }

  upsertHostRoom(room: HostListingRecord) {
    this.ensureOpen();
    const validHostName =
      room.owner_host_name && room.owner_host_name.trim().length > 1
        ? room.owner_host_name.trim()
        : room.host_name && room.host_name.trim().length > 1
          ? room.host_name.trim()
          : '';
    const safeTitle = isInvalidBlockedTitle(room.title) ? '' : room.title.trim();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `
        INSERT INTO host_listings (
          host_id, listing_id, host_name, location_query, title, url, property_type,
          guests_text, bedrooms_text, beds_text, bathrooms_text, guests, bedrooms, beds, bathrooms,
          description, price_per_night, total_price, price_raw, total_price_raw, currency,
          images_count, lat, lng, amenities_json, host_url, is_in_target, scraped_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?,
          ?, ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(host_id, listing_id) DO UPDATE SET
          host_name = CASE WHEN length(excluded.host_name) > 1 THEN excluded.host_name ELSE host_listings.host_name END,
          location_query = CASE WHEN excluded.location_query != '' THEN excluded.location_query ELSE host_listings.location_query END,
          title = CASE WHEN excluded.title != '' THEN excluded.title ELSE host_listings.title END,
          url = CASE WHEN excluded.url != '' THEN excluded.url ELSE host_listings.url END,
          property_type = CASE WHEN excluded.property_type != '' THEN excluded.property_type ELSE host_listings.property_type END,
          guests_text = CASE WHEN excluded.guests_text != '' THEN excluded.guests_text ELSE host_listings.guests_text END,
          bedrooms_text = CASE WHEN excluded.bedrooms_text != '' THEN excluded.bedrooms_text ELSE host_listings.bedrooms_text END,
          beds_text = CASE WHEN excluded.beds_text != '' THEN excluded.beds_text ELSE host_listings.beds_text END,
          bathrooms_text = CASE WHEN excluded.bathrooms_text != '' THEN excluded.bathrooms_text ELSE host_listings.bathrooms_text END,
          guests = CASE WHEN excluded.guests > 0 THEN excluded.guests ELSE host_listings.guests END,
          bedrooms = CASE WHEN excluded.bedrooms > 0 THEN excluded.bedrooms ELSE host_listings.bedrooms END,
          beds = CASE WHEN excluded.beds > 0 THEN excluded.beds ELSE host_listings.beds END,
          bathrooms = CASE WHEN excluded.bathrooms > 0 THEN excluded.bathrooms ELSE host_listings.bathrooms END,
          description = CASE WHEN excluded.description != '' THEN excluded.description ELSE host_listings.description END,
          price_per_night = CASE WHEN excluded.price_per_night > 0 THEN excluded.price_per_night ELSE host_listings.price_per_night END,
          total_price = CASE WHEN excluded.total_price > 0 THEN excluded.total_price ELSE host_listings.total_price END,
          price_raw = CASE WHEN excluded.price_raw != '' THEN excluded.price_raw ELSE host_listings.price_raw END,
          total_price_raw = CASE WHEN excluded.total_price_raw != '' THEN excluded.total_price_raw ELSE host_listings.total_price_raw END,
          currency = CASE WHEN excluded.currency != '' THEN excluded.currency ELSE host_listings.currency END,
          images_count = CASE WHEN excluded.images_count > 0 THEN excluded.images_count ELSE host_listings.images_count END,
          lat = COALESCE(excluded.lat, host_listings.lat),
          lng = COALESCE(excluded.lng, host_listings.lng),
          amenities_json = CASE WHEN excluded.amenities_json != '[]' THEN excluded.amenities_json ELSE host_listings.amenities_json END,
          host_url = CASE WHEN excluded.host_url != '' THEN excluded.host_url ELSE host_listings.host_url END,
          is_in_target = excluded.is_in_target,
          scraped_at = excluded.scraped_at
        `,
      )
      .run(
        room.owner_host_id,
        room.listing_id,
        validHostName,
        room.location_query,
        safeTitle,
        room.url,
        room.subtitle,
        room.guests_text,
        room.bedrooms_text,
        room.beds_text,
        room.bathrooms_text,
        room.guests,
        room.bedrooms,
        room.beds,
        room.bathrooms,
        room.description,
        Math.round(room.price_per_night || 0),
        Math.round(room.total_price || 0),
        room.price_raw,
        room.total_price_raw,
        room.currency,
        room.images_count,
        room.lat,
        room.lng,
        JSON.stringify(room.amenities || []),
        room.host_url,
        room.is_in_target === 0 ? 0 : 1,
        now,
      );
  }

  getRooms(params: { locationQuery?: string; search?: string; page?: number; limit?: number }) {
    this.ensureOpen();
    const { locationQuery, search, page = 1, limit = 50 } = params;
    const where: string[] = [];
    const args: any[] = [];

    if (locationQuery) {
      where.push('LOWER(location_query) LIKE ?');
      args.push(`%${locationQuery.toLowerCase()}%`);
    }
    if (search) {
      where.push('(LOWER(title) LIKE ? OR LOWER(host_name) LIKE ? OR LOWER(room_type) LIKE ? OR LOWER(building_name) LIKE ? OR listing_id LIKE ?)');
      const q = `%${search.toLowerCase()}%`;
      args.push(q, q, q, q, q);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const countRow = this.db
      .prepare(`SELECT COUNT(*) as total FROM listings ${whereSql}`)
      .get(...args);

    const offset = Math.max(0, (page - 1) * limit);
    const items = this.db
      .prepare(
        `
        SELECT
          listing_id, location_query, check_in, check_out, nights, title, url,
          room_type, max_guests, bedrooms, beds, bathrooms,
          guests_text, bedrooms_text, beds_text, bathrooms_text,
          description, price_per_night, total_price, price_raw, total_price_raw,
          currency, images_count, lat, lng, amenities_json,
          building_name, is_high_rise,
          host_id, host_name, host_url, scraped_at
        FROM listings
        ${whereSql}
        ORDER BY scraped_at DESC
        LIMIT ? OFFSET ?
        `,
      )
      .all(...args, limit, offset);

    const statsRow = this.db
      .prepare(
        `
        SELECT
          COUNT(*) as totalRooms,
          COUNT(DISTINCT CASE WHEN host_id != '' THEN host_id END) as uniqueHosts,
          ROUND(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) as avgPrice
        FROM listings
        ${whereSql}
        `,
      )
      .get(...args);

    const hostRoomsRow = this.db
      .prepare(`SELECT COUNT(*) as totalHostRooms FROM host_listings`)
      .get();

    return {
      items,
      total: Number(countRow?.total || 0),
      page,
      limit,
      stats: {
        totalRooms: Number(statsRow?.totalRooms || 0),
        uniqueHosts: Number(statsRow?.uniqueHosts || 0),
        avgPrice: Number(statsRow?.avgPrice || 0),
        totalHostRooms: Number(hostRoomsRow?.totalHostRooms || 0),
      },
    };
  }

  getRoomCountForCity(locationQuery?: string): number {
    this.ensureOpen();
    if (locationQuery) {
      const row = this.db
        .prepare(`SELECT COUNT(*) as cnt FROM listings WHERE LOWER(location_query) LIKE ?`)
        .get(`%${locationQuery.toLowerCase()}%`);
      return Number(row?.cnt || 0);
    }
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM listings`).get();
    return Number(row?.cnt || 0);
  }

  getAllRoomsForCity(locationQuery?: string): any[] {
    this.ensureOpen();
    if (locationQuery) {
      return this.db
        .prepare(`SELECT * FROM listings WHERE LOWER(location_query) LIKE ? ORDER BY scraped_at DESC`)
        .all(`%${locationQuery.toLowerCase()}%`);
    }
    return this.db.prepare(`SELECT * FROM listings ORDER BY scraped_at DESC`).all();
  }

  getAllHostRoomsForCity(locationQuery?: string): any[] {
    this.ensureOpen();
    if (locationQuery) {
      return this.db
        .prepare(`SELECT * FROM host_listings WHERE LOWER(location_query) LIKE ? ORDER BY host_id, scraped_at DESC`)
        .all(`%${locationQuery.toLowerCase()}%`);
    }
    return this.db.prepare(`SELECT * FROM host_listings ORDER BY host_id, scraped_at DESC`).all();
  }

  getOutOfTargetHostRooms(locationQuery?: string): any[] {
    this.ensureOpen();
    if (locationQuery) {
      return this.db
        .prepare(
          `SELECT * FROM host_listings WHERE LOWER(location_query) LIKE ? AND is_in_target = 0 ORDER BY host_id, scraped_at DESC`,
        )
        .all(`%${locationQuery.toLowerCase()}%`);
    }
    return this.db
      .prepare(`SELECT * FROM host_listings WHERE is_in_target = 0 ORDER BY host_id, scraped_at DESC`)
      .all();
  }

  getAllCitiesSummary(): Array<{
    city: string;
    totalRooms: number;
    highRiseRooms: number;
    uniqueHosts: number;
    avgPrice: number;
    avgRating: number;
  }> {
    this.ensureOpen();
    return this.db
      .prepare(
        `
        SELECT
          CASE WHEN location_query != '' THEN location_query ELSE 'Khac' END as city,
          COUNT(*) as totalRooms,
          SUM(CASE WHEN is_high_rise = 1 THEN 1 ELSE 0 END) as highRiseRooms,
          COUNT(DISTINCT CASE WHEN host_id != '' THEN host_id END) as uniqueHosts,
          ROUND(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) as avgPrice,
          ROUND(AVG(CASE WHEN rating > 0 THEN rating END), 2) as avgRating
        FROM listings
        GROUP BY city
        ORDER BY totalRooms DESC
        `,
      )
      .all()
      .map((r: any) => ({
        city: String(r.city || ''),
        totalRooms: Number(r.totalRooms || 0),
        highRiseRooms: Number(r.highRiseRooms || 0),
        uniqueHosts: Number(r.uniqueHosts || 0),
        avgPrice: Number(r.avgPrice || 0),
        avgRating: Number(r.avgRating || 0),
      }));
  }

  getTopHostsOverall(limit = 50): Array<{
    host_id: string;
    host_name: string;
    city: string;
    rooms_count: number;
    avg_price: number;
  }> {
    this.ensureOpen();
    return this.db
      .prepare(
        `
        SELECT
          host_id,
          MAX(host_name) as host_name,
          MAX(location_query) as city,
          COUNT(*) as rooms_count,
          ROUND(AVG(CASE WHEN price_per_night > 0 THEN price_per_night END), 0) as avg_price
        FROM listings
        WHERE host_id != ''
        GROUP BY host_id
        ORDER BY rooms_count DESC
        LIMIT ?
        `,
      )
      .all(limit)
      .map((r: any) => ({
        host_id: String(r.host_id || ''),
        host_name: String(r.host_name || ''),
        city: String(r.city || ''),
        rooms_count: Number(r.rooms_count || 0),
        avg_price: Number(r.avg_price || 0),
      }));
  }

  // ===========================================================================
  // SPATIAL CLUSTERING & GEO BUILDING CACHE (GEMINI WORKFLOW)
  // ===========================================================================

  getRoomsWithValidCoords(cityName?: string): any[] {
    this.ensureOpen();
    if (cityName && cityName.trim()) {
      return this.db
        .prepare(
          `
          SELECT listing_id, location_query, location_text, title, building_name, lat, lng
          FROM listings
          WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0
            AND LOWER(location_query) LIKE ?
          ORDER BY scraped_at DESC
          `,
        )
        .all(`%${cityName.trim().toLowerCase()}%`);
    }
    return this.db
      .prepare(
        `
        SELECT listing_id, location_query, location_text, title, building_name, lat, lng
        FROM listings
        WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0
        ORDER BY scraped_at DESC
        `,
      )
      .all();
  }

  countBuildingClusters(cityName?: string): number {
    this.ensureOpen();
    if (cityName && cityName.trim()) {
      const row: any = this.db
        .prepare(`SELECT COUNT(*) AS cnt FROM building_clusters WHERE LOWER(city_name) = ?`)
        .get(cityName.trim().toLowerCase());
      return Number(row?.cnt || 0);
    }
    const row: any = this.db.prepare(`SELECT COUNT(*) AS cnt FROM building_clusters`).get();
    return Number(row?.cnt || 0);
  }

  replaceBuildingClusters(
    cityName: string,
    clusters: Array<{
      cluster_id: string;
      listing_ids: string[];
      center_lat: number;
      center_lng: number;
      building_name?: string;
      address_note?: string;
    }>,
  ) {
    this.ensureOpen();
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO building_clusters (
        cluster_id, city_name, listing_ids_json, center_lat, center_lng, building_name, address_note, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cluster_id) DO UPDATE SET
        city_name = excluded.city_name,
        listing_ids_json = excluded.listing_ids_json,
        center_lat = excluded.center_lat,
        center_lng = excluded.center_lng,
        building_name = CASE WHEN excluded.building_name != '' THEN excluded.building_name ELSE building_clusters.building_name END,
        address_note = CASE WHEN excluded.address_note != '' THEN excluded.address_note ELSE building_clusters.address_note END,
        updated_at = excluded.updated_at
    `);

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const c of clusters) {
        stmt.run(
          c.cluster_id,
          cityName,
          JSON.stringify(c.listing_ids),
          c.center_lat,
          c.center_lng,
          c.building_name || '',
          c.address_note || '',
          now,
        );
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  findCachedBuildingByCoords(
    lat: number,
    lng: number,
    radiusMeters = 50,
  ): { building_name: string; address_note: string } | null {
    this.ensureOpen();
    const rows: any[] = this.db
      .prepare(`SELECT center_lat, center_lng, building_name, address_note FROM geo_building_cache`)
      .all();
    let best: { building_name: string; address_note: string; dist: number } | null = null;
    for (const row of rows) {
      const dist = haversineMeters(lat, lng, Number(row.center_lat), Number(row.center_lng));
      if (dist <= radiusMeters && (!best || dist < best.dist)) {
        best = {
          building_name: String(row.building_name || ''),
          address_note: String(row.address_note || ''),
          dist,
        };
      }
    }
    return best ? { building_name: best.building_name, address_note: best.address_note } : null;
  }

  upsertGeoBuildingCache(
    centerLat: number,
    centerLng: number,
    buildingName: string,
    addressNote = '',
  ) {
    this.ensureOpen();
    const now = new Date().toISOString();
    const rows: any[] = this.db
      .prepare(`SELECT id, center_lat, center_lng FROM geo_building_cache`)
      .all();
    for (const row of rows) {
      const dist = haversineMeters(centerLat, centerLng, Number(row.center_lat), Number(row.center_lng));
      if (dist <= 50) {
        this.db
          .prepare(
            `UPDATE geo_building_cache SET building_name = ?, address_note = ?, updated_at = ? WHERE id = ?`,
          )
          .run(buildingName, addressNote, now, row.id);
        return;
      }
    }
    this.db
      .prepare(
        `INSERT INTO geo_building_cache (center_lat, center_lng, building_name, address_note, updated_at) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(centerLat, centerLng, buildingName, addressNote, now);
  }

  applyBuildingNameToCluster(params: {
    clusterId: string;
    buildingName: string;
    addressNote?: string;
    centerLat?: number | null;
    centerLng?: number | null;
    radiusMeters?: number;
  }): number {
    this.ensureOpen();
    const { clusterId, buildingName, addressNote = '', centerLat, centerLng, radiusMeters = 50 } = params;
    const targetIds = new Set<string>();

    const clusterRow: any = this.db
      .prepare(`SELECT listing_ids_json, center_lat, center_lng FROM building_clusters WHERE cluster_id = ?`)
      .get(clusterId);

    let resolvedLat = centerLat ?? null;
    let resolvedLng = centerLng ?? null;

    if (clusterRow) {
      try {
        const ids = JSON.parse(clusterRow.listing_ids_json || '[]');
        if (Array.isArray(ids)) {
          for (const id of ids) targetIds.add(String(id));
        }
      } catch {
        // Ignore
      }
      if (resolvedLat === null && clusterRow.center_lat != null) resolvedLat = Number(clusterRow.center_lat);
      if (resolvedLng === null && clusterRow.center_lng != null) resolvedLng = Number(clusterRow.center_lng);
    }

    // Quét bổ sung các căn nằm trong bán kính 50m quanh (Center_Lat, Center_Lng)
    if (resolvedLat !== null && resolvedLng !== null && !Number.isNaN(resolvedLat) && !Number.isNaN(resolvedLng)) {
      const coordRows: any[] = this.db
        .prepare(
          `SELECT listing_id, lat, lng FROM listings WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0`,
        )
        .all();
      for (const r of coordRows) {
        if (haversineMeters(resolvedLat, resolvedLng, Number(r.lat), Number(r.lng)) <= radiusMeters) {
          targetIds.add(String(r.listing_id));
        }
      }
      this.upsertGeoBuildingCache(resolvedLat, resolvedLng, buildingName, addressNote);
    }

    let updatedCount = 0;
    if (targetIds.size > 0) {
      const updateStmt = this.db.prepare(
        `UPDATE listings SET building_name = ?, is_high_rise = 1 WHERE listing_id = ?`,
      );
      this.db.exec('BEGIN TRANSACTION');
      try {
        for (const id of targetIds) {
          const info = updateStmt.run(buildingName, id);
          updatedCount += Number(info?.changes || 0);
        }
        this.db.exec('COMMIT');
      } catch (err) {
        this.db.exec('ROLLBACK');
        throw err;
      }
    }

    if (clusterRow) {
      this.db
        .prepare(
          `UPDATE building_clusters SET building_name = ?, address_note = ?, updated_at = ? WHERE cluster_id = ?`,
        )
        .run(buildingName, addressNote, new Date().toISOString(), clusterId);
    }

    return updatedCount;
  }
}
