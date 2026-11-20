import { Module } from '@nestjs/common';
import { ParserModule } from '../parser/parser.module';
import { ScraperModule } from '../scraper/scraper.module';
import { DeepLinkExtractorController } from './deep-link-extractor.controller';
import { DeepLinkExtractorService } from './deep-link-extractor.service';

@Module({
  imports: [ParserModule, ScraperModule],
  controllers: [DeepLinkExtractorController],
  providers: [DeepLinkExtractorService],
})
export class DeepLinkExtractorModule {}
