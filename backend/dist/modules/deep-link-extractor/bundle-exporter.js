"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSevenNightsPreview = buildSevenNightsPreview;
exports.exportSevenNightsBundle = exportSevenNightsBundle;
const ExcelJS = __importStar(require("exceljs"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const helpers_1 = require("../../common/helpers");
const zip_utils_1 = require("./zip-utils");
const HANGUL_INITIALS = [
    'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp', 's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
];
const HANGUL_MEDIALS = [
    'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o', 'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu', 'eu', 'ui', 'i',
];
const HANGUL_FINALS = [
    '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'l', 'm', 'p', 'p', 't', 't', 'ng', 't', 't', 'k', 't', 'p', 't',
];
function romanizeHangul(input) {
    let out = '';
    for (const ch of input) {
        const code = ch.charCodeAt(0);
        if (code >= 0xac00 && code <= 0xd7a3) {
            const sIndex = code - 0xac00;
            const l = Math.floor(sIndex / (21 * 28));
            const v = Math.floor((sIndex % (21 * 28)) / 28);
            const t = sIndex % 28;
            out += HANGUL_INITIALS[l] + HANGUL_MEDIALS[v] + HANGUL_FINALS[t];
        }
        else {
            out += ch;
        }
    }
    return out;
}
function toSlug(text, fallback = 'item') {
    const romanized = romanizeHangul(text || '');
    const ascii = romanized
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
    return ascii || fallback;
}
function formatDateTimeStamp(date) {
    const d = (0, helpers_1.formatDateStamp)(date);
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${d}_${hh}-${mm}`;
}
function styleHeader(row, argb = 'FF0F766E') {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.height = 26;
}
function buildSevenNightsPreview(extractedRooms, defaultCity = 'Seoul', photoPathPrefix = '') {
    const citySlugUpper = toSlug(defaultCity, 'CITY').toUpperCase().replace(/-/g, '');
    const buildingGroups = [];
    const hostGroups = new Map();
    const roomRows = [];
    const buildingCodeCounters = new Map();
    const hostCodeCounters = new Map();
    const nextUniqueCode = (baseSlug, counterMap) => {
        const count = (counterMap.get(baseSlug) || 0) + 1;
        counterMap.set(baseSlug, count);
        return `${baseSlug}-${String(count).padStart(3, '0')}`;
    };
    extractedRooms.forEach((room, idx) => {
        const roomCode = `${citySlugUpper}-ROOM-${String(idx + 1).padStart(3, '0')}`;
        const city = room.city || defaultCity;
        const country = room.country || (city.toLowerCase().includes('seoul') ? 'South Korea' : '');
        const bName = (room.buildingName || '').trim() || `${room.district || city} Residence`;
        let bGroup = buildingGroups.find((g) => {
            if (room.buildingName && g.name.toLowerCase() === bName.toLowerCase())
                return true;
            if (g.lat !== null &&
                g.lng !== null &&
                room.lat !== null &&
                room.lng !== null &&
                (0, helpers_1.haversineMeters)(g.lat, g.lng, room.lat, room.lng) <= 50) {
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
        const hostKey = room.hostId || `name:${(room.hostName || 'unknown').toLowerCase()}`;
        let hGroup = hostGroups.get(hostKey);
        if (!hGroup) {
            const hSlug = toSlug(room.hostName || `host-${room.hostId || idx + 1}`, 'host');
            const hCode = nextUniqueCode(hSlug, hostCodeCounters);
            hGroup = {
                code: hCode,
                name: room.hostName || 'Unknown Host',
                country,
                link: room.hostAirbnbLink ||
                    (room.hostId ? `https://www.airbnb.com/users/profile/${room.hostId}` : ''),
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
    const buildings = buildingGroups.map((g) => {
        const first = g.rooms[0];
        const lat = g.lat ?? first?.lat;
        const lng = g.lng ?? first?.lng;
        const poolVal = g.rooms.map((r) => r.amenityFlags.swimmingPool).find((v) => v.startsWith('YES')) || 'NO';
        const gymVal = g.rooms.map((r) => r.amenityFlags.gym).find((v) => v.startsWith('YES')) || 'NO';
        const gymFeeVal = g.rooms.map((r) => r.amenityFlags.gymFee).find((v) => v === 'Have to pay' || v === 'Free') ||
            (gymVal.startsWith('YES') ? 'Check with host' : '');
        const parkingVal = g.rooms.map((r) => r.amenityFlags.parking).find((v) => v.startsWith('yes')) || 'NO';
        const address = g.rooms.map((r) => r.address).find((a) => a && a.length > 5) ||
            `${first?.district || ''} ${first?.city || defaultCity}`.trim();
        const googleLink = g.name && !g.name.endsWith('Residence')
            ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${g.name.replace(/\([^)]*\)/g, '').trim()} ${first?.district || ''} ${first?.city || defaultCity}`.trim())}`
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
    const hosts = Array.from(hostGroups.values()).map((h) => ({
        'Host code': h.code,
        'host name': h.name,
        country: h.country,
        'host phone number': '',
        'bank name': '',
        'account number': '',
        'account name': '',
        'host airbnb link': h.link,
        'supplier apartment code': Array.from(new Set(h.supplierCodes)).join(', '),
        'ROOM INFOR': h.roomCodes.join(', '),
    }));
    return { buildings, hosts, rooms: roomRows };
}
async function downloadSinglePhoto(url, destPath) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        const resp = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            },
        });
        clearTimeout(timer);
        if (!resp.ok)
            return false;
        const arrayBuf = await resp.arrayBuffer();
        if (arrayBuf.byteLength < 500)
            return false;
        fs.writeFileSync(destPath, Buffer.from(arrayBuf));
        return true;
    }
    catch {
        return false;
    }
}
async function exportSevenNightsBundle(params) {
    const { outputDir, locationLabel, rooms, downloadPhotos, onLog } = params;
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const now = new Date();
    const dateStamp = (0, helpers_1.formatDateStamp)(now);
    const dateTimeStamp = formatDateTimeStamp(now);
    const prePreview = buildSevenNightsPreview(rooms, locationLabel, downloadPhotos ? 'Photos' : '');
    let primaryBuildingRaw = locationLabel || 'Airbnb';
    if (prePreview.buildings.length > 0) {
        const sortedBuildings = [...prePreview.buildings].sort((a, b) => (b['ROOM INFOR'] ? b['ROOM INFOR'].split(',').length : 0) -
            (a['ROOM INFOR'] ? a['ROOM INFOR'].split(',').length : 0));
        primaryBuildingRaw = sortedBuildings[0]['Building Name'] || primaryBuildingRaw;
    }
    const safeBuildingBase = (0, helpers_1.sanitizeFilename)(primaryBuildingRaw).replace(/_+/g, '_');
    const buildingLabel = prePreview.buildings.length > 1
        ? `${safeBuildingBase}_va_${prePreview.buildings.length - 1}_Toa_Khac`
        : safeBuildingBase;
    const bundleName = `7Nights_Global_${buildingLabel}_${dateTimeStamp}`;
    const bundleDir = path.join(outputDir, bundleName);
    fs.mkdirSync(bundleDir, { recursive: true });
    const preview = prePreview;
    let totalPhotosDownloaded = 0;
    if (downloadPhotos && rooms.length > 0) {
        const photosRoot = path.join(bundleDir, 'Photos');
        fs.mkdirSync(photosRoot, { recursive: true });
        onLog?.(`[Photos] Đang tải ảnh chất lượng cao cho ${rooms.length} căn hộ...`, 'step');
        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            const roomCode = preview.rooms[i]?.['Room code'] || `ROOM-${i + 1}`;
            const roomPhotoDir = path.join(photosRoot, roomCode);
            fs.mkdirSync(roomPhotoDir, { recursive: true });
            const urls = room.photoUrls.slice(0, 25);
            const concurrency = 4;
            let cursor = 0;
            let roomPhotoCount = 0;
            const workers = Array.from({ length: Math.min(concurrency, urls.length) }, async () => {
                while (cursor < urls.length) {
                    const idx = cursor++;
                    const photoUrl = urls[idx];
                    const ext = /\.webp/i.test(photoUrl) ? 'webp' : 'jpg';
                    const dest = path.join(roomPhotoDir, `${String(idx + 1).padStart(2, '0')}.${ext}`);
                    const ok = await downloadSinglePhoto(photoUrl, dest);
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
        }
        onLog?.(`[Photos] Đã tải xong ${totalPhotosDownloaded} ảnh vào thư mục Photos/.`, 'success');
    }
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
    for (const r of rooms) {
        rawSheet.addRow({
            ...r,
            amenitiesCount: r.amenities.length,
            amenitiesText: r.amenities.join(' | '),
        });
    }
    await rawWb.xlsx.writeFile(path.join(bundleDir, rawExcelFile));
    fs.writeFileSync(path.join(bundleDir, rawJsonFile), JSON.stringify(rooms, null, 2), 'utf8');
    const zipFileName = `7Nights_Global_${buildingLabel}_${dateStamp}.zip`;
    const zipPath = path.join(outputDir, zipFileName);
    (0, zip_utils_1.createZipFromDirectory)(bundleDir, zipPath);
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
//# sourceMappingURL=bundle-exporter.js.map