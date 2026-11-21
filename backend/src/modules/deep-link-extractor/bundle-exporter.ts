import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';
import { formatDateStamp, haversineMeters, sanitizeFilename } from '../../common/helpers';
import {
  DeepExtractedRoom,
  SevenNightsBuildingRow,
  SevenNightsHostRow,
  SevenNightsPreviewData,
  SevenNightsRoomRow,
} from './types';
import { normalizeHostProfileUrl } from './url-parser';
import { createZipFromDirectory } from './zip-utils';

const HANGUL_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];
const HANGUL_MEDIALS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const HANGUL_FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
];

function romanizeHangul(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.charCodeAt(0);
    if (code >= 0xac00 && code <= 0xd7a3) {
      const sIndex = code - 0xac00;
      const l = Math.floor(sIndex / (21 * 28));
      const v = Math.floor((sIndex % (21 * 28)) / 28);
      const t = sIndex % 28;
      out += HANGUL_INITIALS[l] + HANGUL_MEDIALS[v] + HANGUL_FINALS[t];
    } else {
      out += ch;
    }
  }
  return out;
}

function toSlug(text: string, fallback = 'item'): string {
  const romanized = romanizeHangul(text || '');
  const ascii = romanized
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || fallback;
}

function formatDateTimeStamp(date: Date): string {
  const d = formatDateStamp(date);
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d}_${hh}-${mm}`;
}

function styleHeader(row: ExcelJS.Row, argb = 'FF0F766E') {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  row.height = 26;
}

/**
 * Chuyển danh sách phòng đã trích xuất thành cấu trúc 3 sheet chuẩn 7Nights Global.xlsx.
 */
export function buildSevenNightsPreview(
  extractedRooms: DeepExtractedRoom[],
  defaultCity = 'Seoul',
  photoPathPrefix = '',
): SevenNightsPreviewData {
  const citySlugUpper = toSlug(defaultCity, 'CITY').toUpperCase().replace(/-/g, '');
  const buildingGroups: Array<{
    code: string;
    name: string;
    lat: number | null;
    lng: number | null;
    rooms: DeepExtractedRoom[];
    roomCodes: string[];
  }> = [];

  const hostGroups = new Map<
    string,
    {
      code: string;
      name: string;
      country: string;
      link: string;
      rooms: DeepExtractedRoom[];
      roomCodes: string[];
      supplierCodes: string[];
    }
  >();

  const roomRows: SevenNightsRoomRow[] = [];
  const buildingCodeCounters = new Map<string, number>();
  const hostCodeCounters = new Map<string, number>();

  const nextUniqueCode = (baseSlug: string, counterMap: Map<string, number>): string => {
    const count = (counterMap.get(baseSlug) || 0) + 1;
    counterMap.set(baseSlug, count);
    return `${baseSlug}-${String(count).padStart(3, '0')}`;
  };

  // Sắp xếp cố định theo Airbnb Listing ID tăng dần để mọi máy tính xuất ra mã phòng & thứ tự giống nhau 100%
  const sortedRooms = [...extractedRooms].sort((a, b) =>
    a.listingId.localeCompare(b.listingId),
  );

  sortedRooms.forEach((room, idx) => {
    const roomCode = `${citySlugUpper}-ROOM-${String(idx + 1).padStart(3, '0')}`;
    const city = room.city || defaultCity;
    const country = room.country || (city.toLowerCase().includes('seoul') ? 'South Korea' : '');
    const bName = (room.buildingName || '').trim() || `${room.district || city} Residence`;

    // Gom nhóm Building theo tên tòa nhà chuẩn hoặc khoảng cách <= 50m
    let bGroup = buildingGroups.find((g) => {
      if (room.buildingName && g.name.toLowerCase() === bName.toLowerCase()) return true;
      if (
        g.lat !== null &&
        g.lng !== null &&
        room.lat !== null &&
        room.lng !== null &&
        haversineMeters(g.lat, g.lng, room.lat, room.lng) <= 50
      ) {
        return true;
      }
      return false;
    });

    if (!bGroup) {
      const bSlug = toSlug(`${bName}-${city}`, `${toSlug(city)}-bldg`);
      const bCode = nextUniqueCode(bSlug, buildingCodeCounters);
      bGroup = {
        code: bCode,
        name: bName,
        lat: room.lat,
        lng: room.lng,
        rooms: [],
        roomCodes: [],
      };
      buildingGroups.push(bGroup);
    }
    bGroup.rooms.push(room);
    bGroup.roomCodes.push(roomCode);

    // Gom nhóm Host
    const hostKey = room.hostId || `name:${(room.hostName || 'unknown').toLowerCase()}`;
    let hGroup = hostGroups.get(hostKey);
    if (!hGroup) {
      const hSlug = toSlug(room.hostName || `host-${room.hostId || idx + 1}`, 'host');
      const hCode = nextUniqueCode(hSlug, hostCodeCounters);
      hGroup = {
        code: hCode,
        name: room.hostName || 'Unknown Host',
        country,
        link: normalizeHostProfileUrl(room.hostAirbnbLink, 'https://www.airbnb.com', room.hostId),
        rooms: [],
        roomCodes: [],
        supplierCodes: [],
      };
      hostGroups.set(hostKey, hGroup);
    }
    hGroup.rooms.push(room);
    hGroup.roomCodes.push(roomCode);
    if (room.supplierApartmentCode) {
      hGroup.supplierCodes.push(room.supplierApartmentCode);
    }

    const photoValue = photoPathPrefix
      ? `Photos/${roomCode}/`
      : room.localPhotoDir || room.photoUrls.slice(0, 8).join(', ');

    roomRows.push({
      'Room code': roomCode,
      'Airbnb Room ID': room.listingId,
      'Room URL': `https://www.airbnb.com/rooms/${room.listingId}`,
      'building name': bGroup.name,
      'Building code': bGroup.code,
      'Host name': hGroup.name,
      'Host code': hGroup.code,
      'Room type': room.roomType,
      city,
      'air conditioner': room.amenityFlags.airConditioner,
      'hair dryer': room.amenityFlags.hairDryer,
      'shampoo/body wash': room.amenityFlags.shampooBodyWash,
      towel: room.amenityFlags.towel,
      TV: room.amenityFlags.tv,
      WIFI: room.amenityFlags.wifi,
      'washing machine': room.amenityFlags.washingMachine,
      kitchen: room.amenityFlags.kitchen,
      'basic cooking staff': room.amenityFlags.basicCookingStaff,
      'HOW MANY BED': room.beds,
      'Child policy': room.childPolicy,
      'how many room': room.bedrooms,
      'how many toilet': room.bathrooms,
      'max people': room.maxPeople,
      'check in time': room.checkInTime,
      'check out time': room.checkOutTime,
      Photo: photoValue,
    });
  });

  const buildings: SevenNightsBuildingRow[] = buildingGroups.map((g) => {
    const first = g.rooms[0];
    const lat = g.lat ?? first?.lat;
    const lng = g.lng ?? first?.lng;

    const poolVal =
      g.rooms.map((r) => r.amenityFlags.swimmingPool).find((v) => v.startsWith('YES')) || 'NO';
    const gymVal = g.rooms.map((r) => r.amenityFlags.gym).find((v) => v.startsWith('YES')) || 'NO';
    const gymFeeVal =
      g.rooms.map((r) => r.amenityFlags.gymFee).find((v) => v === 'Have to pay' || v === 'Free') ||
      (gymVal.startsWith('YES') ? 'Check with host' : '');
    const parkingVal =
      g.rooms.map((r) => r.amenityFlags.parking).find((v) => v.startsWith('yes')) || 'NO';

    const address =
      g.rooms.map((r) => r.address).find((a) => a && a.length > 5) ||
      `${first?.district || ''} ${first?.city || defaultCity}`.trim();

    const cleanBNameForLink = g.name.replace(/\([^)]*\)/g, '').trim();
    const searchQuery = [cleanBNameForLink, address, first?.district, first?.city || defaultCity]
      .filter(Boolean)
      .join(' ')
      .trim();
    const googleLink = searchQuery
      ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchQuery)}`
      : lat !== null && lng !== null && lat !== undefined && lng !== undefined
        ? `https://www.google.com/maps?q=${lat},${lng}`
        : '';

    return {
      'Building Code': g.code,
      'Building Name': g.name,
      Address: address,
      'google link': googleLink,
      district: first?.district || '',
      city: first?.city || defaultCity,
      country: first?.country || '',
      'swimming pool': poolVal,
      gym: gymVal,
      'gym fee': gymFeeVal,
      parking: parkingVal,
      'ROOM INFOR': g.roomCodes.join(', '),
    };
  });

  const hosts: SevenNightsHostRow[] = Array.from(hostGroups.values()).map((h) => ({
    'Host code': h.code,
    'host name': h.name,
    country: h.country,
    'host phone number': '',
    'bank name': '',
    'account number': '',
    'account name': '',
    'host airbnb link': normalizeHostProfileUrl(h.link, 'https://www.airbnb.com', h.rooms[0]?.hostId),
    'supplier apartment code': Array.from(new Set(h.supplierCodes)).join(', '),
    'ROOM INFOR': h.roomCodes.join(', '),
  }));

  return { buildings, hosts, rooms: roomRows };
}

