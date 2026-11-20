"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppConfigService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("@nestjs/config");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
let AppConfigService = class AppConfigService {
    configService;
    projectRoot;
    constructor(configService) {
        this.configService = configService;
        const cwd = process.cwd();
        if (fs.existsSync(path.join(cwd, 'backend')) && fs.existsSync(path.join(cwd, '.env'))) {
            this.projectRoot = cwd;
        }
        else if (fs.existsSync(path.join(cwd, '..', '.env')) || path.basename(cwd) === 'backend') {
            this.projectRoot = path.resolve(cwd, '..');
        }
        else {
            this.projectRoot = path.resolve(__dirname, '..', '..', '..');
        }
    }
    resolveFromRoot(p) {
        if (path.isAbsolute(p))
            return p;
        return path.resolve(this.projectRoot, p);
    }
    get port() {
        return Number(this.configService.get('PORT') || 3000);
    }
    get headless() {
        return this.configService.get('HEADLESS') !== 'false';
    }
    get slowMo() {
        return Number(this.configService.get('SLOW_MO') || 50);
    }
    get pageTimeoutMs() {
        return Number(this.configService.get('PAGE_TIMEOUT_MS') || 45000);
    }
    get minDelayMs() {
        return Number(this.configService.get('MIN_DELAY_MS') || 250);
    }
    get maxDelayMs() {
        return Number(this.configService.get('MAX_DELAY_MS') || 600);
    }
    get proxy() {
        const server = this.configService.get('PROXY_SERVER')?.trim();
        if (!server)
            return undefined;
        return {
            server,
            username: this.configService.get('PROXY_USERNAME')?.trim() || undefined,
            password: this.configService.get('PROXY_PASSWORD')?.trim() || undefined,
        };
    }
    get geocoderProvider() {
        return (this.configService.get('GEOCODER_PROVIDER') || 'nominatim').toLowerCase();
    }
    get googlePlacesApiKey() {
        return this.configService.get('GOOGLE_PLACES_API_KEY') || '';
    }
    get nominatimUserAgent() {
        return (this.configService.get('NOMINATIM_USER_AGENT') ||
            'AirbnbMarketResearchCLI/2.0 (ota-arbitrage-tool)');
    }
    get dbPath() {
        return this.resolveFromRoot(this.configService.get('DB_PATH') || './data/airbnb_market.db');
    }
    get outputDir() {
        return this.resolveFromRoot(this.configService.get('OUTPUT_DIR') || './output');
    }
    get chromeProfileDir() {
        return this.resolveFromRoot(this.configService.get('CHROME_PROFILE_DIR') || './data/chrome_vpn_profile');
    }
};
exports.AppConfigService = AppConfigService;
exports.AppConfigService = AppConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [config_1.ConfigService])
], AppConfigService);
//# sourceMappingURL=app-config.service.js.map