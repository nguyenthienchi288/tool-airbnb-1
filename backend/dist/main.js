"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const app_module_1 = require("./app.module");
const app_config_service_1 = require("./config/app-config.service");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule);
    app.enableCors({
        origin: true,
        credentials: true,
    });
    const config = app.get(app_config_service_1.AppConfigService);
    const port = config.port;
    await app.listen(port, '0.0.0.0');
    console.log(`\n============================================================`);
    console.log(` Airbnb Market NestJS Backend dang chay tai: http://localhost:${port}`);
    console.log(` SQLite DB : ${config.dbPath}`);
    console.log(` Output Dir: ${config.outputDir}`);
    console.log(`============================================================\n`);
}
void bootstrap();
//# sourceMappingURL=main.js.map