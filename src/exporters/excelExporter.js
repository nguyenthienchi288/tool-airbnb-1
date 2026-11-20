import ExcelJS from 'exceljs';
import fs from 'fs';
import path from 'path';
import { APP_CONFIG } from '../config/index.js';
import { formatDateStamp, sanitizeFilename } from '../utils/helpers.js';

const HEADER_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E78' },
};

const HEADER_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FFFFFFFF' },
};

const GREEN_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9EAD3' },
};

const GREEN_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FF274E13' },
};

const RED_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF4CCCC' },
};

const RED_FONT = {
  name: 'Calibri',
  size: 11,
  bold: true,
  color: { argb: 'FF990000' },
};

const YELLOW_FILL = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFF2CC' },
};

const LINK_FONT = {
  name: 'Calibri',
  size: 11,
  color: { argb: 'FF1155CC' },
  underline: true,
};

const THIN_BORDER = {
  top: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  left: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  bottom: { style: 'thin', color: { argb: 'FFD9D9D9' } },
  right: { style: 'thin', color: { argb: 'FFD9D9D9' } },
};

function styleHeaderAndAutoFit(worksheet, freezeCols = 0) {
  const headerRow = worksheet.getRow(1);
  headerRow.height = 28;
  headerRow.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = THIN_BORDER;
  });

  worksheet.views = [
    { state: 'frozen', xSplit: freezeCols, ySplit: 1, activeCell: 'A2' },
  ];

  if (worksheet.columnCount > 0) {
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: worksheet.columnCount },
    };
  }

  worksheet.columns.forEach((col) => {
    let maxLen = 12;
    col.eachCell({ includeEmpty: true }, (cell) => {
      const val = cell.value;
      const text =
        val && typeof val === 'object' && val.text
          ? String(val.text)
          : val && typeof val === 'object' && val.formula
          ? '123456.78'
          : String(val ?? '');
      const firstLine = text.split('\n')[0];
      if (firstLine.length + 3 > maxLen) {
        maxLen = firstLine.length + 3;
      }
    });
    col.width = Math.min(Math.max(maxLen, 12), 48);
  });
}

function applyRowBorders(row) {
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.border = THIN_BORDER;
    if (!cell.alignment) {
      cell.alignment = { vertical: 'middle' };
    }
  });
}

