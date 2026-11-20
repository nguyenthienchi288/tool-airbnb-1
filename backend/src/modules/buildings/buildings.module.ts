import { Module } from '@nestjs/common';
import { ExporterModule } from '../exporter/exporter.module';
import { BuildingsController } from './buildings.controller';
import { BuildingsService } from './buildings.service';

@Module({
  imports: [ExporterModule],
  controllers: [BuildingsController],
  providers: [BuildingsService],
})
export class BuildingsModule {}
