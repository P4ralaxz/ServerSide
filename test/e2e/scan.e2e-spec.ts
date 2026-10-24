import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TicketStatus } from '../../src/domain/enums';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;

// GET /scan/:qrToken (DESIGN 7.4) และ open_ticket ของ GET /assets (DESIGN 7.5)
// สองตัวนี้บอก "ใบที่เปิดอยู่ของครุภัณฑ์" — ต้องผ่าน canSee เสมอ ไม่งั้นสแกน/ไล่ดูห้องอื่นแล้วรู้ว่าห้องนั้นแจ้งอะไรไว้
describe('scan + open_ticket ของครุภัณฑ์', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: {
    d1: string;
    room1: string;
    room2: string;
    alice: string;
    roommate: string;
    bob: string;
    homeless: string;
    staff: string;
    admin: string;
    tech: string;
    ac1: string;
    tv1: string;
    ac2: string;
    lift1: string;
  };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });
  beforeEach(async () => {
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'S1');
    const room1 = await makeRoom(ds, d1, '401');
    const room2 = await makeRoom(ds, d1, '402');
    fx = {
      d1,
      room1,
      room2,
      alice: await makeUser(ds, { roomId: room1 }),
      roommate: await makeUser(ds, { roomId: room1 }),
      bob: await makeUser(ds, { roomId: room2 }),
      homeless: await makeUser(ds, {}),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      tech: await makeUser(ds, { role: 'technician' }),
      ac1: await makeAsset(ds, d1, room1, 'AC-401'),
      tv1: await makeAsset(ds, d1, room1, 'TV-401'),
      ac2: await makeAsset(ds, d1, room2, 'AC-402'),
      lift1: await makeAsset(ds, d1, null, 'LIFT-01'),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  // factory ตั้ง qr_token = `qr-<asset id>`
  const scan = async (userId: string, assetId: string) =>
    http()
      .get(`/scan/qr-${assetId}`)
      .set(await as(userId));
  const openTicket = async (assetId: string, status: TicketStatus = 'open', reporter = fx.alice) => {
    const [a]: { room_id: string | null }[] = await ds.query(`SELECT room_id FROM assets WHERE id = $1`, [assetId]);
    return makeTicket(ds, {
      assetId,
      reporterId: reporter,
      scope: a.room_id ? 'room' : 'common_area',
      roomId: a.room_id,
      status,
      permissionToEnter: a.room_id !== null,
      ...(status === 'open' ? {} : { assignedTo: fx.tech }),
      ...(status === 'resolved' ? { resolvedAt: new Date(Date.now() - HOUR) } : {}),
    });
  };

  describe('GET /scan/:qrToken', () => {
    // @parity test_qr_requires_login (ฝั่ง API) — ข้อมูลครุภัณฑ์ต้องมี token
    it('ต้อง login', async () => {
      expect((await http().get(`/scan/qr-${fx.ac1}`)).status).toBe(401);
    });

    // @parity test_unknown_code_is_404 · test_deleted_asset_has_no_qr
    it('QR ที่ไม่มี และครุภัณฑ์ที่ถูกลบ → 404 เหมือนกัน', async () => {
      expect(
        (
          await http()
            .get('/scan/nope')
            .set(await as(fx.alice))
        ).status,
      ).toBe(404);
      await ds.query(`UPDATE assets SET deleted_at = now() WHERE id = $1`, [fx.tv1]);
      expect((await scan(fx.alice, fx.tv1)).status).toBe(404);
    });

    it('ชิ้นในห้องตัวเองที่ยังไม่มีใบ: ข้อมูลครุภัณฑ์ครบ · open_ticket = null · can_report = true', async () => {
      const res = await scan(fx.alice, fx.ac1);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        asset: {
          id: fx.ac1,
          asset_code: 'AC-401',
          name: 'ครุภัณฑ์ทดสอบ',
          category: 'electrical',
          location_note: null,
          building: { id: fx.d1, name: 'อาคาร S1' },
          room: { id: fx.room1, room_no: '401' },
        },
        open_ticket: null,
        can_report: true,
      });
    });

    it('ผู้แจ้งสแกนชิ้นที่แจ้งไว้แล้ว: เห็นสถานะ · reported_by_me = true · ไม่มีปุ่มแจ้งซ้ำ', async () => {
      const t = await openTicket(fx.ac1);
      const res = await scan(fx.alice, fx.ac1);
      expect(res.body.open_ticket).toMatchObject({ id: t, status: 'open', reported_by_me: true });
      expect(res.body.open_ticket.actions).toEqual(['cancel']);
      expect(res.body.can_report).toBe(false);
    });

    it('รูมเมทสแกนชิ้นเดียวกัน: reported_by_me = false และมีปุ่มเจอปัญหาเดียวกัน', async () => {
      await openTicket(fx.ac1);
      const res = await scan(fx.roommate, fx.ac1);
      expect(res.body.open_ticket).toMatchObject({ reported_by_me: false, actions: ['same_issue'] });
      expect(res.body.can_report).toBe(false);
    });

    it('ใบที่รอยืนยัน: actions ของผู้พักมี confirm (หน้าจอใช้เลือกปุ่ม "ดูและยืนยันผลซ่อม")', async () => {
      await openTicket(fx.ac1, 'resolved');
      const res = await scan(fx.roommate, fx.ac1);
      expect(res.body.open_ticket.actions).toEqual(expect.arrayContaining(['confirm', 'reopen']));
    });

    // mutation check: ให้ /scan ส่ง open_ticket โดยไม่ผ่าน canSee แล้วเทสนี้ต้องแดง
    it('สแกน QR ของห้องอื่น: ไม่เห็นใบของห้องนั้น และไม่มีปุ่มแจ้ง', async () => {
      await openTicket(fx.ac2, 'in_progress', fx.bob);
      const res = await scan(fx.alice, fx.ac2);
      expect(res.status).toBe(200);
      expect(res.body.open_ticket).toBeNull();
      expect(res.body.can_report).toBe(false);
      expect(JSON.stringify(res.body)).not.toMatch(/TK-/);
    });

    it('ครุภัณฑ์ส่วนกลาง: นักศึกษาทุกห้องเห็นใบเดียวกัน · staff เห็นพร้อมปุ่มของ staff', async () => {
      await openTicket(fx.lift1, 'open', fx.bob);
      expect((await scan(fx.alice, fx.lift1)).body.open_ticket.actions).toEqual(['same_issue']);
      expect((await scan(fx.staff, fx.lift1)).body.open_ticket.actions).toEqual(['assign', 'reject', 'priority']);
    });

    it('ช่างเห็นใบของงานที่ตัวเองรับ แต่ไม่เห็นใบที่ยังไม่ได้มอบหมายให้ตัวเอง', async () => {
      await openTicket(fx.ac1, 'assigned');
      await openTicket(fx.lift1, 'open');
      expect((await scan(fx.tech, fx.ac1)).body.open_ticket).not.toBeNull();
      expect((await scan(fx.tech, fx.lift1)).body.open_ticket).toBeNull();
    });

    // mutation check: คิด can_report ด้วยเงื่อนไขชุดใหม่แทน canReport แล้วเทสนี้ต้องแดง
    // เทียบกับผลจริงของ POST /tickets ทุกคู่ (ผู้ใช้ × ครุภัณฑ์) — ไม่ได้เทียบกับค่าที่คาดเอง
    it('can_report ตรงกับผลของ POST /tickets ทุกคู่ผู้ใช้ × ครุภัณฑ์', async () => {
      const users = ['alice', 'bob', 'homeless', 'staff', 'admin', 'tech'] as const;
      const assets = ['ac1', 'ac2', 'lift1'] as const;
      const mismatches: string[] = [];
      for (const u of users) {
        for (const a of assets) {
          const scanned = await scan(fx[u], fx[a]);
          const post = await http()
            .post('/tickets')
            .set(await as(fx[u]))
            .send({ items: [{ asset_id: fx[a], title: 'ทดสอบ' }] });
          if (scanned.body.can_report !== (post.status === 201)) {
            mismatches.push(`${u} × ${a}: can_report=${scanned.body.can_report} แต่ POST ได้ ${post.status}`);
          }
          // คืนครุภัณฑ์ให้ว่างสำหรับคู่ถัดไป
          await ds.query(`UPDATE tickets SET deleted_at = now() WHERE deleted_at IS NULL`);
        }
      }
      expect(mismatches).toEqual([]);
    });

    it('มีใบเปิดอยู่แล้ว → can_report = false แม้คนนั้นจะแจ้งชิ้นนี้ได้ตามสิทธิ์', async () => {
      await openTicket(fx.lift1, 'resolved', fx.bob);
      expect((await scan(fx.staff, fx.lift1)).body.can_report).toBe(false);
    });
  });

  describe('GET /assets พร้อม open_ticket', () => {
    const assets = async (userId: string, qs = '') =>
      http()
        .get(`/assets${qs}`)
        .set(await as(userId));

    it('ห้องตัวเอง: ชิ้นที่มีใบเปิดแสดงสถานะ ชิ้นอื่นเป็น null', async () => {
      const t = await openTicket(fx.ac1, 'in_progress');
      const res = await assets(fx.roommate, `?room_id=${fx.room1}`);
      expect(res.status).toBe(200);
      const byCode = Object.fromEntries(
        (res.body as { asset_code: string; open_ticket: unknown }[]).map((a) => [a.asset_code, a.open_ticket]),
      );
      expect(byCode['AC-401']).toEqual({ id: t, ticket_no: expect.stringMatching(/^TK-/), status: 'in_progress' });
      expect(byCode['TV-401']).toBeNull();
    });

    it('ใบที่จบแล้วไม่นับเป็นใบเปิด — ชิ้นนั้นแจ้งใหม่ได้', async () => {
      await makeTicket(ds, {
        assetId: fx.ac1,
        reporterId: fx.alice,
        scope: 'room',
        roomId: fx.room1,
        status: 'cancelled',
      });
      const res = await assets(fx.alice, `?room_id=${fx.room1}`);
      expect(res.body.every((a: { open_ticket: unknown }) => a.open_ticket === null)).toBe(true);
    });

    it('นักศึกษาขอรายการของห้องอื่น → 403 · staff และช่างขอได้', async () => {
      expect((await assets(fx.alice, `?room_id=${fx.room2}`)).status).toBe(403);
      expect((await assets(fx.staff, `?room_id=${fx.room2}`)).status).toBe(200);
      expect((await assets(fx.tech, `?room_id=${fx.room2}`)).status).toBe(200);
    });

    it('ส่วนกลางขอได้ทุกคน และเห็นใบเปิดของส่วนกลาง', async () => {
      await openTicket(fx.lift1, 'open', fx.bob);
      const res = await assets(fx.alice, '?common_area=true');
      expect(res.status).toBe(200);
      expect(res.body[0].open_ticket).not.toBeNull();
    });

    // mutation check: ให้ /assets ส่ง open_ticket โดยไม่ผ่าน canSee แล้วเทสนี้ต้องแดง
    it('รายการทั้งหอ: ใบเปิดของห้องอื่นเป็น null สำหรับนักศึกษา แต่ staff เห็นทุกใบ', async () => {
      await openTicket(fx.ac2, 'open', fx.bob);
      const of = (body: { id: string; open_ticket: unknown }[]) => body.find((a) => a.id === fx.ac2)!.open_ticket;
      expect(of((await assets(fx.alice)).body)).toBeNull();
      expect(of((await assets(fx.staff)).body)).not.toBeNull();
    });
  });
});
