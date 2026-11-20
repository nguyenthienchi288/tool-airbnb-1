import { Module } from '@nestjs/common';
import { SevenNightsController } from './seven-nights.controller';
import { SevenNightsSyncService } from './seven-nights.service';

@Module({
  controllers: [SevenNightsController],
  providers: [SevenNightsSyncService],
})
export class SevenNightsModule {}
