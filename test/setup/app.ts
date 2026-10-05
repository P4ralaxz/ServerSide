import { INestApplication, Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';

// แอปตัวเดียวกับของจริง (pipe / filter ชุดเดียวกันผ่าน configureApp) ต่อกับ Postgres ของ Testcontainers
// extraControllers ใช้เฉพาะเทสที่ต้องมี endpoint จำลองไว้ยิง error ใส่ filter
export const createTestApp = async (extraControllers: Type[] = []): Promise<INestApplication> => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extraControllers,
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
};
