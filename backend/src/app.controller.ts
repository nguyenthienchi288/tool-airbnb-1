import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfigService } from './config/app-config.service';
import { APP_VERSION, SHORT_VERSION } from './config/constants';
import { DatabaseService } from './modules/database/database.service';
import { ExporterService } from './modules/exporter/exporter.service';

const CHANGELOG = [
  'Chế độ trình duyệt thật có giao diện (Headful 1366x768, vi-VN, Asia/Ho_Chi_Minh) chống bot 429',
  'Mở song song 1–5 Tab (mặc định 3 Tab) cuộn chuột mượt & bấm chuyển trang từ Trang 1 đến Trang 15',
  'Bắt trọn JSON StaysSearch / ExploreLayout & StaysPdpSections từ Network Response, lưu tức thì vào SQLite',
  'Smart Incremental Crawl: Tự động bỏ qua các căn hộ đã có đủ chi tiết & tiện nghi trong SQLite',
];

@Controller('api')
export class AppController {
  constructor(
    private readonly appConfig: AppConfigService,
    private readonly db: DatabaseService,
    private readonly exporter: ExporterService,
  ) {}

  @Get('system/version')
  getVersion(@Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return {
      status: 'connected',
      version: APP_VERSION,
      shortVersion: SHORT_VERSION,
      updatedAt: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }),
      changelog: CHANGELOG,
      proxyConfigured: Boolean(this.appConfig.proxy),
    };
  }

  @Get('listings')
  getListings(
    @Query('locationQuery') locationQuery?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.db.getRooms({
      locationQuery: locationQuery?.trim() || undefined,
      search: search?.trim() || undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('export/homes')
  async exportHomes(@Query('cityName') cityName: string, @Res() res: Response) {
    const { filePath, fileName } = await this.exporter.exportCitySummaryReport(cityName?.trim() || undefined);
    return res.download(filePath, fileName);
  }

  @Get('export/master')
  async exportMaster(@Res() res: Response) {
    const { filePath, fileName } = await this.exporter.exportMasterCityComparison();
    return res.download(filePath, fileName);
  }

  @Get('export/host-rooms')
  async exportHostRooms(@Query('cityName') cityName: string, @Res() res: Response) {
    const { filePath, fileName } = await this.exporter.exportHostRoomsExcel(cityName?.trim() || undefined);
    return res.download(filePath, fileName);
  }

  @Get('reports')
  getReports() {
    const outputDir = this.appConfig.outputDir;
    if (!fs.existsSync(outputDir)) return { files: [] };
    const files = fs
      .readdirSync(outputDir)
      .filter((name) => name.toLowerCase().endsWith('.xlsx') && !name.startsWith('~$'))
      .map((name) => {
        const stat = fs.statSync(path.join(outputDir, name));
        return {
          name,
          sizeBytes: stat.size,
          updatedAt: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return { files };
  }

  @Get('reports/download/:filename')
  downloadReport(@Param('filename') filename: string, @Res() res: Response) {
    const safeName = path.basename(filename || '');
    if (!safeName || !safeName.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('Tên file không hợp lệ.');
    }
    const filePath = path.join(this.appConfig.outputDir, safeName);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('Không tìm thấy file báo cáo.');
    }
    return res.download(filePath, safeName);
  }
}
