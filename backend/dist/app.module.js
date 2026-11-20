"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AppModule = void 0;
const common_1 = require("@nestjs/common");
const app_controller_1 = require("./app.controller");
const app_config_module_1 = require("./config/app-config.module");
const buildings_module_1 = require("./modules/buildings/buildings.module");
const database_module_1 = require("./modules/database/database.module");
const deep_link_extractor_module_1 = require("./modules/deep-link-extractor/deep-link-extractor.module");
const exporter_module_1 = require("./modules/exporter/exporter.module");
const jobs_module_1 = require("./modules/jobs/jobs.module");
const parser_module_1 = require("./modules/parser/parser.module");
const scraper_module_1 = require("./modules/scraper/scraper.module");
let AppModule = class AppModule {
};
exports.AppModule = AppModule;
exports.AppModule = AppModule = __decorate([
    (0, common_1.Module)({
        imports: [
            app_config_module_1.AppConfigModule,
            database_module_1.DatabaseModule,
            parser_module_1.ParserModule,
            scraper_module_1.ScraperModule,
            exporter_module_1.ExporterModule,
            buildings_module_1.BuildingsModule,
            jobs_module_1.JobsModule,
            deep_link_extractor_module_1.DeepLinkExtractorModule,
        ],
        controllers: [app_controller_1.AppController],
    })
], AppModule);
//# sourceMappingURL=app.module.js.map