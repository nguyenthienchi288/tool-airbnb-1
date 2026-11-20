import { Module } from '@nestjs/common';
import { ExporterModule } from '../exporter/exporter.module';
import { ScraperModule } from '../scraper/scraper.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [ScraperModule, ExporterModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
