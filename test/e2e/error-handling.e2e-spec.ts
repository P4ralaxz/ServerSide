import { Body, Controller, Get, INestApplication, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { IsInt, IsString, Min } from 'class-validator';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { InvalidTransition } from '../../src/common/errors/domain-errors';
import { createTestApp } from '../setup/app';
import { openTestDb, truncateAll } from '../setup/truncate';

class ProbeDto {
  @IsString()
  title: string;

  @IsInt()
  @Min(1)
  floor: number;
}

// endpoint จำลองที่ปล่อย error ของ Postgres หลุดถึง controller ตรง ๆ
// ยังไม่มีโมดูลจริงในสัปดาห์ 1 แต่ filter ต้องพิสูจน์ได้ก่อนโมดูลแรกจะพึ่งมัน
@Controller('probe')
class ProbeController {
  constructor(private readonly ds: DataSource) {}

  @Post('unique')
  async unique(): Promise<void> {
    await this.ds.query(`INSERT INTO buildings (code, name) VALUES ('DUP', 'a')`);
    await this.ds.query(`INSERT INTO buildings (code, name) VALUES ('DUP', 'b')`);
  }

  @Post('fk')
  async fk(): Promise<void> {
    await this.ds.query(`INSERT INTO rooms (building_id, room_no, floor, capacity) VALUES ($1, '301', 3, 2)`, [
      randomUUID(),
    ]);
  }

  @Post('check')
  async check(): Promise<void> {
    await this.ds.query(`INSERT INTO users (email) VALUES ('secret-person@gmail.com')`);
  }

  @Post('bad-uuid')
  async badUuid(): Promise<void> {
    await this.ds.query(`SELECT * FROM tickets WHERE id = $1`, ['abc']);
  }

  @Post('bad-enum')
  async badEnum(): Promise<void> {
    await this.ds.query(`SELECT 'scheduled'::ticket_status`);
  }

  @Post('unmapped')
  async unmapped(): Promise<void> {
    await this.ds.query(`SELECT 1 / 0`);
  }

  @Post('crash')
  crash(): void {
    throw new Error('รายละเอียดภายในที่ห้ามหลุดออกไป');
  }

  @Post('domain')
  domain(): void {
    throw new InvalidTransition('open', 'closed');
  }

  @Post('validate')
  validate(@Body() dto: ProbeDto): ProbeDto {
    return dto;
  }

  @Get(':id')
  byId(@Param('id', ParseUUIDPipe) id: string): { id: string } {
    return { id };
  }
}

describe('error handling', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    app = await createTestApp([ProbeController]);
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(ds);
  });

  const post = (path: string, body?: object) => request(app.getHttpServer()).post(`/probe/${path}`).send(body);

  describe('DbErrorFilter', () => {
    it('23505 unique_violation → 409', async () => {
      const res = await post('unique').expect(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        code: 'UNIQUE_VIOLATION',
        message: expect.any(String),
        details: { constraint: 'uq_buildings_code' },
      });
    });

    it('23503 foreign_key_violation → 400', async () => {
      const res = await post('fk').expect(400);
      expect(res.body.code).toBe('FOREIGN_KEY_VIOLATION');
    });

    it('23514 check_violation → 400', async () => {
      const res = await post('check').expect(400);
      expect(res.body).toMatchObject({ code: 'CHECK_VIOLATION', details: { constraint: 'ck_users_email_domain' } });
    });

    it.each(['bad-uuid', 'bad-enum'])('22P02 (%s) → 400 ไม่ใช่ 500', async (path) => {
      const res = await post(path).expect(400);
      expect(res.body.code).toBe('INVALID_INPUT');
    });

    it('ไม่ส่งค่าในแถวที่ชนออกไปกับ error', async () => {
      const res = await post('check').expect(400);
      expect(JSON.stringify(res.body)).not.toContain('secret-person');
    });

    it('SQLSTATE ที่ไม่ได้ map → 500 โดยไม่เผยข้อความของ Postgres', async () => {
      const res = await post('unmapped').expect(500);
      expect(res.body).toEqual({
        statusCode: 500,
        error: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        message: expect.any(String),
      });
      expect(JSON.stringify(res.body)).not.toContain('division');
    });
  });

  describe('รูปแบบ body', () => {
    it('error ของโดเมนส่ง code + details ตามที่กำหนด', async () => {
      const res = await post('domain').expect(409);
      expect(res.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        code: 'INVALID_TRANSITION',
        message: expect.any(String),
        details: { from: 'open', to: 'closed' },
      });
    });

    it('exception ที่ไม่ได้คาดไว้ → 500 ไม่มีรายละเอียดภายใน', async () => {
      const res = await post('crash').expect(500);
      expect(res.body.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('ห้ามหลุด');
    });
  });

  describe('ValidationPipe', () => {
    it('ข้อมูลผิด → 400 VALIDATION_FAILED พร้อม details เป็น [{ field, reason }]', async () => {
      const res = await post('validate', { title: 'x', floor: 0 }).expect(400);
      expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', code: 'VALIDATION_FAILED' });
      expect(res.body.details).toEqual([{ field: 'floor', reason: expect.any(String) }]);
    });

    it('ฟิลด์ที่ไม่ได้ประกาศใน DTO → 400 (forbidNonWhitelisted)', async () => {
      const res = await post('validate', { title: 'x', floor: 1, role: 'admin' }).expect(400);
      expect(res.body.details).toEqual([{ field: 'role', reason: expect.any(String) }]);
    });

    it('ข้อมูลถูก → ผ่าน', async () => {
      await post('validate', { title: 'x', floor: 3 }).expect(201);
    });

    it('path param ที่ไม่ใช่ uuid → 400 ก่อนถึง DB', async () => {
      const res = await request(app.getHttpServer()).get('/probe/abc').expect(400);
      expect(res.body.statusCode).toBe(400);
      expect(typeof res.body.code).toBe('string');
    });
  });
});
