import './common/time/utc';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';
import { buildOpenApi } from './swagger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app, {
    trustProxy: app.get<ConfigService<Env, true>>(ConfigService).get('TRUST_PROXY', { infer: true }),
  });

  SwaggerModule.setup('docs', app, buildOpenApi(app));

  await app.listen(app.get<ConfigService<Env, true>>(ConfigService).get('API_PORT', { infer: true }));
}

void bootstrap();
