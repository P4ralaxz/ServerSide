import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TicketPriority, TicketStatus } from '../../src/domain/enums';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;

// ตัวกรองคิว + GET /tickets/queue-counts (DESIGN 7.6)
// ตัวเลขบนชิปต้องเท่ากับจำนวนรายการเมื่อกดชิปนั้น — คู่ param ข้างล่างเขียนตาม DESIGN ตรง ๆ
// ไม่อ่านจาก QUEUE_COUNTERS ในโค้ด: ถ้าโค้ดเปลี่ยนเงื่อนไขของตัวนับเอง เทสต้องจับได้
const PAIRS: Record<string, string> = {
  open_total: 'status=open&status=assigned&status=in_progress&status=pending_parts&status=resolved',
  unassigned: 'status=open',
  urgent: 'priority=urgent',
  disputed: 'disputed=true',
  reopened: 'reopened=true',
  common_pending_confirm: 'scope=common_area&status=resolved',
};

describe('คิวของ Staff', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: { d1: string; room1: string; alice: string; staff: string; admin: string; tech: string; tech2: string };

  beforeAll(async () => {
    ({ app } = await createTestApp());
    ds = await openTestDb();
  });
  afterAll(async () => {
    await ds.destroy();
    await app.close();
  });

  let seq = 0;
  const ticket = async (
    status: TicketStatus,
    o: {
      common?: boolean;
      priority?: TicketPriority;
      reopenCount?: number;
      disputed?: boolean;
      deleted?: boolean;
      tech?: string;
    } = {},
  ) => {
    const asset = await makeAsset(ds, fx.d1, o.common ? null : fx.room1, `Q-${++seq}`);
    const done = new Date(Date.now() - HOUR);
    return makeTicket(ds, {
      assetId: asset,
      reporterId: fx.alice,
      scope: o.common ? 'common_area' : 'room',
      roomId: o.common ? null : fx.room1,
      status,
      priority: o.priority ?? 'normal',
      reopenCount: o.reopenCount ?? 0,
      ...(status === 'open' || status === 'rejected' || status === 'cancelled'
        ? {}
        : { assignedTo: o.tech ?? fx.tech }),
      ...(status === 'resolved' || status === 'closed' ? { resolvedAt: done } : {}),
      ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
      ...(o.disputed ? { disputedAt: done } : {}),
      ...(o.deleted ? { deletedAt: new Date() } : {}),
    });
  };

  beforeEach(async () => {
    await truncateAll(ds);
    resetThrottle(app);
    const d1 = await makeBuilding(ds, 'Q1');
    const room1 = await makeRoom(ds, d1, '101');
    fx = {
      d1,
      room1,
      alice: await makeUser(ds, { roomId: room1 }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
      tech: await makeUser(ds, { role: 'technician' }),
      tech2: await makeUser(ds, { role: 'technician' }),
    };
    // คิวตัวอย่างที่มีทั้งกรณีที่ต้องนับและกรณีที่ต้องไม่นับของทุกตัวนับ
    await ticket('open');
    await ticket('open', { priority: 'urgent', common: true });
    await ticket('assigned', { priority: 'urgent' });
    await ticket('assigned', { reopenCount: 1 });
    await ticket('in_progress', { reopenCount: 2, tech: fx.tech2 });
    await ticket('pending_parts');
    await ticket('resolved', { common: true, disputed: true });
    await ticket('resolved', { common: true });
    await ticket('resolved');
    // ใบที่จบแล้ว: urgent / reopen / มีคนแย้ง ต้องไม่ขึ้นคิว
    await ticket('closed', { priority: 'urgent', reopenCount: 1, common: true, disputed: true });
    await ticket('rejected', { priority: 'urgent' });
    await ticket('cancelled');
    // ใบที่ถูกลบแบบ soft ไม่อยู่ในคิวเลย
    await ticket('open', { priority: 'urgent', deleted: true });
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const counts = async (userId: string) =>
    http()
      .get('/tickets/queue-counts')
      .set(await as(userId));
  const list = async (userId: string, qs: string) =>
    http()
      .get(`/tickets?${qs}&limit=100`)
      .set(await as(userId));

  it('ตัวเลขตรงกับคิวตัวอย่าง', async () => {
    const res = await counts(fx.staff);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      open_total: 9,
      unassigned: 2,
      urgent: 2,
      disputed: 1,
      reopened: 2,
      common_pending_confirm: 2,
    });
  });

  // mutation check: เปลี่ยนเงื่อนไขของตัวนับใน queue-counts ให้ต่างจาก query param ที่คู่กัน แล้วเทสนี้ต้องแดง
  it.each(Object.entries(PAIRS))('%s เท่ากับจำนวนรายการของ GET /tickets?%s', async (name, qs) => {
    const [c, l] = await Promise.all([counts(fx.staff), list(fx.staff, qs)]);
    expect(l.status).toBe(200);
    expect({ [name]: c.body[name] }).toEqual({ [name]: l.body.length });
  });

  it('admin ได้ตัวเลขชุดเดียวกับ staff · นักศึกษาและช่าง → 403', async () => {
    expect((await counts(fx.admin)).body).toEqual((await counts(fx.staff)).body);
    expect((await counts(fx.alice)).status).toBe(403);
    expect((await counts(fx.tech)).status).toBe(403);
  });

  it('ต้อง login', async () => {
    expect((await http().get('/tickets/queue-counts')).status).toBe(401);
  });

  describe('ตัวกรองซ้อนบน visibilityFilter', () => {
    it('ช่างกรอง reopened=true เห็นเฉพาะงานที่ถูกส่งกลับของตัวเอง', async () => {
      const res = await list(fx.tech, 'reopened=true');
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ assigned_to: fx.tech, reopen_count: 1 });
    });

    it('priority=urgent ไม่รวมใบที่จบแล้ว แม้จะเคยเป็นด่วนมาก', async () => {
      const res = await list(fx.staff, 'priority=urgent');
      expect(res.body.map((t: { status: string }) => t.status).sort()).toEqual(['assigned', 'open']);
    });

    it('disputed=false ได้ทุกใบที่ไม่มีคนแย้งค้างอยู่', async () => {
      const all = await list(fx.staff, '');
      const notDisputed = await list(fx.staff, 'disputed=false');
      expect(notDisputed.body).toHaveLength(all.body.length - 1);
    });

    it('ค่าที่ไม่ใช่ boolean / นอก enum → 400', async () => {
      expect((await list(fx.staff, 'reopened=maybe')).status).toBe(400);
      expect((await list(fx.staff, 'priority=critical')).status).toBe(400);
    });
  });
});
