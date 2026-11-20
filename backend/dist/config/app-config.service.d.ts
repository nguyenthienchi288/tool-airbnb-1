import { ConfigService } from '@nestjs/config';
import { ProxyConfig } from '../common/types';
export declare class AppConfigService {
    private readonly configService;
    readonly projectRoot: string;
    constructor(configService: ConfigService);
    private resolveFromRoot;
    get port(): number;
    get headless(): boolean;
    get slowMo(): number;
    get pageTimeoutMs(): number;
    get minDelayMs(): number;
    get maxDelayMs(): number;
    get proxy(): ProxyConfig | undefined;
    get geocoderProvider(): string;
    get googlePlacesApiKey(): string;
    get nominatimUserAgent(): string;
    get dbPath(): string;
    get outputDir(): string;
    get chromeProfileDir(): string;
}
