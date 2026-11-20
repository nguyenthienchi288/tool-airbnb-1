"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HostParserService = void 0;
const common_1 = require("@nestjs/common");
const helpers_1 = require("../../common/helpers");
let HostParserService = class HostParserService {
    async collectHostRoomIds(page, hostUrl, onNavigated) {
        const response = await page.goto(hostUrl, { timeout: 60000, waitUntil: 'commit' });
        if (onNavigated) {
            await onNavigated(response);
        }
        await page.waitForSelector('a[href*="/rooms/"]', { timeout: 20000 }).catch(() => null);
        await (0, helpers_1.sleep)(1500);
        const viewAllBtn = page.locator("button:has-text('View all'), a:has-text('View all')").first();
        if ((await viewAllBtn.count()) > 0) {
            try {
                await viewAllBtn.click({ timeout: 3000 });
                await (0, helpers_1.sleep)(1800);
            }
            catch {
            }
        }
        const dialog = page.locator('[role="dialog"]').first();
        const hasDialog = (await dialog.count()) > 0;
        const container = hasDialog ? dialog : page;
        let prevCount = -1;
        for (let i = 0; i < 15; i++) {
            const links = await container.locator('a[href*="/rooms/"]').all();
            if (links.length === prevCount) {
                const showMore = container.locator("button:has-text('Show more')").first();
                if ((await showMore.count()) > 0 && (await showMore.isVisible().catch(() => false))) {
                    try {
                        await showMore.click({ timeout: 3000 });
                        await (0, helpers_1.sleep)(1400);
                        continue;
                    }
                    catch {
                        break;
                    }
                }
                break;
            }
            prevCount = links.length;
            try {
                if (hasDialog) {
                    await dialog.evaluate((el) => el.scrollBy(0, 1500));
                }
                else {
                    await page.mouse.wheel(0, 1500);
                }
                await (0, helpers_1.sleep)(700);
            }
            catch {
                break;
            }
        }
        const finalLinks = await container.locator('a[href*="/rooms/"]').all();
        const roomIds = [];
        const seen = new Set();
        for (const link of finalLinks) {
            const href = (await link.getAttribute('href').catch(() => '')) || '';
            if (!href.includes('/rooms/'))
                continue;
            const roomId = href.split('/rooms/')[1]?.split('?')[0] || '';
            if (/^\d+$/.test(roomId) && !seen.has(roomId)) {
                seen.add(roomId);
                roomIds.push(roomId);
            }
        }
        return roomIds;
    }
};
exports.HostParserService = HostParserService;
exports.HostParserService = HostParserService = __decorate([
    (0, common_1.Injectable)()
], HostParserService);
//# sourceMappingURL=host-parser.service.js.map