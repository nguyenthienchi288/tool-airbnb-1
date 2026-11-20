"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ScraperModule = void 0;
const common_1 = require("@nestjs/common");
const database_module_1 = require("../database/database.module");
const exporter_module_1 = require("../exporter/exporter.module");
const parser_module_1 = require("../parser/parser.module");
const browser_controller_1 = require("./browser.controller");
const browser_service_1 = require("./browser.service");
const scraper_service_1 = require("./scraper.service");
let ScraperModule = class ScraperModule {
};
exports.ScraperModule = ScraperModule;
exports.ScraperModule = ScraperModule = __decorate([
    (0, common_1.Module)({
        imports: [database_module_1.DatabaseModule, parser_module_1.ParserModule, exporter_module_1.ExporterModule],
        controllers: [browser_controller_1.BrowserController],
        providers: [browser_service_1.BrowserService, scraper_service_1.ScraperService],
        exports: [scraper_service_1.ScraperService, browser_service_1.BrowserService],
    })
], ScraperModule);
//# sourceMappingURL=scraper.module.js.map