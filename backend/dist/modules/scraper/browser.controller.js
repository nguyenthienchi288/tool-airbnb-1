"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BrowserController = void 0;
const common_1 = require("@nestjs/common");
const helpers_1 = require("../../common/helpers");
const browser_service_1 = require("./browser.service");
let BrowserController = class BrowserController {
    browserService;
    constructor(browserService) {
        this.browserService = browserService;
    }
    async openSetupBrowser(body) {
        const warpProxy = body?.useWarpProxy
            ? { server: 'socks5://127.0.0.1:40000' }
            : undefined;
        const proxyOverride = (0, helpers_1.parseProxyUrl)(body?.proxyUrl) || warpProxy;
        const res = await this.browserService.openSetupBrowser(proxyOverride);
        return {
            ok: true,
            channelUsed: res.channelUsed,
            profileDir: res.profileDir,
            message: 'Đã mở Chrome với Hồ sơ VPN cố định! Hãy cài/bật VPN Extension rồi đóng cửa sổ để lưu.',
        };
    }
    async checkIp() {
        return this.browserService.checkIpTrace();
    }
};
exports.BrowserController = BrowserController;
__decorate([
    (0, common_1.Post)('open-setup'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], BrowserController.prototype, "openSetupBrowser", null);
__decorate([
    (0, common_1.Get)('check-ip'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], BrowserController.prototype, "checkIp", null);
exports.BrowserController = BrowserController = __decorate([
    (0, common_1.Controller)('api/browser'),
    __metadata("design:paramtypes", [browser_service_1.BrowserService])
], BrowserController);
//# sourceMappingURL=browser.controller.js.map