async function downloadSinglePhoto(
  url: string,
  destPath: string,
  maxRetries = 2,
): Promise<boolean> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 14000);
      const resp = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          Referer: 'https://www.airbnb.com/',
          Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        },
      });
      clearTimeout(timer);
      if (!resp.ok) continue;
      const arrayBuf = await resp.arrayBuffer();
      if (arrayBuf.byteLength < 500) continue;
      fs.writeFileSync(destPath, Buffer.from(arrayBuf));
      return true;
    } catch {
      // Retry
    }
  }
  return false;
}

export async function exportSevenNightsBundle(params: {
  outputDir: string;
  locationLabel: string;
  rooms: DeepExtractedRoom[];
  downloadPhotos: boolean;
  onLog?: (msg: string, level?: 'info' | 'success' | 'warn' | 'error' | 'step') => void;
}): Promise<{
  bundleName: string;
  bundleDir: string;
  sevenNightsExcelFile: string;
  rawExcelFile: string;
  rawJsonFile: string;
  zipFileName: string;
  totalPhotosDownloaded: number;
  preview: SevenNightsPreviewData;
}> {
  const { outputDir, locationLabel, rooms, downloadPhotos, onLog } = params;
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const now = new Date();
  const dateStamp = formatDateStamp(now);
  const dateTimeStamp = formatDateTimeStamp(now);

  // Sắp xếp cố định theo listingId trước khi tải ảnh & xuất Excel
  const sortedRooms = [...rooms].sort((a, b) => a.listingId.localeCompare(b.listingId));

  const prePreview = buildSevenNightsPreview(
    sortedRooms,
    locationLabel,
    downloadPhotos ? 'Photos' : '',
  );

  // Lấy tên tòa nhà chính (nhiều căn nhất hoặc tòa nhà đầu tiên) để đặt tên thư mục & file Excel
  let primaryBuildingRaw = locationLabel || 'Airbnb';
  if (prePreview.buildings.length > 0) {
    const sortedBuildings = [...prePreview.buildings].sort(
      (a, b) =>
        (b['ROOM INFOR'] ? b['ROOM INFOR'].split(',').length : 0) -
        (a['ROOM INFOR'] ? a['ROOM INFOR'].split(',').length : 0),
    );
    primaryBuildingRaw = sortedBuildings[0]['Building Name'] || primaryBuildingRaw;
  }
  const safeBuildingBase = sanitizeFilename(primaryBuildingRaw).replace(/_+/g, '_');
  const buildingLabel =
    prePreview.buildings.length > 1
      ? `${safeBuildingBase}_va_${prePreview.buildings.length - 1}_Toa_Khac`
      : safeBuildingBase;

  const bundleName = `7Nights_Global_${buildingLabel}_${dateTimeStamp}`;
  const bundleDir = path.join(outputDir, bundleName);
  fs.mkdirSync(bundleDir, { recursive: true });

  const preview = prePreview;

  let totalPhotosDownloaded = 0;
  if (downloadPhotos && sortedRooms.length > 0) {
    const photosRoot = path.join(bundleDir, 'Photos');
    fs.mkdirSync(photosRoot, { recursive: true });
    onLog?.(`[Photos] Đang tải 100% ảnh chất lượng cao cho ${sortedRooms.length} căn hộ...`, 'step');

    for (let i = 0; i < sortedRooms.length; i++) {
      const room = sortedRooms[i];
      const roomCode = preview.rooms[i]?.['Room code'] || `ROOM-${i + 1}`;
      const roomPhotoDir = path.join(photosRoot, roomCode);
      fs.mkdirSync(roomPhotoDir, { recursive: true });

      const urls = room.photoUrls;
      const concurrency = 4;
      let cursor = 0;
      let roomPhotoCount = 0;
      const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
        while (cursor < urls.length) {
          const idx = cursor++;
          const photoUrl = urls[idx];
          const ext = /\.webp/i.test(photoUrl) ? 'webp' : 'jpg';
          const dest = path.join(roomPhotoDir, `${String(idx + 1).padStart(2, '0')}.${ext}`);
          const ok = await downloadSinglePhoto(photoUrl, dest, 2);
          if (ok) {
            totalPhotosDownloaded++;
            roomPhotoCount++;
          }
        }
      });
      await Promise.all(workers);
      room.localPhotoDir =
        roomPhotoCount > 0 ? `Photos/${roomCode}/ (${roomPhotoCount} photos)` : `Photos/${roomCode}/`;
      if (preview.rooms[i]) {
        preview.rooms[i].Photo = room.localPhotoDir;
      }
      onLog?.(
        `[Photos] ${roomCode} (#${room.listingId}): Đã tải ${roomPhotoCount}/${urls.length} ảnh vào Photos/${roomCode}/.`,
        roomPhotoCount > 0 ? 'success' : 'warn',
      );
    }
    onLog?.(`[Photos] Đã tải xong ${totalPhotosDownloaded} ảnh vào thư mục Photos/.`, 'success');
  }

  // 1. Tạo file Excel chuẩn 3 sheet: 7Nights_Global_<Building_Name>_<YYYY-MM-DD>.xlsx
  const sevenNightsExcelFile = `7Nights_Global_${buildingLabel}_${dateStamp}.xlsx`;
  const sevenNightsWb = new ExcelJS.Workbook();
  sevenNightsWb.creator = '7Nights Global Deep Extractor v4.0.0';

  const bSheet = sevenNightsWb.addWorksheet('Building Infor');
  bSheet.columns = [
    { header: 'Building Code', key: 'Building Code', width: 28 },
    { header: 'Building Name', key: 'Building Name', width: 32 },
    { header: 'Address', key: 'Address', width: 45 },
    { header: 'google link', key: 'google link', width: 42 },
    { header: 'district', key: 'district', width: 20 },
    { header: 'city', key: 'city', width: 16 },
    { header: 'country', key: 'country', width: 16 },
    { header: 'swimming pool', key: 'swimming pool', width: 18 },
    { header: 'gym', key: 'gym', width: 18 },
    { header: 'gym fee', key: 'gym fee', width: 14 },
    { header: 'parking', key: 'parking', width: 22 },
    { header: 'ROOM INFOR', key: 'ROOM INFOR', width: 40 },
  ];
  styleHeader(bSheet.getRow(1), 'FF0F766E');
  bSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of preview.buildings) {
    const r = bSheet.addRow(row);
    if (row['google link']) {
      r.getCell('google link').value = { text: row['google link'], hyperlink: row['google link'] };
    }
  }

  const hSheet = sevenNightsWb.addWorksheet('Host Infor');
  hSheet.columns = [
    { header: 'Host code', key: 'Host code', width: 26 },
    { header: 'host name', key: 'host name', width: 26 },
    { header: 'country', key: 'country', width: 16 },
    { header: 'host phone number', key: 'host phone number', width: 18 },
    { header: 'bank name', key: 'bank name', width: 18 },
    { header: 'account number', key: 'account number', width: 20 },
    { header: 'account name', key: 'account name', width: 22 },
    { header: 'host airbnb link', key: 'host airbnb link', width: 42 },
    { header: 'supplier apartment code', key: 'supplier apartment code', width: 22 },
    { header: 'ROOM INFOR', key: 'ROOM INFOR', width: 40 },
  ];
  styleHeader(hSheet.getRow(1), 'FF1D4ED8');
  hSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of preview.hosts) {
    const r = hSheet.addRow(row);
    if (row['host airbnb link']) {
      r.getCell('host airbnb link').value = {
        text: row['host airbnb link'],
        hyperlink: row['host airbnb link'],
      };
    }
  }

  const rSheet = sevenNightsWb.addWorksheet('ROOM INFOR');
  rSheet.columns = [
    { header: 'Room code', key: 'Room code', width: 22 },
    { header: 'Airbnb Room ID', key: 'Airbnb Room ID', width: 22 },
    { header: 'Room URL', key: 'Room URL', width: 42 },
    { header: 'building name', key: 'building name', width: 30 },
    { header: 'Building code', key: 'Building code', width: 26 },
    { header: 'Host name', key: 'Host name', width: 24 },
    { header: 'Host code', key: 'Host code', width: 24 },
    { header: 'Room type', key: 'Room type', width: 12 },
    { header: 'city', key: 'city', width: 14 },
    { header: 'air conditioner', key: 'air conditioner', width: 15 },
    { header: 'hair dryer', key: 'hair dryer', width: 12 },
    { header: 'shampoo/body wash', key: 'shampoo/body wash', width: 18 },
    { header: 'towel', key: 'towel', width: 10 },
    { header: 'TV', key: 'TV', width: 10 },
    { header: 'WIFI', key: 'WIFI', width: 10 },
    { header: 'washing machine', key: 'washing machine', width: 16 },
    { header: 'kitchen', key: 'kitchen', width: 12 },
    { header: 'basic cooking staff', key: 'basic cooking staff', width: 18 },
    { header: 'HOW MANY BED', key: 'HOW MANY BED', width: 14 },
    { header: 'Child policy', key: 'Child policy', width: 28 },
    { header: 'how many room', key: 'how many room', width: 14 },
    { header: 'how many toilet', key: 'how many toilet', width: 14 },
    { header: 'max people', key: 'max people', width: 12 },
    { header: 'check in time', key: 'check in time', width: 18 },
    { header: 'check out time', key: 'check out time', width: 18 },
    { header: 'Photo', key: 'Photo', width: 32 },
  ];
  styleHeader(rSheet.getRow(1), 'FF334155');
  rSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const row of preview.rooms) {
    rSheet.addRow(row);
  }

  await sevenNightsWb.xlsx.writeFile(path.join(bundleDir, sevenNightsExcelFile));

  // 2. Tạo file Full_Raw_Data_<Building_Name>.xlsx & Full_Raw_Data.json
  const rawExcelFile = `Full_Raw_Data_${buildingLabel}.xlsx`;
  const rawJsonFile = 'Full_Raw_Data.json';
  const rawWb = new ExcelJS.Workbook();
  const rawSheet = rawWb.addWorksheet('Raw_Data');
  rawSheet.columns = [
    { header: 'Listing ID', key: 'listingId', width: 18 },
    { header: 'Title', key: 'title', width: 42 },
    { header: 'Bounds Status', key: 'boundsLabel', width: 22 },
    { header: 'Building Name', key: 'buildingName', width: 28 },
    { header: 'Address', key: 'address', width: 40 },
    { header: 'District', key: 'district', width: 18 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'Lat', key: 'lat', width: 14 },
    { header: 'Lng', key: 'lng', width: 14 },
    { header: 'Price / Night', key: 'pricePerNight', width: 15 },
    { header: 'Total Price', key: 'totalPrice', width: 15 },
    { header: 'Cleaning Fee', key: 'cleaningFee', width: 14 },
    { header: 'Service Fee', key: 'serviceFee', width: 14 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Rating', key: 'rating', width: 10 },
    { header: 'Reviews', key: 'reviewsCount', width: 10 },
    { header: 'Host Name', key: 'hostName', width: 22 },
    { header: 'Host Total Listings', key: 'hostTotalListings', width: 18 },
    { header: 'Amenities Count', key: 'amenitiesCount', width: 16 },
    { header: 'All Amenities', key: 'amenitiesText', width: 65 },
    { header: 'House Rules', key: 'houseRulesText', width: 50 },
    { header: 'Description', key: 'description', width: 65 },
    { header: 'URL', key: 'url', width: 45 },
  ];
  styleHeader(rawSheet.getRow(1), 'FF1E293B');
  for (const r of sortedRooms) {
    rawSheet.addRow({
      ...r,
      amenitiesCount: r.amenities.length,
      amenitiesText: r.amenities.join(' | '),
    });
  }
  await rawWb.xlsx.writeFile(path.join(bundleDir, rawExcelFile));
  fs.writeFileSync(path.join(bundleDir, rawJsonFile), JSON.stringify(sortedRooms, null, 2), 'utf8');

  // 3. Đóng gói .zip toàn bộ thư mục kết quả
  const zipFileName = `7Nights_Global_${buildingLabel}_${dateStamp}.zip`;
  const zipPath = path.join(outputDir, zipFileName);
  createZipFromDirectory(bundleDir, zipPath);
  onLog?.(`[Bundle] Đã đóng gói ${zipFileName} thành công!`, 'success');

  return {
    bundleName,
    bundleDir,
    sevenNightsExcelFile,
    rawExcelFile,
    rawJsonFile,
    zipFileName,
    totalPhotosDownloaded,
    preview,
  };
}
