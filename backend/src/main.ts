import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({
    origin: true,
    credentials: true,
  });

  const config = app.get(AppConfigService);
  const port = config.port;
  await app.listen(port, '0.0.0.0');

  console.log(`\n============================================================`);
  console.log(` Airbnb Market NestJS Backend dang chay tai: http://localhost:${port}`);
  console.log(` SQLite DB : ${config.dbPath}`);
  console.log(` Output Dir: ${config.outputDir}`);
  console.log(`============================================================\n`);
}
void bootstrap();
