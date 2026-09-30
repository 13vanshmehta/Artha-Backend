import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureArthaApp } from './app.setup';
import { ValidatedEnvConfig } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureArthaApp(app);

  const configService = app.get(ConfigService<ValidatedEnvConfig, true>);
  const port = configService.get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
