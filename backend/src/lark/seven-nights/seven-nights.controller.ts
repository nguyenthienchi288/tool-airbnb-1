import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { SevenNightsSyncService } from './seven-nights.service';

interface UploadedWorkbook {
  originalname: string;
  buffer: Buffer;
}

@Controller('lark-7nights')
export class SevenNightsController {
  constructor(private readonly syncService: SevenNightsSyncService) {}

  @Get('ui')
  getUi(@Res() res: Response) {
    res.type('html').send(this.syncService.getUiHtml());
  }

  @Get('download-template')
  async downloadTemplate(@Res() res: Response) {
    const workbook = await this.syncService.createTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', 'attachment; filename="7nights-template.xlsx"');
    res.send(workbook);
  }

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async preview(@UploadedFile() file?: UploadedWorkbook) {
    this.assertWorkbook(file);
    return this.syncService.previewWorkbook(file.buffer, file.originalname);
  }

  @Post('sync')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  startSync(@UploadedFile() file?: UploadedWorkbook) {
    this.assertWorkbook(file);
    return this.syncService.startSync(file.buffer, file.originalname);
  }

  @Get(':jobId/stream')
  stream(
    @Req() req: Request,
    @Res() res: Response,
    @Param('jobId') jobId: string,
  ) {
    const job = this.syncService.getJob(jobId);
    if (!job) throw new NotFoundException('Không tìm thấy tiến trình đồng bộ.');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    for (const log of job.logs) {
      this.syncService.sendSse(res, 'log', log);
    }
    if (job.status === 'completed') {
      this.syncService.sendSse(res, 'done', job.result);
      return;
    }
    if (job.status === 'error') {
      this.syncService.sendSse(res, 'error', { error: job.error });
      return;
    }

    job.clients.add(res);
    req.on('close', () => job.clients.delete(res));
  }

  private assertWorkbook(file?: UploadedWorkbook): asserts file is UploadedWorkbook {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Vui lòng chọn file Excel .xlsx hoặc .xls.');
    }
    if (!/\.(xlsx|xls)$/i.test(file.originalname)) {
      throw new BadRequestException('Chỉ hỗ trợ file có đuôi .xlsx hoặc .xls.');
    }
  }
}