function getColumnLetter(colNumber) {
  let letter = '';
  let n = colNumber;
  while (n > 0) {
    const mod = (n - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    n = Math.floor((n - mod) / 26);
  }
  return letter;
}

function populateSheet1Summary(ws, summaries) {
  ws.columns = [
    { header: 'Thành Phố', key: 'city' },
    { header: 'Quốc Gia', key: 'country' },
    { header: 'Tổng Căn Quét Thô', key: 'rawCount' },
    { header: 'Tổng Căn Sạch (Sau Lọc Trùng)', key: 'cleanCount' },
    { header: 'Căn Chung Cư Cao Tầng (YES)', key: 'highRiseYesCount' },
    { header: 'Căn Bị Loại (NO)', key: 'highRiseNoCount' },
    { header: 'Tỷ Lệ % Chung Cư Cao Tầng', key: 'highRiseRatio' },
    { header: 'Tổng Số Tòa Nhà Cao Tầng', key: 'totalBuildings' },
    { header: 'Số Tòa Đạt Chuẩn (>=5 Host)', key: 'qualifiedBuildings' },
    { header: 'Giá TB/Đêm Toàn TP ($)', key: 'avgPriceUsd' },
    { header: 'Biên Độ Giá TB Theo Ngày (%)', key: 'avgSpreadRatio' },
    { header: 'Đánh Giá Khả Thi (Verdict)', key: 'verdict' },
  ];

  summaries.forEach((s, idx) => {
    const r = idx + 2;
    const row = ws.addRow({
      city: s.city,
      country: s.country,
      rawCount: s.rawCount ?? s.raw_count ?? 0,
      cleanCount: s.cleanCount ?? s.clean_count ?? 0,
      highRiseYesCount: s.highRiseYesCount ?? s.highrise_yes_count ?? 0,
      highRiseNoCount: s.highRiseNoCount ?? s.highrise_no_count ?? 0,
      highRiseRatio: {
        formula: `IF(D${r}>0,E${r}/D${r},0)`,
        result: ((s.highRisePct ?? s.highrise_pct ?? 0) / 100),
      },
      totalBuildings: s.totalBuildings ?? s.total_buildings ?? 0,
      qualifiedBuildings: s.qualifiedBuildings ?? s.qualified_buildings ?? 0,
      avgPriceUsd: s.avgPriceUsd ?? s.avg_price_usd ?? 0,
      avgSpreadRatio: ((s.avgSpreadPct ?? s.avg_spread_pct ?? 0) / 100),
      verdict: {
        formula: `IF(AND(I${r}>=10,K${r}>=0.1),"ĐẠT CHUẨN - ƯU TIÊN CHỌN","CHƯA ĐẠT CHUẨN")`,
        result: s.verdict,
      },
    });

    row.getCell(7).numFmt = '0.0%';
    row.getCell(10).numFmt = '$#,##0.00';
    row.getCell(11).numFmt = '0.0%';

    const verdictText = s.verdict || '';
    const vCell = row.getCell(12);
    if (verdictText.includes('ĐẠT CHUẨN')) {
      vCell.fill = GREEN_FILL;
      vCell.font = GREEN_FONT;
    } else {
      vCell.fill = RED_FILL;
      vCell.font = RED_FONT;
    }
    applyRowBorders(row);
  });

  styleHeaderAndAutoFit(ws, 2);
}

function populateSheet2Buildings(ws, buildings, includeCityColumn = false) {
  const cols = [
    { header: 'Hạng', key: 'rank' },
    ...(includeCityColumn ? [{ header: 'Thành Phố', key: 'city' }] : []),
    { header: 'Tên Tòa Nhà', key: 'buildingName' },
    { header: 'Địa Chỉ Chính Xác', key: 'streetAddress' },
    { header: 'Tọa Độ (Lat, Lng)', key: 'coordinates' },
    { header: 'Số Lượng Host Độc Lập', key: 'uniqueHostsCount' },
    { header: 'Tổng Số Căn Hộ Đang Khai Thác', key: 'listingsCount' },
    { header: 'Trạng Thái Đạt Chuẩn', key: 'status' },
    { header: 'Giá Min/Đêm ($)', key: 'minPrice' },
    { header: 'Giá Max/Đêm ($)', key: 'maxPrice' },
    { header: 'Giá Trung Bình/Đêm ($)', key: 'avgPrice' },
    { header: 'Biên Độ Chênh Lệch Giá (%)', key: 'avgSpreadRatio' },
    { header: 'Số Căn Best-Seller', key: 'bestSellerCount' },
    { header: 'Danh Sách Tên Các Host Trong Tòa', key: 'hostNames' },
    { header: 'Link Căn Bán Chạy Nhất Tòa', key: 'bestListingUrl' },
  ];
  ws.columns = cols;

  buildings.forEach((b) => {
    const rowData = {
      rank: b.rank,
      ...(includeCityColumn ? { city: b.city } : {}),
      buildingName: b.buildingName,
      streetAddress: b.streetAddress,
      coordinates: b.coordinates,
      uniqueHostsCount: b.uniqueHostsCount,
      listingsCount: b.listingsCount,
      status: b.status,
      minPrice: b.minPrice,
      maxPrice: b.maxPrice,
      avgPrice: b.avgPrice,
      avgSpreadRatio: (b.avgSpreadPct || 0) / 100,
      bestSellerCount: b.bestSellerCount,
      hostNames: b.hostNames,
      bestListingUrl: b.bestListingUrl
        ? { text: b.bestListingUrl, hyperlink: b.bestListingUrl }
        : '',
    };

    const row = ws.addRow(rowData);
    const offset = includeCityColumn ? 1 : 0;

    const hostCell = row.getCell(6 + offset);
    const statusCell = row.getCell(8 + offset);
    if (b.uniqueHostsCount >= 5) {
      hostCell.fill = GREEN_FILL;
      hostCell.font = GREEN_FONT;
      statusCell.fill = GREEN_FILL;
      statusCell.font = GREEN_FONT;
    } else {
      statusCell.fill = YELLOW_FILL;
    }

    row.getCell(9 + offset).numFmt = '$#,##0.00';
    row.getCell(10 + offset).numFmt = '$#,##0.00';
    row.getCell(11 + offset).numFmt = '$#,##0.00';
    row.getCell(12 + offset).numFmt = '0.0%';

    if (b.bestListingUrl) {
      row.getCell(15 + offset).font = LINK_FONT;
    }
    applyRowBorders(row);
  });

  styleHeaderAndAutoFit(ws, includeCityColumn ? 3 : 2);
}

function populateSheet3Listings(ws, listings) {
  ws.columns = [
    { header: 'Listing ID', key: 'listingId' },
    { header: 'Link Airbnb', key: 'listingUrl' },
    { header: 'Phân Loại Cao Tầng', key: 'isHighRise' },
    { header: 'Tên Tòa Nhà (Chuẩn Hóa)', key: 'buildingName' },
    { header: 'Địa Chỉ Thực Tế', key: 'streetAddress' },
    { header: 'Tiêu Đề Căn Hộ', key: 'title' },
    { header: 'Loại Hình Chỗ Ở (Property Type)', key: 'propertyType' },
    { header: 'Tiện Nghi Nhận Diện (AMENITIES_DEFAULT)', key: 'matchedAmenities' },
    { header: 'Tên Chủ Nhà (Host)', key: 'hostName' },
    { header: 'Host ID', key: 'hostId' },
    { header: 'Link Profile Host', key: 'hostUrl' },
    { header: 'Giá Thấp Nhất/Đêm ($)', key: 'minPrice' },
    { header: 'Giá Cao Nhất/Đêm ($)', key: 'maxPrice' },
    { header: 'Giá Trung Bình/Đêm ($)', key: 'avgPrice' },
    { header: '% Chênh Lệch Giá', key: 'spreadRatio' },
    { header: 'Số Lượt Đánh Giá', key: 'ratingCount' },
    { header: 'Điểm Sao', key: 'ratingAverage' },
    { header: 'Nhãn Best-Seller', key: 'bestSeller' },
  ];

  listings.forEach((l, idx) => {
    const r = idx + 2;
    const bestSellerText = l.isGuestFavorite
      ? l.badgeLabel || 'GUEST_FAVORITE'
      : (l.ratingCount || 0) > 30
      ? '>30 Reviews'
      : '';

    const row = ws.addRow({
      listingId: l.listingId,
      listingUrl: l.listingUrl
        ? { text: l.listingUrl, hyperlink: l.listingUrl }
        : '',
      isHighRise: l.isHighRise,
      buildingName: l.buildingName,
      streetAddress: l.streetAddress,
      title: l.title,
      propertyType: l.propertyType,
      matchedAmenities: (l.matchedAmenities || []).join(', '),
      hostName: l.hostName,
      hostId: l.hostId,
      hostUrl: l.hostUrl ? { text: l.hostUrl, hyperlink: l.hostUrl } : '',
      minPrice: l.minPrice ?? 0,
      maxPrice: l.maxPrice ?? 0,
      avgPrice: l.avgPrice ?? 0,
      spreadRatio: {
        formula: `IF(M${r}>0,(M${r}-L${r})/M${r},0)`,
        result: (l.priceSpreadPct || 0) / 100,
      },
      ratingCount: l.ratingCount || 0,
      ratingAverage: l.ratingAverage || 0,
      bestSeller: bestSellerText,
    });

    if (l.listingUrl) row.getCell(2).font = LINK_FONT;
    if (l.hostUrl) row.getCell(11).font = LINK_FONT;

    const hrCell = row.getCell(3);
    if (l.isHighRise === 'YES') {
      hrCell.fill = GREEN_FILL;
      hrCell.font = GREEN_FONT;
    } else {
      hrCell.fill = RED_FILL;
      hrCell.font = RED_FONT;
    }

    row.getCell(12).numFmt = '$#,##0.00';
    row.getCell(13).numFmt = '$#,##0.00';
    row.getCell(14).numFmt = '$#,##0.00';
    row.getCell(15).numFmt = '0.0%';
    row.getCell(17).numFmt = '0.00';

    applyRowBorders(row);
  });

  styleHeaderAndAutoFit(ws, 3);
}

function populateSheet4PriceMatrix(ws, listings, priceHistoryRows, datePairs) {
  const uniqueDateKeys =
    datePairs && datePairs.length > 0
      ? datePairs.map((d) => d.key)
      : Array.from(new Set(priceHistoryRows.map((p) => p.date_key))).sort();

  const columns = [
    { header: 'Listing ID', key: 'listingId' },
    { header: 'Tên Căn Hộ', key: 'title' },
    ...uniqueDateKeys.map((dk) => ({ header: dk, key: dk })),
    { header: 'Min/Đêm ($)', key: 'minFormula' },
    { header: 'Max/Đêm ($)', key: 'maxFormula' },
    { header: 'Avg/Đêm ($)', key: 'avgFormula' },
    { header: 'Biên Độ Giá (%)', key: 'spreadFormula' },
  ];
  ws.columns = columns;

  const priceLookup = new Map();
  for (const row of priceHistoryRows) {
    if (!priceLookup.has(row.listing_id)) {
      priceLookup.set(row.listing_id, new Map());
    }
    priceLookup.get(row.listing_id).set(row.date_key, row.price_per_night);
  }

  const firstDateColIdx = 3;
  const lastDateColIdx = 2 + uniqueDateKeys.length;
  const firstColLetter = getColumnLetter(firstDateColIdx);
  const lastColLetter =
    uniqueDateKeys.length > 0 ? getColumnLetter(lastDateColIdx) : firstColLetter;

  const minColLetter = getColumnLetter(lastDateColIdx + 1);
  const maxColLetter = getColumnLetter(lastDateColIdx + 2);

  listings.forEach((l, idx) => {
    const r = idx + 2;
    const itemPrices = priceLookup.get(l.listingId) || new Map();

    const rowData = {
      listingId: l.listingId,
      title: l.title,
    };
    for (const dk of uniqueDateKeys) {
      rowData[dk] = itemPrices.has(dk) ? itemPrices.get(dk) : null;
    }

    if (uniqueDateKeys.length > 0) {
      const range = `${firstColLetter}${r}:${lastColLetter}${r}`;
      rowData.minFormula = {
        formula: `IF(COUNT(${range})>0,MIN(${range}),0)`,
        result: l.minPrice ?? 0,
      };
      rowData.maxFormula = {
        formula: `IF(COUNT(${range})>0,MAX(${range}),0)`,
        result: l.maxPrice ?? 0,
      };
      rowData.avgFormula = {
        formula: `IF(COUNT(${range})>0,AVERAGE(${range}),0)`,
        result: l.avgPrice ?? 0,
      };
      rowData.spreadFormula = {
        formula: `IF(${maxColLetter}${r}>0,(${maxColLetter}${r}-${minColLetter}${r})/${maxColLetter}${r},0)`,
        result: (l.priceSpreadPct || 0) / 100,
      };
    }

    const row = ws.addRow(rowData);

    for (let c = 3; c <= lastDateColIdx + 3; c++) {
      row.getCell(c).numFmt = '$#,##0.00';
    }
    row.getCell(lastDateColIdx + 4).numFmt = '0.0%';

    applyRowBorders(row);
  });

  styleHeaderAndAutoFit(ws, 2);
}

function populateSheet5ExternalPortfolio(ws, outOfTargetListings) {
  ws.columns = [
    { header: 'Host ID', key: 'hostId' },
    { header: 'Tên Host', key: 'hostName' },
    { header: 'Mã Căn (Listing ID)', key: 'listingId' },
    { header: 'Tiêu Đề', key: 'title' },
    { header: 'Quốc Gia Thực Tế', key: 'actualCountry' },
    { header: 'Thành Phố / Khu Vực Thực Tế', key: 'actualCity' },
    { header: 'Tọa Độ (Lat, Lng)', key: 'coordinates' },
    { header: 'Loại Hình', key: 'propertyType' },
    { header: 'Giá/Đêm (USD)', key: 'avgPrice' },
    { header: 'Link Airbnb', key: 'listingUrl' },
  ];

  outOfTargetListings.forEach((l) => {
    const coords =
      typeof l.lat === 'number' && typeof l.lng === 'number'
        ? `${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}`
        : '';
    const hostDisplay =
      l.hostName && String(l.hostName).trim().length >= 2
        ? String(l.hostName).trim()
        : l.hostId
        ? `Host #${l.hostId}`
        : 'Ẩn danh';

    const row = ws.addRow({
      hostId: l.hostId || '',
      hostName: hostDisplay,
      listingId: l.listingId,
      title: l.title || '',
      actualCountry: l.actualCountry || 'Ngoài vùng mục tiêu',
      actualCity: l.actualCity || l.streetAddress || '',
      coordinates: coords,
      propertyType: l.propertyType || '',
      avgPrice: l.avgPrice || 0,
      listingUrl: l.listingUrl
        ? { text: l.listingUrl, hyperlink: l.listingUrl }
        : '',
    });

    row.getCell(9).numFmt = '$#,##0.00';
    if (l.listingUrl) {
      row.getCell(10).font = LINK_FONT;
    }
    applyRowBorders(row);
  });

  styleHeaderAndAutoFit(ws, 2);
}

/**
 * Export single-city 4-sheet IN_TARGET report + OUT_OF_TARGET Host External Portfolio sheet
 * AND append/update Master_City_Comparison.xlsx.
 */
export async function exportCityReports({
  city,
  country,
  citySummary,
  buildings,
  cleanListings,
  outOfTargetListings = [],
  priceHistoryRows,
  datePairs,
  allCitySummaries,
  outputDir = APP_CONFIG.outputDir,
}) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const inTargetListings = cleanListings.filter(
    (l) => (l.scopeStatus || 'IN_TARGET') === 'IN_TARGET'
  );
  const externalListings =
    outOfTargetListings.length > 0
      ? outOfTargetListings
      : cleanListings.filter((l) => l.scopeStatus === 'OUT_OF_TARGET');

  const dateStamp = formatDateStamp();
  const safeCity = sanitizeFilename(city);
  const cityReportPath = path.join(
    outputDir,
    `Airbnb_Market_Report_${safeCity}_${dateStamp}.xlsx`
  );

  // 1. Single-city Workbook (4 main IN_TARGET sheets + 1 OUT_OF_TARGET Host External Portfolio sheet)
  const cityWb = new ExcelJS.Workbook();
  cityWb.creator = 'Airbnb Market CLI';
  cityWb.created = new Date();

  const ws1 = cityWb.addWorksheet('Tong_Quan_Doi_Sanh');
  populateSheet1Summary(ws1, [citySummary]);

  const ws2 = cityWb.addWorksheet('Top_10_Toa_Nha_Tiem_Nang');
  populateSheet2Buildings(ws2, buildings, false);

  const ws3 = cityWb.addWorksheet('Du_Lieu_Chi_Tiet_Can_Ho');
  populateSheet3Listings(ws3, inTargetListings);

  const ws4 = cityWb.addWorksheet('Ma_Tran_Gia_Theo_Ngay');
  populateSheet4PriceMatrix(ws4, inTargetListings, priceHistoryRows, datePairs);

  const ws5 = cityWb.addWorksheet('Danh_Muc_Host_Ngoai_Khu_Vuc');
  populateSheet5ExternalPortfolio(ws5, externalListings);

  await cityWb.xlsx.writeFile(cityReportPath);

  // 2. Master Multi-City Comparison Workbook (append/update)
  const masterPath = path.join(outputDir, 'Master_City_Comparison.xlsx');
  const masterWb = new ExcelJS.Workbook();
  masterWb.creator = 'Airbnb Market CLI';
  masterWb.created = new Date();

  const summariesToWrite =
    allCitySummaries && allCitySummaries.length > 0
      ? allCitySummaries
      : [citySummary];

  const masterWs1 = masterWb.addWorksheet('Tong_Quan_Doi_Sanh');
  populateSheet1Summary(masterWs1, summariesToWrite);

  // Preserve or append city top buildings sheet in Master workbook
  if (fs.existsSync(masterPath)) {
    try {
      const existingMaster = new ExcelJS.Workbook();
      await existingMaster.xlsx.readFile(masterPath);
      for (const sheet of existingMaster.worksheets) {
        if (sheet.name !== 'Tong_Quan_Doi_Sanh' && sheet.name !== `Top_${safeCity}`.slice(0, 31)) {
          const copied = masterWb.addWorksheet(sheet.name);
          sheet.eachRow((row, rowNumber) => {
            const targetRow = copied.getRow(rowNumber);
            row.eachCell((cell, colNumber) => {
              const targetCell = targetRow.getCell(colNumber);
              targetCell.value = cell.value;
              targetCell.style = cell.style;
            });
          });
        }
      }
    } catch {
      // If existing master file is corrupted or unreadable, rebuild cleanly from SQLite summaries
    }
  }

  const cityTopSheetName = `Top_${safeCity}`.slice(0, 31);
  const masterCityTopWs = masterWb.addWorksheet(cityTopSheetName);
  populateSheet2Buildings(
    masterCityTopWs,
    buildings.slice(0, 20).map((b) => ({ ...b, city })),
    true
  );

  await masterWb.xlsx.writeFile(masterPath);

  return {
    cityReportPath,
    masterPath,
  };
}
