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
import { JobsService } from './jobs.service';

@Controller('api/jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Get('active')
  getActiveJob() {
    const active = this.jobsService.getActiveJob();
    if (!active) return { activeJob: null };
    return {
      activeJob: {
        jobId: active.jobId,
        status: active.status,
        percent: active.percent,
        label: active.label,
        createdAt: active.createdAt,
        pauseState: active.pauseState,
      },
    };
  }

  @Post('start')
  startJob(@Body() body: any) {
    const active = this.jobsService.getActiveJob();
    if (active) {
      throw new ConflictException({
        error: 'Đang có tiến trình chạy. Vui lòng dừng trước khi bắt đầu lượt mới.',
        activeJobId: active.jobId,
      });
    }

    const cityName = String(body?.cityName || '').trim();
    const checkIn = String(body?.checkIn || '').trim();
    const checkOut = String(body?.checkOut || '').trim();
    const keywords = Array.isArray(body?.keywords)
      ? body.keywords.map((k: any) => String(k || '').trim()).filter(Boolean)
      : undefined;
    const dateWindows = Array.isArray(body?.dateWindows)
      ? body.dateWindows
          .filter((w: any) => w && typeof w === 'object')
          .map((w: any) => ({
            checkIn: String(w.checkIn || '').trim(),
            checkOut: String(w.checkOut || '').trim(),
            label: w.label ? String(w.label).trim() : undefined,
          }))
      : undefined;
    const autoGenerateStrategicDates = Boolean(body?.autoGenerateStrategicDates);
    const includeFlexibleDates = Boolean(body?.includeFlexibleDates);

    const hasAnyDateSource =
      (checkIn && checkOut) ||
      (dateWindows && dateWindows.some((w: any) => w.checkIn && w.checkOut)) ||
      autoGenerateStrategicDates ||
      includeFlexibleDates;

    if (!cityName || !hasAnyDateSource) {
      throw new BadRequestException(
        'Vui lòng nhập Thành phố/Khu vực và ít nhất 1 khung ngày Check-in/Check-out (hoặc bật Tự động sinh khung ngày / Flexible).',
      );
    }

    const job = this.jobsService.startJob({
      cityName,
      keywords,
      checkIn,
      checkOut,
      dateWindows,
      autoGenerateStrategicDates,
      includeFlexibleDates,
      maxPages: Math.max(1, Math.min(30, Number(body?.maxPages || 15))),
      tabsCount: Math.max(1, Math.min(6, Number(body?.tabsCount || 2))),
      humanLikeMode: body?.humanLikeMode !== false,
      enablePriceSlicing: body?.enablePriceSlicing !== false,
      priceBucketsText: body?.priceBucketsText ? String(body.priceBucketsText) : undefined,
      entireHomeOnly: body?.entireHomeOnly !== false,
      includeHostRooms: body?.includeHostRooms !== false,
      proxyUrl: body?.proxyUrl ? String(body.proxyUrl).trim() : undefined,
      useWarpProxy: Boolean(body?.useWarpProxy),
    });

    return { jobId: job.jobId, status: job.status };
  }

  @Get(':jobId/stream')
  streamJob(@Param('jobId') jobId: string, @Req() req: Request, @Res() res: Response) {
    const job = this.jobsService.getJob(jobId);
    if (!job) throw new NotFoundException('Không tìm thấy jobId.');

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    this.jobsService.sendSse(res, 'progress', {
      status: job.status,
      percent: job.percent,
      label: job.label,
    });
    this.jobsService.sendSse(res, 'pause_state', job.pauseState);
    for (const entry of job.logs) {
      this.jobsService.sendSse(res, 'log', entry);
    }

    if (job.status === 'completed') {
      this.jobsService.sendSse(res, 'done', { status: 'completed', result: job.result });
    } else if (job.status === 'stopped') {
      this.jobsService.sendSse(res, 'stopped', { status: 'stopped' });
    } else if (job.status === 'error') {
      this.jobsService.sendSse(res, 'error', { status: 'error', error: job.error });
    }

    job.clients.add(res);
    req.on('close', () => {
      job.clients.delete(res);
    });
  }

  @Post('stop')
  async stopActiveJob() {
    const job = await this.jobsService.stopJob();
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, status: job.status };
  }

  @Post(':jobId/stop')
  async stopJob(@Param('jobId') jobId: string) {
    const job = await this.jobsService.stopJob(jobId);
    if (!job) throw new NotFoundException('Không tìm thấy jobId.');
    return { jobId: job.jobId, status: job.status };
  }

  @Post('pause')
  pauseActiveJob(@Body() body?: { jobId?: string }) {
    const job = this.jobsService.pauseJob(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Post('resume')
  resumeActiveJob(@Body() body?: { jobId?: string }) {
    const job = this.jobsService.resumeJob(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Post('update-proxy')
  async updateProxy(@Body() body?: { proxyUrl?: string; jobId?: string }) {
    const job = await this.jobsService.updateProxy(body?.proxyUrl, body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, pauseState: job.pauseState };
  }

  @Post('reset-session')
  async resetSession(@Body() body?: { jobId?: string }) {
    const job = await this.jobsService.resetSession(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, ok: true };
  }

  @Post('skip-current')
  skipCurrent(@Body() body?: { jobId?: string }) {
    const job = this.jobsService.skipCurrent(body?.jobId);
    if (!job) throw new NotFoundException('Không có tiến trình nào đang chạy.');
    return { jobId: job.jobId, ok: true };
  }
}
