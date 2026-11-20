import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { BuildingsService } from './buildings.service';

@Controller('api/buildings')
export class BuildingsController {
  constructor(private readonly buildingsService: BuildingsService) {}

  @Post('export-clusters')
  async exportClusters(@Body() body?: { cityName?: string }) {
    const result = await this.buildingsService.exportClustersExcel(body?.cityName);
    return {
      fileName: result.fileName,
      downloadUrl: `/api/reports/download/${encodeURIComponent(result.fileName)}`,
      totalClusters: result.totalClusters,
      totalRooms: result.totalRooms,
    };
  }

  @Post('import-clusters')
  @UseInterceptors(FileInterceptor('file'))
  async importClusters(
    @UploadedFile() file: { buffer: Buffer; originalname: string } | undefined,
    @Body('cityName') cityName?: string,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Vui lòng chọn file Excel (.xlsx) hợp lệ để tải lên.');
    }
    return this.buildingsService.importClustersExcel(file.buffer, cityName);
  }
}
