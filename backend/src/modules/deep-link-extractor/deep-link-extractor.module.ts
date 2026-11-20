import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ParserModule } from '../parser/parser.module';
import { ScraperModule } from '../scraper/scraper.module';
import { AiEnrichmentService } from './ai-enrichment.service';
import { DeepLinkExtractorController } from './deep-link-extractor.controller';
import { DeepLinkExtractorService } from './deep-link-extractor.service';

@Module({
  imports: [DatabaseModule, ParserModule, ScraperModule],
  controllers: [DeepLinkExtractorController],
  providers: [DeepLinkExtractorService, AiEnrichmentService],
})
export class DeepLinkExtractorModule {}
