import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ExporterModule } from '../exporter/exporter.module';
import { ParserModule } from '../parser/parser.module';
import { BrowserController } from './browser.controller';
import { BrowserService } from './browser.service';
import { ScraperService } from './scraper.service';

@Module({
  imports: [DatabaseModule, ParserModule, ExporterModule],
  controllers: [BrowserController],
  providers: [BrowserService, ScraperService],
  exports: [ScraperService, BrowserService],
})
export class ScraperModule {}
