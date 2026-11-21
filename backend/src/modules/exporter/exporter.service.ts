import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { cleanControlChars, formatDateStamp, sanitizeFilename } from '../../common/helpers';
import { HostListingRecord, RoomRecord } from '../../common/types';
import { AppConfigService } from '../../config/app-config.service';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class ExporterService {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly db: DatabaseService,
  ) {}

  private ensureOutputDir(): string {
    const dir = this.appConfig.outputDir;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  private styleHeaderRow(row: ExcelJS.Row, bgHex = 'FF1E293B') {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgHex } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 28;
  }

  private mapDbRowToRoom(row: any): RoomRecord {
    let amenities: string[] = [];
    try {
      amenities = JSON.parse(row.amenities_json || '[]');
    } catch {
      amenities = [];
    }
    const pdpScraped = Number(row.pdp_scraped || 0);
    const status =
      row.collection_status ||
      (pdpScraped === 1 ? 'Dữ liệu có sẵn' : 'Chưa đọc PDP (Dừng sớm)');

    return {
      listing_id: String(row.listing_id || ''),
      location_query: String(row.location_query || ''),
      checkin: String(row.check_in || ''),
      checkout: String(row.check_out || ''),
      nights: Number(row.nights || 1),
      title: String(row.title || ''),
      url: String(row.url || ''),
      subtitle: String(row.room_type || row.property_type || ''),
      guests_text: String(row.guests_text || ''),
      bedrooms_text: String(row.bedrooms_text || ''),
      beds_text: String(row.beds_text || ''),
      bathrooms_text: String(row.bathrooms_text || ''),
      guests: Number(row.max_guests ?? row.guests ?? 0),
      bedrooms: Number(row.bedrooms || 0),
      beds: Number(row.beds || 0),
      bathrooms: Number(row.bathrooms || 0),
      description: String(row.description || ''),
      price_per_night: Number(row.price_per_night || 0),
      total_price: Number(row.total_price || 0),
      price_raw: String(row.price_raw || ''),
      total_price_raw: String(row.total_price_raw || ''),
      currency: String(row.currency || 'VND'),
      rating: Number(row.rating || 0),
      reviews_count: Number(row.reviews_count || 0),
      location_text: String(row.location_text || ''),
      building_name: String(row.building_name || ''),
      is_high_rise: Number(row.is_high_rise || 0),
      collection_status: status as any,
      images_count: Number(row.images_count || 0),
      lat: row.lat !== null && row.lat !== undefined ? Number(row.lat) : null,
      lng: row.lng !== null && row.lng !== undefined ? Number(row.lng) : null,
      amenities,
      host_id: String(row.host_id || ''),
      host_name: String(row.host_name || ''),
      host_url: (() => {
        const rawUrl = String(row.host_url || '').trim();
        const hid =
          rawUrl.match(/\/users\/(?:show|profile)\/(\d+)/i)?.[1] ||
          (/^\d+$/.test(String(row.host_id || '').trim()) ? String(row.host_id).trim() : '');
        return hid ? `https://www.airbnb.com/users/profile/${hid}` : rawUrl;
      })(),
      pdp_scraped: pdpScraped,
    };
  }

  private populateDetailedRoomsSheet(sheet: ExcelJS.Worksheet, rooms: RoomRecord[]) {
    const columns: Partial<ExcelJS.Column>[] = [
      { header: 'ID Phòng', key: 'listing_id', width: 22 },
      { header: 'Tên phòng', key: 'title', width: 40 },
      { header: 'Tòa nhà / Dự án', key: 'building_name', width: 26 },
      { header: 'Chung cư cao tầng', key: 'is_high_rise', width: 16 },
      { header: 'Trạng thái thu thập', key: 'collection_status', width: 24 },
      { header: 'Loại phòng', key: 'subtitle', width: 26 },
      { header: 'Khu vực', key: 'location_text', width: 22 },
      { header: 'Số khách', key: 'guests', width: 11 },
      { header: 'Phòng ngủ', key: 'bedrooms', width: 11 },
      { header: 'Giường', key: 'beds', width: 11 },
      { header: 'Phòng tắm', key: 'bathrooms', width: 11 },
      { header: 'Giá / đêm', key: 'price_per_night', width: 16 },
      { header: 'Tổng giá', key: 'total_price', width: 16 },
      { header: 'Tiền tệ', key: 'currency', width: 10 },
      { header: 'Điểm đánh giá', key: 'rating', width: 14 },
      { header: 'Số đánh giá', key: 'reviews_count', width: 13 },
      { header: 'Tọa độ Lat', key: 'lat', width: 14 },
      { header: 'Tọa độ Lng', key: 'lng', width: 14 },
      { header: 'Tiện nghi', key: 'amenities_text', width: 45 },
      { header: 'Tên Host', key: 'host_name', width: 24 },
      { header: 'Link Host', key: 'host_url', width: 38 },
      { header: 'Link phòng', key: 'url', width: 45 },
    ];

    sheet.columns = columns;
    this.styleHeaderRow(sheet.getRow(1));
    sheet.views = [{ state: 'frozen', ySplit: 1 }];

    for (const r of rooms) {
      const row = sheet.addRow({
        listing_id: cleanControlChars(r.listing_id),
        title: cleanControlChars(r.title),
        building_name: cleanControlChars(r.building_name || 'Chưa xác định'),
        is_high_rise: r.is_high_rise ? 'Có' : 'Không',
        collection_status: r.collection_status || 'Dữ liệu có sẵn',
        subtitle: cleanControlChars(r.subtitle),
        location_text: cleanControlChars(r.location_text || r.location_query),
        guests: Number(r.guests || 0),
        bedrooms: Number(r.bedrooms || 0),
        beds: Number(r.beds || 0),
        bathrooms: Number(r.bathrooms || 0),
        price_per_night: Math.round(Number(r.price_per_night || 0)),
        total_price: Math.round(Number(r.total_price || 0)),
        currency: cleanControlChars(r.currency || 'VND'),
        rating: Number(r.rating || 0),
        reviews_count: Number(r.reviews_count || 0),
        lat: r.lat !== null && r.lat !== undefined ? Number(r.lat) : null,
        lng: r.lng !== null && r.lng !== undefined ? Number(r.lng) : null,
        amenities_text: cleanControlChars((r.amenities || []).join(', ')),
        host_name: cleanControlChars(r.host_name),
        host_url: cleanControlChars(r.host_url),
        url: cleanControlChars(r.url),
      });

      row.getCell('price_per_night').numFmt = '#,##0';
      row.getCell('total_price').numFmt = '#,##0';
      row.getCell('rating').numFmt = '0.00';
      row.getCell('reviews_count').numFmt = '#,##0';
      if (r.lat !== null && r.lat !== undefined) row.getCell('lat').numFmt = '0.000000';
      if (r.lng !== null && r.lng !== undefined) row.getCell('lng').numFmt = '0.000000';
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: columns.length },
    };
  }

  /**
   * 1. Tự động tạo/cập nhật file báo cáo chi tiết 4 Sheets:
   *    Bao_Cao_Tong_Hop_<Ten_Thanh_Pho_Khong_Dau_Gach_Duoi>_<YYYY-MM-DD>.xlsx
   */
  async exportCitySummaryReport(cityName?: string) {
    const dir = this.ensureOutputDir();
    const rooms = this.db.getAllRoomsForCity(cityName).map((r) => this.mapDbRowToRoom(r));
    const outOfTargetRows = this.db.getOutOfTargetHostRooms(cityName).map((r) => this.mapDbRowToRoom(r));

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Airbnb Market Intelligence v3.4.0';

    // Sheet 1: Tong_Quan_Thi_Truong
    const kpiSheet = wb.addWorksheet('Tong_Quan_Thi_Truong');
    kpiSheet.columns = [
      { header: 'Chỉ số thị trường', key: 'metric', width: 38 },
      { header: 'Giá trị', key: 'value', width: 28 },
    ];
    this.styleHeaderRow(kpiSheet.getRow(1), 'FF0F766E');

    const highRiseCount = rooms.filter((r) => r.is_high_rise === 1).length;
    const uniqueHosts = new Set(rooms.map((r) => r.host_id).filter(Boolean)).size;
    const priced = rooms.filter((r) => r.price_per_night > 0);
    const avgPrice =
      priced.length > 0
        ? Math.round(priced.reduce((s, r) => s + r.price_per_night, 0) / priced.length)
        : 0;
    const rated = rooms.filter((r) => (r.rating || 0) > 0);
    const avgRating =
      rated.length > 0
        ? Number((rated.reduce((s, r) => s + (r.rating || 0), 0) / rated.length).toFixed(2))
        : 0;

    kpiSheet.addRow({ metric: 'Thành phố / Khu vực mục tiêu', value: cityName || 'Tất cả' });
    kpiSheet.addRow({ metric: 'Tổng số căn hộ thu thập được', value: rooms.length });
    kpiSheet.addRow({ metric: 'Số căn hộ chung cư cao tầng', value: highRiseCount });
    kpiSheet.addRow({ metric: 'Số chủ nhà (Host) duy nhất', value: uniqueHosts });
    kpiSheet.addRow({ metric: 'Giá trung bình / đêm', value: avgPrice });
    kpiSheet.addRow({ metric: 'Điểm đánh giá trung bình', value: avgRating });
    kpiSheet.addRow({ metric: 'Số căn ngoài vùng của Host', value: outOfTargetRows.length });
    kpiSheet.addRow({ metric: 'Thời gian cập nhật báo cáo', value: new Date().toLocaleString('vi-VN') });

    // Sheet 2: Xep_Hang_Toa_Nha
    const buildingSheet = wb.addWorksheet('Xep_Hang_Toa_Nha');
    buildingSheet.columns = [
      { header: 'Tên tòa nhà / Dự án', key: 'building', width: 34 },
      { header: 'Tổng số căn', key: 'count', width: 15 },
      { header: 'Giá TB / đêm', key: 'avgPrice', width: 18 },
      { header: 'Đánh giá TB', key: 'avgRating', width: 14 },
      { header: 'Số Host vận hành', key: 'hostsCount', width: 18 },
    ];
    this.styleHeaderRow(buildingSheet.getRow(1), 'FF1D4ED8');
    buildingSheet.views = [{ state: 'frozen', ySplit: 1 }];

    const bMap = new Map<
      string,
      { count: number; prices: number[]; ratings: number[]; hosts: Set<string> }
    >();
    for (const r of rooms) {
      const bName = r.building_name?.trim() || 'Chưa xác định tòa nhà';
      if (!bMap.has(bName)) {
        bMap.set(bName, { count: 0, prices: [], ratings: [], hosts: new Set() });
      }
      const entry = bMap.get(bName)!;
      entry.count++;
      if (r.price_per_night > 0) entry.prices.push(r.price_per_night);
      if ((r.rating || 0) > 0) entry.ratings.push(r.rating || 0);
      if (r.host_id) entry.hosts.add(r.host_id);
    }

    const sortedBuildings = Array.from(bMap.entries()).sort((a, b) => b[1].count - a[1].count);
    for (const [building, info] of sortedBuildings) {
      const bAvgPrice =
        info.prices.length > 0
          ? Math.round(info.prices.reduce((a, b) => a + b, 0) / info.prices.length)
          : 0;
      const bAvgRating =
        info.ratings.length > 0
          ? Number((info.ratings.reduce((a, b) => a + b, 0) / info.ratings.length).toFixed(2))
          : 0;
      const row = buildingSheet.addRow({
        building,
        count: info.count,
        avgPrice: bAvgPrice,
        avgRating: bAvgRating,
        hostsCount: info.hosts.size,
      });
      row.getCell('count').numFmt = '#,##0';
      row.getCell('avgPrice').numFmt = '#,##0';
      row.getCell('avgRating').numFmt = '0.00';
      row.getCell('hostsCount').numFmt = '#,##0';
    }

    // Sheet 3: Du_Lieu_Chi_Tiet_Can_Ho
    const detailSheet = wb.addWorksheet('Du_Lieu_Chi_Tiet_Can_Ho');
    this.populateDetailedRoomsSheet(detailSheet, rooms);

    // Sheet 4: Danh_Muc_Host_Ngoai_Khu_Vuc
    const outSheet = wb.addWorksheet('Danh_Muc_Host_Ngoai_Khu_Vuc');
    this.populateDetailedRoomsSheet(outSheet, outOfTargetRows);

    const safeCity = sanitizeFilename(cityName || 'All');
    const dateStamp = formatDateStamp(new Date());
    const fileName = `Bao_Cao_Tong_Hop_${safeCity}_${dateStamp}.xlsx`;
    const filePath = path.join(dir, fileName);
    await wb.xlsx.writeFile(filePath);
    return { filePath, fileName };
  }

  /**
   * 2. Tự động tạo/cập nhật nối tiếp vào ./output/Master_City_Comparison.xlsx
   */
  async exportMasterCityComparison(): Promise<{ filePath: string; fileName: string }> {
    const dir = this.ensureOutputDir();
    const fileName = 'Master_City_Comparison.xlsx';
    const filePath = path.join(dir, fileName);

    // Bảo toàn số liệu thành phố cũ từ file hiện có (nếu có thành phố không còn trong DB)
    const cityRowsMap = new Map<
      string,
      {
        city: string;
        totalRooms: number;
        highRiseRooms: number;
        uniqueHosts: number;
        avgPrice: number;
        avgRating: number;
      }
    >();

    if (fs.existsSync(filePath)) {
      try {
        const existingWb = new ExcelJS.Workbook();
        await existingWb.xlsx.readFile(filePath);
        const existingSheet = existingWb.getWorksheet('So_Sanh_Thanh_Pho');
        existingSheet?.eachRow((row, rowNumber) => {
          if (rowNumber <= 1) return;
          const city = String(row.getCell(1).value || '').trim();
          if (!city) return;
          cityRowsMap.set(city.toLowerCase(), {
            city,
            totalRooms: Number(row.getCell(2).value || 0),
            highRiseRooms: Number(row.getCell(3).value || 0),
            uniqueHosts: Number(row.getCell(4).value || 0),
            avgPrice: Number(row.getCell(5).value || 0),
            avgRating: Number(row.getCell(6).value || 0),
          });
        });
      } catch {
        // Ignore read error on corrupted old file
      }
    }

    // Ghi đè/cập nhật số liệu mới nhất từ SQLite
    const dbCities = this.db.getAllCitiesSummary();
    for (const c of dbCities) {
      cityRowsMap.set(c.city.toLowerCase(), c);
    }

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Airbnb Market Intelligence v3.4.0';

    // Sheet 1: So_Sanh_Thanh_Pho
    const citySheet = wb.addWorksheet('So_Sanh_Thanh_Pho');
    citySheet.columns = [
      { header: 'Thành phố', key: 'city', width: 28 },
      { header: 'Tổng số căn hộ', key: 'totalRooms', width: 18 },
      { header: 'Căn hộ chung cư', key: 'highRiseRooms', width: 18 },
      { header: 'Số Host duy nhất', key: 'uniqueHosts', width: 18 },
      { header: 'Giá TB / đêm', key: 'avgPrice', width: 18 },
      { header: 'Đánh giá TB', key: 'avgRating', width: 14 },
    ];
    this.styleHeaderRow(citySheet.getRow(1), 'FF0F766E');
    for (const c of Array.from(cityRowsMap.values()).sort((a, b) => b.totalRooms - a.totalRooms)) {
      const row = citySheet.addRow(c);
      row.getCell('totalRooms').numFmt = '#,##0';
      row.getCell('highRiseRooms').numFmt = '#,##0';
      row.getCell('uniqueHosts').numFmt = '#,##0';
      row.getCell('avgPrice').numFmt = '#,##0';
      row.getCell('avgRating').numFmt = '0.00';
    }

    // Sheet 2: Top_Toa_Nha_Toan_Quoc
    const allRooms = this.db.getAllRoomsForCity().map((r) => this.mapDbRowToRoom(r));
    const bMap = new Map<string, { city: string; count: number; prices: number[] }>();
    for (const r of allRooms) {
      if (!r.building_name) continue;
      const key = `${r.location_query}__${r.building_name}`;
      if (!bMap.has(key)) {
        bMap.set(key, { city: r.location_query, count: 0, prices: [] });
      }
      const item = bMap.get(key)!;
      item.count++;
      if (r.price_per_night > 0) item.prices.push(r.price_per_night);
    }

    const topBuildingSheet = wb.addWorksheet('Top_Toa_Nha_Toan_Quoc');
    topBuildingSheet.columns = [
      { header: 'Thành phố', key: 'city', width: 24 },
      { header: 'Tên tòa nhà', key: 'building', width: 32 },
      { header: 'Số căn hộ', key: 'count', width: 14 },
      { header: 'Giá TB / đêm', key: 'avgPrice', width: 18 },
    ];
    this.styleHeaderRow(topBuildingSheet.getRow(1), 'FF1D4ED8');
    const sortedTopB = Array.from(bMap.entries())
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 100);
    for (const [key, info] of sortedTopB) {
      const building = key.split('__')[1] || '';
      const avgP =
        info.prices.length > 0
          ? Math.round(info.prices.reduce((a, b) => a + b, 0) / info.prices.length)
          : 0;
      const row = topBuildingSheet.addRow({
        city: info.city,
        building,
        count: info.count,
        avgPrice: avgP,
      });
      row.getCell('count').numFmt = '#,##0';
      row.getCell('avgPrice').numFmt = '#,##0';
    }

    // Sheet 3: Tong_Hop_Host_Lon
    const topHosts = this.db.getTopHostsOverall(100);
    const hostSheet = wb.addWorksheet('Tong_Hop_Host_Lon');
    hostSheet.columns = [
      { header: 'Host ID', key: 'host_id', width: 18 },
      { header: 'Tên Host', key: 'host_name', width: 26 },
      { header: 'Thành phố chính', key: 'city', width: 24 },
      { header: 'Số lượng căn hộ', key: 'rooms_count', width: 18 },
      { header: 'Giá TB / đêm', key: 'avg_price', width: 18 },
    ];
    this.styleHeaderRow(hostSheet.getRow(1), 'FF7C3AED');
    for (const h of topHosts) {
      const row = hostSheet.addRow(h);
      row.getCell('rooms_count').numFmt = '#,##0';
      row.getCell('avg_price').numFmt = '#,##0';
    }

    await wb.xlsx.writeFile(filePath);
    return { filePath, fileName };
  }

  async exportAllReports(cityName?: string) {
    const cityReport = await this.exportCitySummaryReport(cityName);
    const masterReport = await this.exportMasterCityComparison();
    return { cityReport, masterReport };
  }

  async exportHomesExcel(cityName?: string) {
    return this.exportCitySummaryReport(cityName);
  }

  async exportHostRoomsExcel(cityName?: string) {
    const dir = this.ensureOutputDir();
    const rows: HostListingRecord[] = this.db.getAllHostRoomsForCity(cityName).map((r) => ({
      ...this.mapDbRowToRoom(r),
      owner_host_id: String(r.host_id || ''),
      owner_host_name: String(r.host_name || ''),
      is_in_target: Number(r.is_in_target ?? 1),
    }));
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet('Phong_Cua_Host');
    this.populateDetailedRoomsSheet(sheet, rows);
    const safeCity = sanitizeFilename(cityName || 'All');
    const fileName = `${safeCity}_host_rooms.xlsx`;
    const filePath = path.join(dir, fileName);
    await wb.xlsx.writeFile(filePath);
    return { filePath, fileName };
  }
}
