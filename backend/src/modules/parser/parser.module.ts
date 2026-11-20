import { Module } from '@nestjs/common';
import { HostParserService } from './host-parser.service';
import { PdpParserService } from './pdp-parser.service';

@Module({
  providers: [PdpParserService, HostParserService],
  exports: [PdpParserService, HostParserService],
})
export class ParserModule {}
