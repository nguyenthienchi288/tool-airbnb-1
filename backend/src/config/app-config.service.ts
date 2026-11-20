import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { ProxyConfig } from '../common/types';

@Injectable()
export class AppConfigService {
  readonly projectRoot: string;

  constructor(private readonly configService: ConfigService) {
    // Resolve monorepo root: whether running from backend/dist or backend/src or root
    const cwd = process.cwd();
    if (fs.existsSync(path.join(cwd, 'backend')) && fs.existsSync(path.join(cwd, '.env'))) {
      this.projectRoot = cwd;
    } else if (fs.existsSync(path.join(cwd, '..', '.env')) || path.basename(cwd) === 'backend') {
      this.projectRoot = path.resolve(cwd, '..');
    } else {
      this.projectRoot = path.resolve(__dirname, '..', '..', '..');
    }
  }

  private resolveFromRoot(p: string): string {
    if (path.isAbsolute(p)) return p;
    return path.resolve(this.projectRoot, p);
  }

  get port(): number {
    return Number(this.configService.get<string>('PORT') || 3000);
  }

  get headless(): boolean {
    return this.configService.get<string>('HEADLESS') !== 'false';
  }

  get slowMo(): number {
    return Number(this.configService.get<string>('SLOW_MO') || 50);
  }

  get pageTimeoutMs(): number {
    return Number(this.configService.get<string>('PAGE_TIMEOUT_MS') || 45000);
  }

  get minDelayMs(): number {
    return Number(this.configService.get<string>('MIN_DELAY_MS') || 250);
  }

  get maxDelayMs(): number {
    return Number(this.configService.get<string>('MAX_DELAY_MS') || 600);
  }

  get proxy(): ProxyConfig | undefined {
    const server = this.configService.get<string>('PROXY_SERVER')?.trim();
    if (!server) return undefined;
    return {
      server,
      username: this.configService.get<string>('PROXY_USERNAME')?.trim() || undefined,
      password: this.configService.get<string>('PROXY_PASSWORD')?.trim() || undefined,
    };
  }

  get geocoderProvider(): string {
    return (this.configService.get<string>('GEOCODER_PROVIDER') || 'nominatim').toLowerCase();
  }

  get googlePlacesApiKey(): string {
    return this.configService.get<string>('GOOGLE_PLACES_API_KEY') || '';
  }

  get nominatimUserAgent(): string {
    return (
      this.configService.get<string>('NOMINATIM_USER_AGENT') ||
      'AirbnbMarketResearchCLI/2.0 (ota-arbitrage-tool)'
    );
  }

  get dbPath(): string {
    return this.resolveFromRoot(
      this.configService.get<string>('DB_PATH') || './data/airbnb_market.db',
    );
  }

  get outputDir(): string {
    return this.resolveFromRoot(
      this.configService.get<string>('OUTPUT_DIR') || './output',
    );
  }

  get chromeProfileDir(): string {
    return this.resolveFromRoot(
      this.configService.get<string>('CHROME_PROFILE_DIR') || './data/chrome_vpn_profile',
    );
  }
}
