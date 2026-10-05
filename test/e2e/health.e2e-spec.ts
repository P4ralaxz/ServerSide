import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from '../setup/app';

describe('health', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  // @parity test_smoke.py::test_health_endpoint
  it('GET /health ตอบ 200 เมื่อแอปและ DB พร้อม', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', db: 'up' });
  });

  it('path ที่ไม่มี ตอบ 404 ในรูปแบบ error เดียวกับทั้งระบบ', async () => {
    const res = await request(app.getHttpServer()).get('/no-such-path').expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, error: 'Not Found', code: 'NOT_FOUND' });
    expect(typeof res.body.message).toBe('string');
  });
});
