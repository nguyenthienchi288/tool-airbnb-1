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
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeepLinkExtractorService = void 0;
const common_1 = require("@nestjs/common");
const uuid_1 = require("uuid");
const helpers_1 = require("../../common/helpers");
const app_config_service_1 = require("../../config/app-config.service");
const pdp_parser_service_1 = require("../parser/pdp-parser.service");
const host_parser_service_1 = require("../parser/host-parser.service");
const browser_service_1 = require("../scraper/browser.service");
const bundle_exporter_1 = require("./bundle-exporter");
const geo_enrichment_1 = require("./geo-enrichment");
const pdp_json_extractor_1 = require("./pdp-json-extractor");
const url_parser_1 = require("./url-parser");
class Blocked503Error extends Error {
    status;
    reason;
    constructor(status, reason) {
        super(reason);
        this.status = status;
        this.reason = reason;
        this.name = 'Blocked503Error';
    }
}
class SkipCurrentError extends Error {
    constructor() {
        super('SKIP_CURRENT');
        this.name = 'SkipCurrentError';
    }
}
class ContextRecreatedError extends Error {
    constructor() {
        super('CONTEXT_RECREATED');
        this.name = 'ContextRecreatedError';
    }
}
let DeepLinkExtractorService = class DeepLinkExtractorService {
    appConfig;
    browserService;
    pdpParser;
    hostParser;
    jobs = new Map();
    constructor(appConfig, browserService, pdpParser, hostParser) {
        this.appConfig = appConfig;
        this.browserService = browserService;
        this.pdpParser = pdpParser;
        this.hostParser = hostParser;
    }
    parseUrl(rawUrl) {
        return (0, url_parser_1.parseAirbnbSearchUrl)(rawUrl);
    }
    getJob(jobId) {
        return this.jobs.get(jobId);
    }
    getActiveJob() {
        for (const j of this.jobs.values()) {
            if (j.status === 'running')
                return j;
        }
        return undefined;
    }
    sendSse(res, event, data) {
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
        catch {
        }
    }
    broadcast(job, event, data) {
        for (const c of job.clients) {
            this.sendSse(c, event, data);
        }
    }
    pushLog(job, message, level = 'info') {
        const entry = {
            timestamp: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
            level,
            message,
        };
        job.logs.push(entry);
        if (job.logs.length > 500)
            job.logs.shift();
        this.broadcast(job, 'log', entry);
    }
    pushProgress(job, percent, label) {
        job.percent = Math.min(100, Math.max(0, Math.round(percent)));
        job.label = label;
        this.broadcast(job, 'progress', {
            status: job.status,
            percent: job.percent,
            label: job.label,
        });
    }
    startJob(input) {
        const parsed = (0, url_parser_1.parseAirbnbSearchUrl)(input.url);
        const job = {
            jobId: (0, uuid_1.v4)(),
            status: 'running',
            percent: 3,
            label: 'Đang khởi chạy trình duyệt Single-Tab (Chế độ chính xác 100%)...',
            logs: [],
            preview: { buildings: [], hosts: [], rooms: [] },
            abortController: new AbortController(),
            isStopRequested: false,
            clients: new Set(),
            pauseState: { status: 'running', countdownSeconds: 0 },
        };
        this.jobs.set(job.jobId, job);
        this.pushLog(job, `[Deep Extractor] Địa điểm: ${parsed.platformLocation.locationDisplay} | Khung tọa độ: ${parsed.mapBounds.hasBounds ? 'CÓ' : 'KHÔNG'} | Tải ảnh: ${input.downloadPhotos ? 'BẬT' : 'TẮT'}`, 'step');
        void this.runPipeline(job, parsed, input).catch((err) => {
            job.status = 'error';
            job.error = err?.message || 'Lỗi không xác định';
            this.pushLog(job, `[FAILED] ${job.error}`, 'error');
            this.broadcast(job, 'error', { status: 'error', error: job.error });
        });
        return job;
    }
    async stopJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (!job)
            return undefined;
        job.isStopRequested = true;
        job.abortController.abort();
        this.pushLog(job, '[Hệ thống] Đang dừng & đóng gói dữ liệu đã thu thập...', 'warn');
        await this.browserService.forceClose();
        if (job.activeBrowser) {
            await job.activeBrowser.close().catch(() => { });
            job.activeBrowser = undefined;
        }
        return job;
    }
    pauseJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (job && job.status === 'running')
            job.handlers?.pause();
        return job;
    }
    resumeJob(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (job && job.status === 'running')
            job.handlers?.resume();
        return job;
    }
    skipCurrent(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (job && job.status === 'running')
            job.handlers?.skipCurrent();
        return job;
    }
    async resetSession(jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (job && job.status === 'running')
            await job.handlers?.resetSession();
        return job;
    }
    async updateProxy(proxyUrl, jobId) {
        const job = jobId ? this.jobs.get(jobId) : this.getActiveJob();
        if (job && job.status === 'running')
            await job.handlers?.updateProxy(proxyUrl);
        return job;
    }
    async isBlockedOr503(page, response) {
        const st = response?.status() ?? 0;
        if (st === 503)
            return { blocked: true, status: 503, reason: 'HTTP 503 Service Unavailable' };
        if (st === 429)
            return { blocked: true, status: 429, reason: 'HTTP 429 Too Many Requests' };
        try {
            const [title, body, captchaCount] = await Promise.all([
                page.title().catch(() => ''),
                page.locator('body').innerText({ timeout: 1000 }).catch(() => ''),
                page
                    .locator('iframe[src*="arkose"], iframe[src*="captcha"], iframe[title*="challenge"], iframe[src*="recaptcha"]')
                    .count()
                    .catch(() => 0),
            ]);
            const combined = `${title}\n${body}`.toLowerCase();
            if (combined.includes('error code: 503') ||
                combined.includes('airbnb is temporarily unavailable') ||
                combined.includes('pardon our interruption') ||
                (combined.includes('stay tuned') && (combined.includes('airbnb') || combined.includes('unavailable')))) {
                return { blocked: true, status: 503, reason: 'Trang 503 (Stay tuned / Temporarily unavailable)' };
            }
            if (captchaCount > 0 || combined.includes('verify you are human') || combined.includes('arkose')) {
                return { blocked: true, status: 429, reason: 'Phát hiện Captcha / Robot check' };
            }
        }
        catch {
        }
        return { blocked: false, status: st, reason: '' };
    }
    extractAmenityFlags(amenities, description, houseRules) {
        const joined = amenities.join(' | ').toLowerCase();
        const fullText = `${joined}\n${description}\n${houseRules}`.toLowerCase();
        const hasExactOrSub = (kws) => (amenities.some((a) => {
            const al = a.toLowerCase();
            return kws.some((k) => al.includes(k));
        })
            ? 'YES'
            : 'NO');
        const poolYes = hasExactOrSub(['pool', 'hồ bơi', 'bể bơi', '泳池', '수영장']) === 'YES';
        const gymYes = hasExactOrSub(['gym', 'fitness', 'phòng tập', '健身房', '헬스', '피트니스']) === 'YES' ||
            /(?:피트니스|헬스장|fitness\s+center|gym\s+access)/i.test(description);
        let gymStr = gymYes ? 'YES' : 'NO';
        let gymFee = '';
        if (gymYes) {
            const gymSentenceMatch = `${description}\n${houseRules}`.match(/[^\n.]*(?:gym|fitness|헬스장|피트니스)[^\n.]*/i);
            if (gymSentenceMatch) {
                const sentence = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(gymSentenceMatch[0]);
                const hoursMatch = sentence.match(/(\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?\s*[-–~to]+\s*\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?)/);
                if (hoursMatch) {
                    gymStr = `YES, ${(0, pdp_json_extractor_1.normalizeUnicodeSpaces)(hoursMatch[1])}`;
                }
            }
            if (/(paid|fee|charge|extra\s*cost|pay\b|유료|별도\s*요금|결제|이용료|付费)/i.test(fullText)) {
                gymFee = 'Have to pay';
            }
            else if (/(free\s*gym|gym\s*is\s*free|complimentary\s*gym|무료\s*헬스|무료\s*피트니스|免费健身)/i.test(fullText)) {
                gymFee = 'Free';
            }
            else {
                gymFee = 'Check with host';
            }
        }
        let parking = 'NO';
        if (hasExactOrSub(['free parking', '무료 주차', '免费停车', 'miễn phí đỗ xe']) === 'YES' ||
            /(?:free\s*parking|무료\s*주차)/i.test(description)) {
            parking = 'yes, free parking';
        }
        else if (hasExactOrSub(['paid parking', 'parking', '유료 주차', '收费停车', '주차']) === 'YES' ||
            /(?:paid\s*parking|유료\s*주차|주차\s*가능)/i.test(description)) {
            parking = 'yes, payable parking';
        }
        return {
            airConditioner: hasExactOrSub([
                'air conditioning',
                'central air conditioning',
                'ac',
                '에어컨',
                '空调',
                'điều hòa',
            ]),
            hairDryer: hasExactOrSub(['hair dryer', '헤어드라이어', '吹风机', 'máy sấy tóc']),
            shampooBodyWash: hasExactOrSub([
                'shampoo',
                'body soap',
                'shower gel',
                '샴푸',
                '바디워시',
                '洗发水',
                '沐浴露',
            ]),
            towel: hasExactOrSub(['essentials', 'towels', 'towel', '수건', '毛巾', 'khăn tắm']),
            tv: hasExactOrSub(['tv', 'hdtv', 'television', '텔레비전', '电视', 'tivi']),
            wifi: hasExactOrSub(['wifi', 'wi-fi', 'pocket wifi', '무선 인터넷', '와이파이', '无线网络']),
            washingMachine: hasExactOrSub([
                'washer',
                'free washer',
                'paid washer',
                'washing machine',
                '세탁기',
                '洗衣机',
                'máy giặt',
            ]),
            kitchen: hasExactOrSub(['kitchen', 'kitchenette', '주방', '厨房', 'bếp']),
            basicCookingStaff: hasExactOrSub([
                'cooking basics',
                '기본 조리도구',
                '취사도구',
                '基本厨具',
                'dụng cụ nấu ăn',
            ]),
            swimmingPool: poolYes ? 'YES' : 'NO',
            gym: gymStr,
            gymFee,
            parking,
        };
    }
    inferRoomType(bedrooms, title) {
        if (bedrooms <= 0 || /\bstudio\b|원룸|one[\s-]?room/i.test(title)) {
            return bedrooms > 0 ? `${bedrooms}BR` : 'Studio';
        }
        return `${bedrooms}BR`;
    }
    extractDistrict(address, locationText, description) {
        const combined = `${address} ${locationText} ${description}`;
        const guMatch = combined.match(/\b([A-Za-z-]+-gu)\b/i);
        if (guMatch)
            return guMatch[1];
        const dongMatch = combined.match(/\b([A-Za-z-]+-dong)\b/i);
        if (dongMatch)
            return dongMatch[1];
        const quanMatch = combined.match(/\b(District\s+\d+|Quận\s+\d+|Bình Thạnh|Thảo Điền|Phú Nhuận|Tân Bình)\b/i);
        if (quanMatch)
            return quanMatch[1];
        return '';
    }
    extractSupplierAptCode(title, description) {
        const text = `${title} ${description}`;
        const match = text.match(/(?:#|Unit\s+|Apt\s+|Room\s+|\[)([A-Z]?-?\d{3,4}[A-Z]?)\]?\b|(\d{3,4}호)/i);
        return match ? match[0].replace(/[\[\]]/g, '').trim() : '';
    }
    async humanBrowseScroll(page, steps = 4) {
        for (let s = 0; s < steps; s++) {
            const dy = 450 + Math.floor(Math.random() * 250);
            await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), dy).catch(() => { });
            const mx = 220 + Math.floor(Math.random() * 900);
            const my = 180 + Math.floor(Math.random() * 500);
            await page.mouse.move(mx, my, { steps: 6 }).catch(() => { });
            await (0, helpers_1.randomDelay)(400, 800);
        }
    }
    collectPhotosFromObject(obj, out, depth = 0) {
        if (!obj || depth > 10 || out.size > 30)
            return;
        if (typeof obj === 'string') {
            if (/^https?:\/\/[^"'\s]*muscache\.com\/im\/pictures\//i.test(obj)) {
                const clean = obj.replace(/im_w=\d+/i, 'im_w=1200');
                out.add(clean);
            }
            return;
        }
        if (Array.isArray(obj)) {
            for (const item of obj)
                this.collectPhotosFromObject(item, out, depth + 1);
            return;
        }
        if (typeof obj === 'object') {
            for (const v of Object.values(obj)) {
                this.collectPhotosFromObject(v, out, depth + 1);
            }
        }
    }
    parseHouseRulesDetails(text) {
        const checkInMatch = text.match(/Check-in(?:\s+after|\s+is|\s*:)?\s*([^\n.;]+(?:AM|PM|:\d{2}))/i) ||
            text.match(/入住时间[：:]\s*([^\n]+)/i);
        const checkOutMatch = text.match(/Checkout(?:\s+before|\s+is|\s*:)?\s*([^\n.;]+(?:AM|PM|:\d{2}))/i) ||
            text.match(/Check-out(?:\s+before|\s+is|\s*:)?\s*([^\n.;]+(?:AM|PM|:\d{2}))/i) ||
            text.match(/退房时间[：:]\s*([^\n]+)/i);
        let childPolicy = '';
        if (/not suitable for (children|infants)/i.test(text)) {
            childPolicy = 'Not suitable for infants/children';
        }
        else if (/suitable for children/i.test(text) || /children welcome/i.test(text)) {
            childPolicy = 'Suitable for children';
        }
        return {
            checkInTime: checkInMatch ? (0, helpers_1.cleanControlChars)(checkInMatch[1]) : '',
            checkOutTime: checkOutMatch ? (0, helpers_1.cleanControlChars)(checkOutMatch[1]) : '',
            childPolicy,
        };
    }
    async runPipeline(job, parsed, input) {
        const warpProxy = input.useWarpProxy ? { server: 'socks5://127.0.0.1:40000' } : undefined;
        const proxyConfig = (0, helpers_1.parseProxyUrl)(input.proxyUrl) || warpProxy || this.appConfig.proxy;
        this.pushLog(job, '[Browser Tab 2] Đang mở cửa sổ Chrome for Testing (headless: false)...', 'step');
        let launched;
        try {
            launched = await this.browserService.launchTab2ChromeForTesting({
                proxyOverride: proxyConfig,
            });
        }
        catch (err) {
            this.pushLog(job, `[Browser Tab 2] Lỗi mở Chrome for Testing: ${err?.message || err}`, 'error');
            throw err;
        }
        let browser = launched.browser;
        let context = launched.context;
        job.activeBrowser = browser;
        let manualPaused = false;
        let pauseUntilMs = 0;
        let pauseReason = '';
        let isSwitchingContext = false;
        let contextGeneration = 0;
        let skipVersion = 0;
        let needsReset = false;
        const emitPause = () => {
            let status = 'running';
            let countdownSeconds = 0;
            if (manualPaused)
                status = 'paused';
            else if (Date.now() < pauseUntilMs) {
                status = 'paused_503';
                countdownSeconds = Math.max(1, Math.ceil((pauseUntilMs - Date.now()) / 1000));
            }
            job.pauseState = { status, countdownSeconds, reason: pauseReason || undefined };
            this.broadcast(job, 'pause_state', job.pauseState);
        };
        const waitIfPaused = async (myGen, mySkip) => {
            while (!job.abortController.signal.aborted) {
                if (mySkip !== undefined && skipVersion !== mySkip)
                    throw new SkipCurrentError();
                if (contextGeneration !== myGen)
                    throw new ContextRecreatedError();
                if (isSwitchingContext || manualPaused || Date.now() < pauseUntilMs) {
                    emitPause();
                    await (0, helpers_1.sleep)(400);
                    continue;
                }
                emitPause();
                break;
            }
        };
        const trigger503Cooldown = async (reason, myGen, mySkip) => {
            if (Date.now() >= pauseUntilMs && !manualPaused) {
                pauseUntilMs = Date.now() + 40000;
                pauseReason = reason;
                needsReset = true;
                this.pushLog(job, `[Cảnh báo 503/Captcha] ${reason} — Tạm dừng 40s để đổi IP / giải Captcha, sau đó bấm 'Tiếp tục ngay'!`, 'warn');
                emitPause();
            }
            await waitIfPaused(myGen, mySkip);
            if (needsReset && !job.abortController.signal.aborted) {
                needsReset = false;
                await this.browserService.resetSession(context);
            }
        };
        job.handlers = {
            pause: () => {
                manualPaused = true;
                pauseUntilMs = 0;
                pauseReason = 'Tạm dừng thủ công';
                emitPause();
            },
            resume: () => {
                manualPaused = false;
                pauseUntilMs = 0;
                pauseReason = '';
                emitPause();
            },
            resetSession: async () => {
                await this.browserService.resetSession(context);
                needsReset = false;
                this.pushLog(job, '[Session Reset] Đã xóa Cookie & làm mới phiên.', 'success');
            },
            skipCurrent: () => {
                skipVersion++;
                pauseUntilMs = 0;
                pauseReason = '';
                emitPause();
            },
            updateProxy: async (newProxyUrl) => {
                isSwitchingContext = true;
                try {
                    await context.close().catch(() => { });
                    await browser.close().catch(() => { });
                    const recreated = await this.browserService.launchTab2ChromeForTesting({
                        proxyOverride: (0, helpers_1.parseProxyUrl)(newProxyUrl),
                    });
                    browser = recreated.browser;
                    context = recreated.context;
                    job.activeBrowser = browser;
                    contextGeneration++;
                    manualPaused = false;
                    pauseUntilMs = 0;
                    pauseReason = '';
                    this.pushLog(job, `[Proxy] Đã chuyển Proxy mới (${recreated.channelUsed}).`, 'success');
                }
                finally {
                    isSwitchingContext = false;
                    emitPause();
                }
            },
        };
        const extractedRooms = [];
        const candidateMap = new Map();
        let page = await context.newPage();
        await page.bringToFront();
        this.pushLog(job, '[Browser Tab 2] Đã mở cửa sổ Chrome for Testing độc lập!', 'success');
        let myGen = contextGeneration;
        try {
            this.pushProgress(job, 8, 'Bước 1/3: Đang mở URL gốc & gom danh sách phòng trong khung bản đồ...');
            let apiBlock = null;
            const onSearchResp = (resp) => {
                try {
                    const st = resp.status();
                    if (st === 503 || st === 429) {
                        apiBlock = new Blocked503Error(st, `HTTP ${st}`);
                        return;
                    }
                    if (st !== 200)
                        return;
                    const u = resp.url();
                    if (!u.includes('StaysSearch') && !u.includes('ExploreLayout'))
                        return;
                    void resp
                        .json()
                        .then((json) => {
                        const items = this.pdpParser.extractSearchListingsFromJson(json, {
                            locationQuery: parsed.platformLocation.cityGuess,
                            checkIn: parsed.dates.checkIn,
                            checkOut: parsed.dates.checkOut,
                            nights: parsed.dates.nights,
                        });
                        for (const item of items) {
                            const prev = candidateMap.get(item.listing_id);
                            candidateMap.set(item.listing_id, {
                                listingId: item.listing_id,
                                lat: item.lat ?? prev?.lat ?? null,
                                lng: item.lng ?? prev?.lng ?? null,
                                pricePerNight: item.price_per_night || prev?.pricePerNight || 0,
                                totalPrice: item.total_price || prev?.totalPrice || 0,
                                rating: item.rating || prev?.rating || 0,
                                reviewsCount: item.reviews_count || prev?.reviewsCount || 0,
                            });
                        }
                    })
                        .catch(() => null);
                }
                catch {
                }
            };
            page.on('response', onSearchResp);
            await page.goto(parsed.originalUrl, { timeout: 60000, waitUntil: 'commit' });
            await page.bringToFront().catch(() => { });
            await (0, helpers_1.randomDelay)(3000, 4500);
            for (let p = 1; p <= 15; p++) {
                if (job.abortController.signal.aborted)
                    break;
                await waitIfPaused(myGen);
                if (apiBlock) {
                    await trigger503Cooldown(apiBlock.reason, myGen);
                    apiBlock = null;
                }
                const blk = await this.isBlockedOr503(page);
                if (blk.blocked) {
                    await trigger503Cooldown(blk.reason, myGen);
                    await page.reload({ timeout: 60000, waitUntil: 'commit' }).catch(() => { });
                    await (0, helpers_1.randomDelay)(3000, 4500);
                }
                await page
                    .waitForSelector('a[href*="/rooms/"], [data-testid="card-container"]', { timeout: 20000 })
                    .catch(() => null);
                await this.humanBrowseScroll(page, 4);
                const deferredRaw = await page
                    .locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]')
                    .first()
                    .innerText()
                    .catch(() => '');
                if (deferredRaw) {
                    try {
                        const deferredJson = JSON.parse(deferredRaw);
                        const items = this.pdpParser.extractSearchListingsFromJson(deferredJson, {
                            locationQuery: parsed.platformLocation.cityGuess,
                            checkIn: parsed.dates.checkIn,
                            checkOut: parsed.dates.checkOut,
                            nights: parsed.dates.nights,
                        });
                        for (const item of items) {
                            const prev = candidateMap.get(item.listing_id);
                            candidateMap.set(item.listing_id, {
                                listingId: item.listing_id,
                                lat: item.lat ?? prev?.lat ?? null,
                                lng: item.lng ?? prev?.lng ?? null,
                                pricePerNight: item.price_per_night || prev?.pricePerNight || 0,
                                totalPrice: item.total_price || prev?.totalPrice || 0,
                                rating: item.rating || prev?.rating || 0,
                                reviewsCount: item.reviews_count || prev?.reviewsCount || 0,
                            });
                        }
                    }
                    catch {
                    }
                }
                const hrefs = await page
                    .locator('a[href*="/rooms/"]')
                    .evaluateAll((els) => els.map((e) => e.getAttribute('href') || ''))
                    .catch(() => []);
                for (const h of hrefs) {
                    const rid = h.split('/rooms/')[1]?.split('?')[0] || '';
                    if (/^\d+$/.test(rid) && !candidateMap.has(rid)) {
                        candidateMap.set(rid, {
                            listingId: rid,
                            lat: null,
                            lng: null,
                            pricePerNight: 0,
                            totalPrice: 0,
                            rating: 0,
                            reviewsCount: 0,
                        });
                    }
                }
                this.pushLog(job, `[Bước 1] Trang ${p}: Đã phát hiện ${candidateMap.size} căn hộ từ URL bản đồ.`, 'info');
                const nextBtn = page
                    .locator('a[aria-label="Tiếp theo"], a[aria-label="Next"], a[aria-label="下一页"], a[aria-label="다음"]')
                    .first();
                if ((await nextBtn.count()) > 0 && (await nextBtn.isVisible().catch(() => false))) {
                    await nextBtn.scrollIntoViewIfNeeded().catch(() => { });
                    await (0, helpers_1.randomDelay)(2500, 4000);
                    await nextBtn.click({ timeout: 10000 }).catch(() => { });
                    await (0, helpers_1.randomDelay)(3000, 4500);
                }
                else {
                    break;
                }
            }
            page.off('response', onSearchResp);
            const candidates = Array.from(candidateMap.values()).filter((c) => {
                if (!input.strictBoundsOnly || !parsed.mapBounds.hasBounds)
                    return true;
                if (c.lat === null || c.lng === null)
                    return true;
                const check = (0, url_parser_1.checkBoundingBox)(c.lat, c.lng, parsed.mapBounds);
                return check.status === 'inside' || check.status === 'nearby';
            });
            this.pushLog(job, `[Bước 1 Hoàn tất] Tổng tìm thấy: ${candidateMap.size} căn • Sau lọc khung bản đồ: ${candidates.length} căn cần trích xuất sâu.`, 'step');
            for (let i = 0; i < candidates.length; i++) {
                if (job.abortController.signal.aborted)
                    break;
                const cand = candidates[i];
                const mySkip = skipVersion;
                for (let attempt = 0; attempt < 3; attempt++) {
                    if (job.abortController.signal.aborted)
                        break;
                    try {
                        await waitIfPaused(myGen, mySkip);
                        const pct = 20 + Math.round(((i + 1) / Math.max(1, candidates.length)) * 65);
                        this.pushProgress(job, pct, `Bước 2/3: Đang đọc sâu căn #${cand.listingId} (${i + 1}/${candidates.length})...`);
                        const pdpBase = parsed.platformLocation.origin.includes('airbnb.cn')
                            ? 'https://www.airbnb.com'
                            : parsed.platformLocation.origin;
                        const roomUrl = parsed.dates.checkIn && parsed.dates.checkOut
                            ? `${pdpBase}/rooms/${cand.listingId}?check_in=${parsed.dates.checkIn}&check_out=${parsed.dates.checkOut}&locale=en`
                            : `${pdpBase}/rooms/${cand.listingId}?locale=en`;
                        const pdpJsonRoots = [];
                        let bookItData = null;
                        let pdpBlock = null;
                        const onPdpResp = (resp) => {
                            try {
                                const st = resp.status();
                                if (st === 503 || st === 429) {
                                    pdpBlock = new Blocked503Error(st, `HTTP ${st} PDP`);
                                    return;
                                }
                                if (st !== 200)
                                    return;
                                const rUrl = resp.url();
                                if (rUrl.includes('StaysPdpBookItQuery')) {
                                    void resp.json().then((j) => { bookItData = j; }).catch(() => null);
                                }
                                else if (rUrl.includes('StaysPdpSections') ||
                                    rUrl.includes('AMENITIES_DEFAULT') ||
                                    rUrl.includes('HOUSE_RULES') ||
                                    rUrl.includes('LOCATION_DEFAULT') ||
                                    rUrl.includes('PHOTO_TOUR')) {
                                    void resp
                                        .json()
                                        .then((j) => {
                                        if (j)
                                            pdpJsonRoots.push(j);
                                    })
                                        .catch(() => null);
                                }
                            }
                            catch {
                            }
                        };
                        page.on('response', onPdpResp);
                        try {
                            const nav = await page.goto(roomUrl, { timeout: 60000, waitUntil: 'commit' });
                            await page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => { });
                            await (0, helpers_1.randomDelay)(4000, 5500);
                            if (pdpBlock)
                                throw pdpBlock;
                            const blk = await this.isBlockedOr503(page, nav);
                            if (blk.blocked)
                                throw new Blocked503Error(blk.status, blk.reason);
                            await page.waitForSelector('h1', { timeout: 15000 }).catch(() => null);
                            await this.humanBrowseScroll(page, 4);
                            const deferredRawList = await page
                                .locator('script#data-deferred-state-0, script[id^="data-deferred-state-"]')
                                .allInnerTexts()
                                .catch(() => []);
                            for (const rawStr of deferredRawList) {
                                try {
                                    if (rawStr)
                                        pdpJsonRoots.push(JSON.parse(rawStr));
                                }
                                catch {
                                }
                            }
                            let expandedDescription = '';
                            const descShowMoreBtn = page
                                .locator('[data-section-id="DESCRIPTION_DEFAULT"] button:has-text("Show more"), [data-section-id="DESCRIPTION_DEFAULT"] button:has-text("Hiển thị thêm"), [data-section-id="DESCRIPTION_DEFAULT"] button:has-text("显示更多")')
                                .first();
                            if ((await descShowMoreBtn.count()) > 0 && (await descShowMoreBtn.isVisible().catch(() => false))) {
                                await descShowMoreBtn.click({ timeout: 3000 }).catch(() => { });
                                await (0, helpers_1.sleep)(1500);
                                expandedDescription = await page
                                    .locator('[role="dialog"]')
                                    .first()
                                    .innerText({ timeout: 2000 })
                                    .catch(() => '');
                                await page.keyboard.press('Escape').catch(() => { });
                                await (0, helpers_1.sleep)(500);
                            }
                            const showAllAmenitiesBtn = page
                                .locator('[data-section-id="AMENITIES_DEFAULT"] button:has-text("Show all"), button:has-text("Hiển thị tất cả"), button:has-text("显示全部")')
                                .first();
                            if ((await showAllAmenitiesBtn.count()) > 0 && (await showAllAmenitiesBtn.isVisible().catch(() => false))) {
                                await showAllAmenitiesBtn.click({ timeout: 3000 }).catch(() => { });
                                await (0, helpers_1.sleep)(2000);
                                await page.keyboard.press('Escape').catch(() => { });
                                await (0, helpers_1.sleep)(500);
                            }
                            const rulesShowMoreBtn = page
                                .locator('[data-section-id="POLICIES_DEFAULT"] button:has-text("Show more"), [data-section-id="POLICIES_DEFAULT"] button:has-text("Hiển thị thêm"), [data-section-id="POLICIES_DEFAULT"] button:has-text("显示更多")')
                                .first();
                            if ((await rulesShowMoreBtn.count()) > 0 && (await rulesShowMoreBtn.isVisible().catch(() => false))) {
                                await rulesShowMoreBtn.click({ timeout: 3000 }).catch(() => { });
                                await (0, helpers_1.sleep)(1500);
                            }
                            const modalRulesText = await page
                                .locator('[role="dialog"]')
                                .first()
                                .innerText({ timeout: 1200 })
                                .catch(() => '');
                            if (modalRulesText) {
                                await page.keyboard.press('Escape').catch(() => { });
                                await (0, helpers_1.sleep)(500);
                            }
                            const sectionRulesText = await page
                                .locator('[data-section-id="POLICIES_DEFAULT"], section:has-text("House rules")')
                                .first()
                                .innerText({ timeout: 2000 })
                                .catch(() => '');
                            const houseRulesText = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(`${sectionRulesText}\n${modalRulesText}`);
                            const domGalleryPhotos = new Set();
                            const showPhotosBtn = page
                                .locator('button:has-text("Show all photos"), button:has-text("Hiển thị tất cả ảnh"), button:has-text("显示所有照片")')
                                .first();
                            if ((await showPhotosBtn.count()) > 0 && (await showPhotosBtn.isVisible().catch(() => false))) {
                                await showPhotosBtn.click({ timeout: 3000 }).catch(() => { });
                                await (0, helpers_1.sleep)(1800);
                                const galleryImgs = await page
                                    .locator('[role="dialog"] img[src*="muscache.com/im/pictures"], img[src*="muscache.com/im/pictures"]')
                                    .evaluateAll((els) => els.map((e) => e.getAttribute('src') || ''))
                                    .catch(() => []);
                                for (const pUrl of galleryImgs) {
                                    if (pUrl &&
                                        !/user|AirbnbPlatformAssets|search-bar-icons|orthographic-images/i.test(pUrl)) {
                                        domGalleryPhotos.add(pUrl.replace(/im_w=\d+/i, 'im_w=1200'));
                                    }
                                }
                                await page.keyboard.press('Escape').catch(() => { });
                                await (0, helpers_1.sleep)(500);
                            }
                            const structured = (0, pdp_json_extractor_1.extractStructuredPdpFromJson)(pdpJsonRoots);
                            const baseRecord = await this.pdpParser.extractFromPage({
                                page,
                                listingId: cand.listingId,
                                url: roomUrl,
                                locationQuery: parsed.platformLocation.cityGuess,
                                checkIn: parsed.dates.checkIn,
                                checkOut: parsed.dates.checkOut,
                                nights: parsed.dates.nights,
                                bookItData,
                            });
                            const finalLat = structured.lat ?? baseRecord?.lat ?? cand.lat;
                            const finalLng = structured.lng ?? baseRecord?.lng ?? cand.lng;
                            const boundsCheck = (0, url_parser_1.checkBoundingBox)(finalLat, finalLng, parsed.mapBounds);
                            if (input.strictBoundsOnly &&
                                parsed.mapBounds.hasBounds &&
                                boundsCheck.status === 'outside') {
                                this.pushLog(job, `[Lọc tọa độ] Bỏ qua căn #${cand.listingId} vì nằm ngoài khung bản đồ (${finalLat}, ${finalLng}).`, 'warn');
                                break;
                            }
                            const fullDescription = [
                                structured.description,
                                baseRecord?.description || '',
                                expandedDescription,
                                structured.gettingAround,
                            ]
                                .filter(Boolean)
                                .join('\n')
                                .trim();
                            const strictAvailableAmenities = structured.availableAmenities.length > 0
                                ? structured.availableAmenities
                                : baseRecord?.amenities || [];
                            const flags = this.extractAmenityFlags(strictAvailableAmenities, fullDescription, houseRulesText);
                            const rulesParsed = this.parseHouseRulesDetails(houseRulesText);
                            const finalCheckInTime = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(structured.checkInTime || rulesParsed.checkInTime || '');
                            const finalCheckOutTime = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(structured.checkOutTime || rulesParsed.checkOutTime || '');
                            const finalChildPolicy = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(structured.childPolicy || rulesParsed.childPolicy || '');
                            const hostId = structured.hostId || baseRecord?.host_id || '';
                            let hostName = (0, pdp_json_extractor_1.isValidHostName)(structured.hostName)
                                ? structured.hostName
                                : (0, pdp_json_extractor_1.isValidHostName)(baseRecord?.host_name || '')
                                    ? (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(baseRecord?.host_name || '')
                                    : '';
                            let hostTotalListings = 1;
                            if (hostId && !hostName) {
                                const profileUrl = `https://www.airbnb.com/users/profile/${hostId}?locale=en`;
                                await page.goto(profileUrl, { timeout: 45000, waitUntil: 'commit' }).catch(() => null);
                                await (0, helpers_1.randomDelay)(3000, 4000);
                                const h1Host = await page
                                    .locator('h1')
                                    .first()
                                    .innerText({ timeout: 3000 })
                                    .catch(() => '');
                                const cleanHostH1 = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(h1Host)
                                    .replace(/^(Hi,\s*I['’]m|I['’]m|About)\s+/i, '')
                                    .trim();
                                if ((0, pdp_json_extractor_1.isValidHostName)(cleanHostH1)) {
                                    hostName = cleanHostH1;
                                }
                            }
                            if (hostId) {
                                const hostShowUrl = `https://www.airbnb.com/users/show/${hostId}?locale=en`;
                                const hostRoomIds = await this.hostParser
                                    .collectHostRoomIds(page, hostShowUrl)
                                    .catch(() => []);
                                if (hostRoomIds.length > 0)
                                    hostTotalListings = hostRoomIds.length;
                                if (!hostName) {
                                    const h1Show = await page
                                        .locator('h1')
                                        .first()
                                        .innerText({ timeout: 2000 })
                                        .catch(() => '');
                                    const cleanShow = (0, pdp_json_extractor_1.normalizeUnicodeSpaces)(h1Show)
                                        .replace(/^(Hi,\s*I['’]m|I['’]m|About)\s+/i, '')
                                        .trim();
                                    if ((0, pdp_json_extractor_1.isValidHostName)(cleanShow))
                                        hostName = cleanShow;
                                }
                            }
                            const rawTitle = structured.title || baseRecord?.title || `Room ${cand.listingId}`;
                            const candidateBuilding = (!(0, geo_enrichment_1.isBlacklistedBuildingName)(baseRecord?.building_name || '')
                                ? baseRecord?.building_name || ''
                                : '') ||
                                (0, geo_enrichment_1.extractBuildingNameFromText)(`${rawTitle}\n${baseRecord?.subtitle || ''}\n${fullDescription}\n${hostName}`);
                            const finalPhotos = Array.from(new Set([...structured.photoUrls, ...domGalleryPhotos]));
                            const city = parsed.platformLocation.cityGuess || 'Seoul';
                            const country = parsed.platformLocation.countryGuess || 'South Korea';
                            const address = structured.locationSubtitle || baseRecord?.location_text || '';
                            const district = this.extractDistrict(address, structured.locationSubtitle, fullDescription);
                            const bedrooms = structured.bedrooms || baseRecord?.bedrooms || 0;
                            const beds = Math.max(1, structured.beds || baseRecord?.beds || 1);
                            const bathrooms = Math.max(1, structured.bathrooms || baseRecord?.bathrooms || 1);
                            const maxPeople = Math.max(1, structured.personCapacity || baseRecord?.guests || 2);
                            const deepRoom = {
                                listingId: cand.listingId,
                                url: roomUrl,
                                title: rawTitle,
                                subtitle: baseRecord?.subtitle || '',
                                description: fullDescription,
                                address,
                                district,
                                city,
                                country,
                                lat: finalLat,
                                lng: finalLng,
                                boundsStatus: boundsCheck.status,
                                boundsLabel: boundsCheck.label,
                                buildingName: candidateBuilding,
                                supplierApartmentCode: this.extractSupplierAptCode(rawTitle, `${fullDescription}\n${houseRulesText}`),
                                roomType: this.inferRoomType(bedrooms, rawTitle),
                                bedrooms,
                                beds,
                                bathrooms,
                                maxPeople,
                                pricePerNight: baseRecord?.price_per_night || cand.pricePerNight || 0,
                                totalPrice: baseRecord?.total_price || cand.totalPrice || 0,
                                cleaningFee: 0,
                                serviceFee: 0,
                                currency: baseRecord?.currency || 'VND',
                                rating: baseRecord?.rating || cand.rating || 0,
                                reviewsCount: baseRecord?.reviews_count || cand.reviewsCount || 0,
                                checkInTime: finalCheckInTime,
                                checkOutTime: finalCheckOutTime,
                                childPolicy: finalChildPolicy,
                                houseRulesText,
                                amenities: strictAvailableAmenities,
                                amenityFlags: flags,
                                photoUrls: finalPhotos,
                                localPhotoDir: '',
                                hostId,
                                hostName: hostName || `Host-${hostId || cand.listingId}`,
                                hostAirbnbLink: hostId ? `https://www.airbnb.com/users/profile/${hostId}` : '',
                                hostTotalListings,
                            };
                            extractedRooms.push(deepRoom);
                            job.preview = (0, bundle_exporter_1.buildSevenNightsPreview)(extractedRooms, city, input.downloadPhotos ? 'Photos' : '');
                            this.broadcast(job, 'preview', job.preview);
                            this.pushLog(job, `[${i + 1}/${candidates.length}] Đã trích xuất #${cand.listingId} ("${deepRoom.title.slice(0, 40)}...") | ${deepRoom.photoUrls.length} ảnh | ${boundsCheck.label}`, 'success');
                            break;
                        }
                        finally {
                            page.off('response', onPdpResp);
                        }
                    }
                    catch (err) {
                        if (err instanceof SkipCurrentError) {
                            this.pushLog(job, `[Bỏ qua] Đã bỏ qua căn #${cand.listingId} theo lệnh người dùng.`, 'warn');
                            break;
                        }
                        if (err instanceof ContextRecreatedError) {
                            await page.close().catch(() => { });
                            myGen = contextGeneration;
                            page = await this.browserService.newHumanPage(context);
                            attempt--;
                            continue;
                        }
                        if (err instanceof Blocked503Error) {
                            await trigger503Cooldown(err.reason, myGen, mySkip);
                            continue;
                        }
                        this.pushLog(job, `[Lỗi] Căn #${cand.listingId}: ${err?.message || err}`, 'warn');
                        break;
                    }
                }
            }
        }
        finally {
            await this.browserService.forceClose();
            await context.close().catch(() => { });
            await browser?.close().catch(() => { });
            job.activeBrowser = undefined;
        }
        if (extractedRooms.length > 0) {
            const buildingCounts = new Map();
            for (const r of extractedRooms) {
                if (r.buildingName && !(0, geo_enrichment_1.isBlacklistedBuildingName)(r.buildingName)) {
                    buildingCounts.set(r.buildingName, (buildingCounts.get(r.buildingName) || 0) + 1);
                }
            }
            let dominantBuilding = '';
            let maxCount = 0;
            for (const [bName, cnt] of buildingCounts.entries()) {
                if (cnt > maxCount) {
                    dominantBuilding = bName;
                    maxCount = cnt;
                }
            }
            if (dominantBuilding) {
                const firstDist = extractedRooms.find((r) => r.district)?.district || '';
                const firstCity = extractedRooms[0].city || 'Seoul';
                const addrHit = await (0, geo_enrichment_1.searchAddressByBuildingName)(dominantBuilding, firstDist, firstCity);
                for (const r of extractedRooms) {
                    if (!r.buildingName || (0, geo_enrichment_1.isBlacklistedBuildingName)(r.buildingName)) {
                        r.buildingName = dominantBuilding;
                    }
                    if (addrHit?.address)
                        r.address = addrHit.address;
                    if (addrHit?.district && !r.district)
                        r.district = addrHit.district;
                    if (addrHit?.city)
                        r.city = addrHit.city;
                    if (addrHit?.country)
                        r.country = addrHit.country;
                }
                this.pushLog(job, `[Tổng hợp Tòa nhà] Chốt tên tòa nhà chuẩn: "${dominantBuilding}"${addrHit?.address ? ` | Địa chỉ: ${addrHit.address}` : ''}`, 'step');
            }
            else {
                for (const r of extractedRooms) {
                    if (!r.address || r.address === r.city || !r.district || !r.buildingName) {
                        const rev = await (0, geo_enrichment_1.reverseGeocodeCoords)(r.lat, r.lng);
                        if (rev?.buildingName && !r.buildingName)
                            r.buildingName = rev.buildingName;
                        if (rev?.address && (!r.address || r.address === r.city))
                            r.address = rev.address;
                        if (rev?.district && !r.district)
                            r.district = rev.district;
                    }
                }
            }
        }
        this.pushProgress(job, 92, 'Bước 3/3: Đang xuất Excel 7Nights Global, tải ảnh & đóng gói .zip...');
        const bundle = await (0, bundle_exporter_1.exportSevenNightsBundle)({
            outputDir: this.appConfig.outputDir,
            locationLabel: parsed.platformLocation.cityGuess || 'Airbnb',
            rooms: extractedRooms,
            downloadPhotos: input.downloadPhotos,
            onLog: (m, l) => this.pushLog(job, m, l),
        });
        const result = {
            ...bundle,
            totalFound: candidateMap.size,
            totalExtracted: extractedRooms.length,
            stoppedEarly: job.isStopRequested,
        };
        job.result = result;
        job.preview = bundle.preview;
        job.status = job.isStopRequested ? 'stopped' : 'completed';
        this.pushProgress(job, 100, `Hoàn tất! Đã xuất ${bundle.sevenNightsExcelFile} & ${bundle.zipFileName}`);
        this.broadcast(job, job.isStopRequested ? 'stopped' : 'done', {
            status: job.status,
            result,
        });
    }
};
exports.DeepLinkExtractorService = DeepLinkExtractorService;
exports.DeepLinkExtractorService = DeepLinkExtractorService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [app_config_service_1.AppConfigService,
        browser_service_1.BrowserService,
        pdp_parser_service_1.PdpParserService,
        host_parser_service_1.HostParserService])
], DeepLinkExtractorService);
//# sourceMappingURL=deep-link-extractor.service.js.map