import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppConfigService } from '../../config/app-config.service';
import { DeepLinkExtractorService } from './deep-link-extractor.service';

@Controller('api/deep-extract')
export class DeepLinkExtractorController {
  constructor(
    private readonly extractor: DeepLinkExtractorService,
    private readonly appConfig: AppConfigService,
  ) {}

  @Post('parse-url')
  parseUrl(@Body() body: { url?: string }) {
    return this.extractor.parseUrl(body?.url || '');
  }

  @Post('start')
  start(@Body() body: any) {
    const active = this.extractor.getActiveJob();
    if (active) {
      throw new ConflictException({
        error: 'Đang có tiến trình Trích xuất Link chạy. Vui lòng dừng trước khi bắt đầu lượt mới.',
        activeJobId: active.jobId,
      });
    }
    const url = String(body?.url || '').trim();
    if (!url) {
      throw new BadRequestException('Vui lòng dán đường dẫn URL Airbnb.');
    }

    const job = this.extractor.startJob({
      url,
      downloadPhotos: body?.downloadPhotos !== false,
      strictBoundsOnly: body?.strictBoundsOnly !== false,
      proxyUrl: body?.proxyUrl ? String(body.proxyUrl).trim() : undefined,
      useWarpProxy: Boolean(body?.useWarpProxy),
      humanLikeMode: body?.humanLikeMode !== false,
      aiProvider: body?.aiProvider || 'gemini',
      aiApiKey: body?.aiApiKey ? String(body.aiApiKey).trim() : undefined,
      enableAiEnrichment: body?.enableAiEnrichment !== false,
    });

    return { jobId: job.jobId, status: job.status };
  }

  @Get(':jobId/stream')
  stream(@Param('jobId') jobId: string, @Req() req: Request, @Res() res: Response) {
    const job = this.extractor.getJob(jobId);
    if (!job) throw new NotFoundException('Không tìm thấy jobId.');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.extractor.sendSse(res, 'progress', {
      status: job.status,
      percent: job.percent,
      label: job.label,
    });
    this.extractor.sendSse(res, 'pause_state', job.pauseState);
    this.extractor.sendSse(res, 'preview', job.preview);
    for (const entry of job.logs) {
      this.extractor.sendSse(res, 'log', entry);
    }
    if (job.status === 'completed') {
      this.extractor.sendSse(res, 'done', { status: 'completed', result: job.result });
    } else if (job.status === 'stopped') {
      this.extractor.sendSse(res, 'stopped', { status: 'stopped', result: job.result });
    } else if (job.status === 'error') {
      this.extractor.sendSse(res, 'error', { status: 'error', error: job.error });
    }

    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
  }

  @Post('stop')
  async stop(@Body() body?: { jobId?: string }) {
    const job = await this.extractor.stopJob(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, status: job.status };
  }

  @Post('pause')
  pause(@Body() body?: { jobId?: string }) {
    const job = this.extractor.pauseJob(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Post('resume')
  resume(@Body() body?: { jobId?: string }) {
    const job = this.extractor.resumeJob(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Post('skip-current')
  skipCurrent(@Body() body?: { jobId?: string }) {
    const job = this.extractor.skipCurrent(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, ok: true };
  }

  @Post('reset-session')
  async resetSession(@Body() body?: { jobId?: string }) {
    const job = await this.extractor.resetSession(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, ok: true };
  }

  @Post('update-proxy')
  async updateProxy(@Body() body?: { proxyUrl?: string; jobId?: string }) {
    const job = await this.extractor.updateProxy(body?.proxyUrl, body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Get('download-file/:bundleName/:fileName')
  downloadBundleFile(
    @Param('bundleName') bundleName: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const safeBundle = path.basename(bundleName);
    const safeFile = path.basename(fileName);
    const fullPath = path.join(this.appConfig.outputDir, safeBundle, safeFile);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Không tìm thấy file trong thư mục bundle.');
    }
    return res.download(fullPath, safeFile);
  }

  @Get('download-zip/:zipFileName')
  downloadBundleZip(@Param('zipFileName') zipFileName: string, @Res() res: Response) {
    const safeZip = path.basename(zipFileName);
    const fullPath = path.join(this.appConfig.outputDir, safeZip);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundException('Không tìm thấy file .zip.');
    }
    return res.download(fullPath, safeZip);
  }
}
