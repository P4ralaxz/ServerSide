import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TICKET_STATUSES, TicketScope, TicketStatus } from '../../src/domain/enums';
import { UI_ACTION_CALL, UI_ACTIONS, UI_ACTIONS_NOT_IMPLEMENTED, UiAction } from '../../src/domain/status-rules';
import { bearer, createTestApp, resetThrottle } from '../setup/app';
import { makeAsset, makeBuilding, makeRoom, makeTicket, makeUser } from '../setup/factories';
import { openTestDb, truncateAll } from '../setup/truncate';

const HOUR = 3_600_000;
const PROBES = UI_ACTIONS.filter((a) => !UI_ACTIONS_NOT_IMPLEMENTED.includes(a));

// contract test ของ P8: ปุ่มที่ API ส่งมาต้องกดได้จริง และปุ่มที่ไม่ส่งต้องกดไม่ได้จริง
// หน้าจอไม่มีกฎทางธุรกิจของตัวเอง (UI-PLAN หัวข้อ 2) — ถ้าสองฝั่งไม่ตรง หน้าจอจะมีปุ่มที่กดแล้วพัง
// mutation check: เพิ่ม action ที่ไม่ควรมีลงใน allowedActions แล้วไฟล์นี้ต้องแดง
describe('actions ↔ endpoint', () => {
  let app: INestApplication;
  let ds: DataSource;
  let fx: {
    d1: string;
    room1: string;
    room2: string;
    alice: string;
    roommate: string;
    bob: string;
    tech: string;
    tech2: string;
    staff: string;
    admin: string;
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
    const d1 = await makeBuilding(ds, 'A1');
    const room1 = await makeRoom(ds, d1, '101');
    const room2 = await makeRoom(ds, d1, '102');
    fx = {
      d1,
      room1,
      room2,
      alice: await makeUser(ds, { roomId: room1 }),
      roommate: await makeUser(ds, { roomId: room1 }),
      bob: await makeUser(ds, { roomId: room2 }),
      tech: await makeUser(ds, { role: 'technician' }),
      tech2: await makeUser(ds, { role: 'technician' }),
      staff: await makeUser(ds, { role: 'staff' }),
      admin: await makeUser(ds, { role: 'admin' }),
    };
  });

  const http = () => request(app.getHttpServer());
  const as = (userId: string) => bearer(app, userId);
  const who = (): { name: string; id: string }[] => [
    { name: 'ผู้แจ้ง (ห้อง 101)', id: fx.alice },
    { name: 'รูมเมท', id: fx.roommate },
    { name: 'นักศึกษาห้องอื่น', id: fx.bob },
    { name: 'ช่างเจ้าของงาน', id: fx.tech },
    { name: 'ช่างคนอื่น', id: fx.tech2 },
    { name: 'staff', id: fx.staff },
    { name: 'admin', id: fx.admin },
  ];

  // ใบที่วางตรงลง DB — ผู้แจ้งอนุญาตให้เข้าห้องแล้ว เพื่อไม่ให้ปุ่มเริ่มงานติดกฎ 6.7 ในเคสฐาน
  // ครุภัณฑ์ชิ้นใหม่ต่อใบ: ชิ้นเดียวมีใบเปิดได้ใบเดียว (idx_tickets_asset_open) แต่เทสนี้ต้องมีหลายใบในสถานะเดียวกัน
  let seq = 0;
  const ticketAt = async (status: TicketStatus, scope: TicketScope): Promise<string> => {
    const done = new Date(Date.now() - HOUR);
    const assigned = ['assigned', 'in_progress', 'pending_parts', 'resolved', 'closed'].includes(status);
    const n = ++seq;
    const asset =
      scope === 'room'
        ? await makeAsset(ds, fx.d1, fx.room1, `AC-${n}`)
        : await makeAsset(ds, fx.d1, null, `LIFT-${n}`);
    return makeTicket(ds, {
      assetId: asset,
      reporterId: fx.alice,
      scope,
      roomId: scope === 'room' ? fx.room1 : null,
      status,
      permissionToEnter: scope === 'room',
      ...(assigned ? { assignedTo: fx.tech } : {}),
      ...(status === 'resolved' || status === 'closed' ? { resolvedAt: done } : {}),
      ...(status === 'closed' ? { closedAt: done, closeReason: 'staff_confirmed' } : {}),
    });
  };

  const detailOf = async (userId: string, ticketId: string) =>
    http()
      .get(`/tickets/${ticketId}`)
      .set(await as(userId));

  // ยิง endpoint ของปุ่มนั้นด้วย body ที่ถูกต้องเสมอ — ผลที่ได้จึงสะท้อนสิทธิ์/สถานะ ไม่ใช่ความผิดของ body
  const fire = async (userId: string, ticketId: string, action: UiAction, currentAssignee: string | null) => {
    const call = UI_ACTION_CALL[action];
    const url = `/tickets/${ticketId}${call.endpoint}`;
    const headers = await as(userId);
    switch (action) {
      case 'assign':
        return http()
          .post(url)
          .set(headers)
          .send({ technician_id: currentAssignee === fx.tech ? fx.tech2 : fx.tech });
      case 'schedule':
        return http()
          .patch(url)
          .set(headers)
          .send({ scheduled_at: new Date(Date.now() + 3 * HOUR).toISOString() });
      case 'priority':
        return http().patch(url).set(headers).send({ priority: 'high' });
      case 'reject':
        return http().post(url).set(headers).send({ note: 'ไม่อยู่ในความรับผิดชอบ' });
      case 'reopen':
        return http().post(url).set(headers).send({ note: 'ยังมีเสียงดังอยู่' });
      case 'comment':
        return http().post(url).set(headers).send({ body: 'สอบถามความคืบหน้า' });
      case 'start':
      case 'resume':
      case 'pending_parts':
      case 'resolve':
        return http().post(url).set(headers).send({ to: call.to, note: 'บันทึกงาน' });
      default:
        return http().post(url).set(headers);
    }
  };

  describe.each(TICKET_STATUSES)('ใบสถานะ %s', (status) => {
    it.each<TicketScope>(['room', 'common_area'])('scope %s', async (scope) => {
      // เก็บทุกข้อที่ไม่ตรงก่อนแล้วเทียบครั้งเดียว — ขึ้นมาทั้งรายการเลยว่าคู่ไหนพัง
      const violations: string[] = [];
      for (const user of who()) {
        const base = await ticketAt(status, scope);
        const detail = await detailOf(user.id, base);
        const label = (action: string) => `${user.name} · ${status} · ${scope} · ${action}`;

        // มองไม่เห็นใบ → 404 เมื่อ role ผ่าน guard · 403 เมื่อ role นั้นเรียก endpoint นี้ไม่ได้เลย
        // ที่ห้ามเกิดคือ 409 เพราะมันบอกสถานะของใบที่คนนี้ไม่ควรรู้ว่ามีอยู่ (กฎข้อ 3 ชั้น 0)
        if (detail.status === 404) {
          for (const action of PROBES) {
            const res = await fire(user.id, base, action, fx.tech);
            if (![403, 404].includes(res.status)) violations.push(`${label(action)} → ${res.status} (ควรเป็น 403/404)`);
          }
          continue;
        }

        expect(detail.status).toBe(200);
        const actions = detail.body.actions as UiAction[];
        const before = (await ds.query(`SELECT * FROM tickets WHERE id = $1`, [base]))[0];

        // 'start' กับ 'resume' เป็นคำขอเดียวกัน (POST /status {to:'in_progress'}) ต่างกันแค่ชื่อปุ่มบนจอ
        // ถ้าปุ่มฝาแฝดตัวหนึ่งกดได้ อีกตัวก็ยิงคำขอเดียวกันแล้วสำเร็จ — เทียบทีละ "คำขอ" ไม่ใช่ทีละชื่อปุ่ม
        const callOf = (a: UiAction) => `${UI_ACTION_CALL[a].endpoint}:${UI_ACTION_CALL[a].to ?? ''}`;
        const allowedCalls = new Set(actions.map(callOf));

        // ปุ่มที่ไม่ได้ส่งมา: ต้องถูกปฏิเสธด้วยสิทธิ์ (403) หรือสถานะ (409) เท่านั้น
        for (const action of PROBES.filter((a) => !actions.includes(a) && !allowedCalls.has(callOf(a)))) {
          const res = await fire(user.id, base, action, before.assigned_to as string | null);
          if (![403, 409].includes(res.status)) violations.push(`${label(action)} → ${res.status} (ควรเป็น 403/409)`);
        }
        // ปุ่มที่ปฏิเสธไปแล้วต้องไม่แตะข้อมูลเลย
        expect((await ds.query(`SELECT * FROM tickets WHERE id = $1`, [base]))[0]).toEqual(before);

        // ปุ่มที่ส่งมา: ต้องกดได้จริง — ใบใหม่ต่อหนึ่งปุ่ม เพราะการกดสำเร็จเปลี่ยนสถานะ
        for (const action of actions) {
          const fresh = await ticketAt(status, scope);
          const res = await fire(user.id, fresh, action, fx.tech);
          // comment สร้างแถวใหม่จึงตอบ 201 (DESIGN 7) · ปุ่มอื่นแก้ใบเดิมตอบ 200
          const ok = action === 'comment' ? 201 : 200;
          if (res.status !== ok) violations.push(`${label(action)} → ${res.status} (ปุ่มที่ส่งมาต้องกดได้)`);
        }
      }
      expect(violations).toEqual([]);
    });
  });

  it('actions ของใบเดียวกันใน GET /tickets เท่ากับใน GET /tickets/:id', async () => {
    const ids: string[] = [];
    for (const status of TICKET_STATUSES) {
      ids.push(await ticketAt(status, 'common_area'));
      ids.push(await ticketAt(status, 'room'));
    }
    let seen = 0;
    for (const user of who()) {
      const res = await http()
        .get('/tickets')
        .set(await as(user.id))
        .query({ limit: 100 });
      expect(res.status).toBe(200);
      const list = res.body as { id: string; actions: UiAction[] }[];
      // ช่างที่ไม่ได้รับงานไหนเลยเห็นรายการว่าง — ถูกต้องตาม visibilityFilter
      seen += list.length;
      for (const item of list) {
        const detail = await detailOf(user.id, item.id);
        expect({ id: item.id, actions: item.actions }).toEqual({ id: item.id, actions: detail.body.actions });
      }
      // ใบที่ไม่อยู่ในรายการของคนนี้ต้องเป็นใบที่เปิดดูไม่ได้ด้วย
      for (const id of ids.filter((i) => !list.some((l) => l.id === i))) {
        expect((await detailOf(user.id, id)).status).toBe(404);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
