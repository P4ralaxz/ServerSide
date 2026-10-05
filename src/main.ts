import './common/time/utc';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { Env } from './config/env';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);

  const doc = new DocumentBuilder()
    .setTitle('ระบบแจ้งซ่อมหอพักมหาวิทยาลัย')
    .setDescription('Backend REST API — NestJS + PostgreSQL')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, doc));

  await app.listen(app.get<ConfigService<Env, true>>(ConfigService).get('API_PORT', { infer: true }));
}

void bootstrap();
