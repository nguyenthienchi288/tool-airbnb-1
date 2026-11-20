import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppConfigModule } from './config/app-config.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { DatabaseModule } from './modules/database/database.module';
import { DeepLinkExtractorModule } from './modules/deep-link-extractor/deep-link-extractor.module';
import { ExporterModule } from './modules/exporter/exporter.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { ParserModule } from './modules/parser/parser.module';
import { ScraperModule } from './modules/scraper/scraper.module';
import { SevenNightsModule } from './lark/seven-nights/seven-nights.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    ParserModule,
    ScraperModule,
    ExporterModule,
    BuildingsModule,
    JobsModule,
    DeepLinkExtractorModule,
    SevenNightsModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
