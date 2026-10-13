import { TICKET_STATUSES, USER_ROLES } from '../../domain/enums';
import {
  TicketAction,
  UI_ACTION_CALL,
  UI_ACTIONS_NOT_IMPLEMENTED,
  UiAction,
  VIA_ACTION,
} from '../../domain/status-rules';
import { PolicyTicket, PolicyUser, TicketPolicy } from './ticket-policy.service';

const policy = new TicketPolicy();

const ROOM_A = 'room-a';
const ROOM_B = 'room-b';

const user = (role: PolicyUser['role'], roomId: string | null = null, id = `${role}-1`): PolicyUser => ({
  id,
  role,
  roomId,
});

const alice = user('student', ROOM_A, 'alice');
const roommate = user('student', ROOM_A, 'roommate');
const bob = user('student', ROOM_B, 'bob');
const homeless = user('student', null, 'homeless');
const tech = user('technician', null, 'tech');
const otherTech = user('technician', null, 'other-tech');
const staff = user('staff');
const admin = user('admin');
const everyone = [alice, roommate, bob, homeless, tech, otherTech, staff, admin];

const roomTicket: PolicyTicket = {
  scope: 'room',
  roomId: ROOM_A,
  reporterId: 'alice',
  assignedTo: 'tech',
  status: 'open',
  // ผู้แจ้งอนุญาตให้เข้าห้องแล้ว — เคสที่ต้องนัดก่อนอยู่ในเทสของตัวเองข้างล่าง
  permissionToEnter: true,
  scheduledAt: null,
};
const commonTicket: PolicyTicket = {
  scope: 'common_area',
  roomId: null,
  reporterId: 'alice',
  assignedTo: 'tech',
  status: 'open',
  permissionToEnter: false,
  scheduledAt: null,
};

const ACTIONS = [...new Set(Object.values(VIA_ACTION))];

// ใครทำ action ไหนกับใบแบบไหนได้ — ทุกคนที่ไม่อยู่ในรายการต้องไม่ได้
const allowed = (action: TicketAction, ticket: PolicyTicket): string[] =>
  everyone.filter((u) => policy.can(action, u, ticket)).map((u) => u.id);

describe('TicketPolicy.can — ตาราง 4.2 ของ DESIGN', () => {
  it('ครอบทุก action ที่ endpoint ใช้ และ role ทุกตัว (ไม่มีกรณีที่ตกหล่นแล้วได้ undefined)', () => {
    for (const action of ACTIONS) {
      for (const role of USER_ROLES) {
        expect(typeof policy.can(action, user(role, ROOM_A), roomTicket)).toBe('boolean');
        expect(typeof policy.can(action, user(role, ROOM_A), commonTicket)).toBe('boolean');
      }
      expect(typeof policy.can(action, null, commonTicket)).toBe('boolean');
    }
  });

  // admin อยู่ในรายการทุกแถวที่ staff อยู่ เพราะ actorOf() ยกระดับให้ที่เดียว (DESIGN 4.2)
  // ยกเว้น confirm / reopen ของใบห้องพัก ที่ต้องเป็น student ผู้พักห้องนั้นจริง
  it.each<[TicketAction, string[], string[]]>([
    //  action           ใบห้องพัก (ห้อง A, alice แจ้ง, tech รับ)   ใบส่วนกลาง
    ['same_issue', ['alice', 'roommate'], ['alice', 'roommate', 'bob', 'homeless']],
    ['confirm', ['alice', 'roommate'], ['staff-1', 'admin-1']],
    ['reopen', ['alice', 'roommate'], ['staff-1', 'admin-1']],
    ['cancel', ['alice'], ['alice']],
    ['change_status', ['tech'], ['tech']],
    ['schedule', ['tech', 'staff-1', 'admin-1'], ['tech', 'staff-1', 'admin-1']],
    ['assign', ['staff-1', 'admin-1'], ['staff-1', 'admin-1']],
    ['reject', ['staff-1', 'admin-1'], ['staff-1', 'admin-1']],
    ['set_priority', ['staff-1', 'admin-1'], ['staff-1', 'admin-1']],
    ['auto_close', [], []],
  ])('%s', (action, onRoom, onCommon) => {
    expect(allowed(action, roomTicket)).toEqual(onRoom);
    expect(allowed(action, commonTicket)).toEqual(onCommon);
  });

  it('ตารางข้างบนครอบทุก action ใน VIA_ACTION', () => {
    expect([...ACTIONS].sort()).toEqual(
      [
        'assign',
        'auto_close',
        'cancel',
        'change_status',
        'confirm',
        'reject',
        'reopen',
        'same_issue',
        'schedule',
        'set_priority',
      ].sort(),
    );
  });

  it('ระบบ (user = null) ทำได้อย่างเดียวคือ auto_close', () => {
    expect(ACTIONS.filter((a) => policy.can(a, null, commonTicket))).toEqual(['auto_close']);
    expect(ACTIONS.filter((a) => policy.can(a, null, roomTicket))).toEqual(['auto_close']);
  });

  // กฎข้อ 2: ช่างปิดงานเองไม่ได้ และ Staff ยืนยันใบห้องพักแทนไม่ได้
  it('ช่างยืนยัน/เปิดงานซ้ำไม่ได้ทั้งสองแบบ · Staff ทำแทนใบห้องพักไม่ได้', () => {
    for (const action of ['confirm', 'reopen'] as const) {
      expect(policy.can(action, tech, roomTicket)).toBe(false);
      expect(policy.can(action, tech, commonTicket)).toBe(false);
      expect(policy.can(action, staff, roomTicket)).toBe(false);
      expect(policy.can(action, admin, roomTicket)).toBe(false);
    }
  });

  it('สิทธิ์ยืนยันผูกกับห้อง ไม่ใช่กับคนแจ้ง: ผู้แจ้งที่ย้ายออกแล้วยืนยันไม่ได้ แต่ยังยกเลิกใบตัวเองได้', () => {
    const movedOut = user('student', ROOM_B, 'alice');
    expect(policy.can('confirm', movedOut, roomTicket)).toBe(false);
    expect(policy.can('same_issue', movedOut, roomTicket)).toBe(false);
    expect(policy.can('cancel', movedOut, roomTicket)).toBe(true);
    expect(policy.canSee(movedOut, roomTicket)).toBe(true);
  });

  it('นักศึกษาที่ยังไม่มีห้อง ไม่ถูกนับว่าพักห้องของใบที่ room_id เป็น null', () => {
    const broken: PolicyTicket = { ...roomTicket, roomId: null, reporterId: 'x', assignedTo: null };
    expect(policy.can('confirm', homeless, broken)).toBe(false);
    expect(policy.canSee(homeless, broken)).toBe(false);
  });

  it('assertCan โยน 403 เมื่อไม่มีสิทธิ์', () => {
    expect(() => policy.assertCan('assign', alice, commonTicket)).toThrow(expect.objectContaining({ status: 403 }));
    expect(() => policy.assertCan('assign', staff, commonTicket)).not.toThrow();
  });
});

describe('TicketPolicy.canSee', () => {
  const see = (ticket: PolicyTicket): string[] => everyone.filter((u) => policy.canSee(u, ticket)).map((u) => u.id);

  it('ใบห้องพัก: คนในห้อง ผู้แจ้ง ช่างที่รับงาน และ staff/admin', () => {
    expect(see(roomTicket)).toEqual(['alice', 'roommate', 'tech', 'staff-1', 'admin-1']);
  });

  it('ใบส่วนกลาง: นักศึกษาทุกคนทุกอาคาร — ช่างเห็นเฉพาะงานของตัวเอง', () => {
    expect(see(commonTicket)).toEqual(['alice', 'roommate', 'bob', 'homeless', 'tech', 'staff-1', 'admin-1']);
  });

  it('ช่างไม่เห็นใบที่ยังไม่มีคนรับ', () => {
    expect(policy.canSee(tech, { ...commonTicket, assignedTo: null })).toBe(false);
  });
});

describe('TicketPolicy.canReport', () => {
  const inRoomA = { roomId: ROOM_A };
  const common = { roomId: null };
  const who = (asset: { roomId: string | null }): string[] =>
    everyone.filter((u) => policy.canReport(u, asset)).map((u) => u.id);

  it('ครุภัณฑ์ในห้อง: เฉพาะนักศึกษาที่พักห้องนั้น — Staff ก็แจ้งแทนไม่ได้', () => {
    expect(who(inRoomA)).toEqual(['alice', 'roommate']);
  });

  // เปลี่ยนจากสัปดาห์ 3: admin ⊇ staff (DESIGN 12.1) และ 6.3 ยกเว้นโควตาให้ admin อยู่แล้ว = ตั้งใจให้แจ้งได้
  it('ส่วนกลาง: นักศึกษาทุกคน staff และ admin — ช่างแจ้งไม่ได้', () => {
    expect(who(common)).toEqual(['alice', 'roommate', 'bob', 'homeless', 'staff-1', 'admin-1']);
  });
});

describe('TicketPolicy.allowedActions — ปุ่มที่ส่งให้หน้าจอ (DESIGN 7.1)', () => {
  const at = (status: PolicyTicket['status'], over: Partial<PolicyTicket> = {}): PolicyTicket => ({
    ...roomTicket,
    status,
    ...over,
  });

  it.each<[string, PolicyUser, PolicyTicket, UiAction[]]>([
    ['ผู้แจ้ง · ใบ open', alice, at('open', { assignedTo: null }), ['cancel', 'same_issue']],
    ['รูมเมท · ใบ open (ไม่ใช่ผู้แจ้ง จึงยกเลิกไม่ได้)', roommate, at('open', { assignedTo: null }), ['same_issue']],
    ['Staff · ใบ open', staff, at('open', { assignedTo: null }), ['assign', 'reject', 'priority']],
    ['admin · ใบ open (เท่ากับ staff)', admin, at('open', { assignedTo: null }), ['assign', 'reject', 'priority']],
    ['ช่างเจ้าของงาน · ใบ assigned', tech, at('assigned'), ['schedule', 'start']],
    ['ช่างคนอื่น · ใบ assigned', otherTech, at('assigned'), []],
    [
      'Staff · ใบ assigned (เปลี่ยนตัวช่างได้ ขั้นไม่เปลี่ยน)',
      staff,
      at('assigned'),
      ['assign', 'reject', 'priority', 'schedule'],
    ],
    ['ช่าง · ใบ in_progress', tech, at('in_progress'), ['schedule', 'pending_parts', 'resolve']],
    ['ช่าง · ใบ pending_parts', tech, at('pending_parts'), ['schedule', 'resume']],
    // กฎข้อ 2: ช่างไม่มีปุ่มปิดใบ และ Staff ไม่มีปุ่มยืนยันใบห้องพัก
    ['ช่าง · ใบ resolved (ปิดเองไม่ได้)', tech, at('resolved'), []],
    ['ผู้พัก · ใบ resolved', roommate, at('resolved'), ['same_issue', 'confirm']],
    ['Staff · ใบ resolved ของห้องพัก (ยืนยันแทนไม่ได้)', staff, at('resolved'), ['priority']],
    [
      'Staff · ใบ resolved ส่วนกลาง',
      staff,
      at('resolved', { scope: 'common_area', roomId: null }),
      ['priority', 'confirm'],
    ],
    ['ผู้พัก · ใบ closed', roommate, at('closed'), []],
    ['Staff · ใบ closed (priority ก็แก้ไม่ได้)', staff, at('closed'), []],
  ])('%s', (_name, who, ticket, expected) => {
    expect(policy.allowedActions(who, ticket)).toEqual(expected);
  });

  // mutation check: เพิ่ม action ที่ไม่ควรมีลงใน allowedActions แล้วเทสนี้ต้องแดง
  it('ทุก action ที่ส่งออกไป ต้องผ่าน can() ของ action ที่ endpoint นั้นใช้ด้วย', () => {
    for (const status of TICKET_STATUSES) {
      for (const u of everyone) {
        for (const a of policy.allowedActions(u, at(status))) {
          expect(policy.can(VIA_ACTION[UI_ACTION_CALL[a].endpoint], u, at(status))).toBe(true);
        }
      }
    }
  });

  // ปุ่มที่กดแล้วได้ 409 ต้องไม่โผล่ — contract test ของ e2e คุมอีกชั้น
  it('ใบห้องพักที่ยังเข้าไม่ได้: ไม่มีปุ่มเริ่มงาน จนกว่าจะมีนัด (DESIGN 6.7)', () => {
    const locked = { ...roomTicket, status: 'assigned' as const, permissionToEnter: false };
    expect(policy.allowedActions(tech, locked)).toEqual(['schedule']);
    expect(policy.allowedActions(tech, { ...locked, scheduledAt: new Date() })).toEqual(['schedule', 'start']);
    // รออะไหล่แล้วกลับมาซ่อมต่อก็ต้องเข้าห้องได้เหมือนกัน
    const parts = { ...locked, status: 'pending_parts' as const };
    expect(policy.allowedActions(tech, parts)).toEqual(['schedule']);
    expect(policy.allowedActions(tech, { ...parts, scheduledAt: new Date() })).toEqual(['schedule', 'resume']);
  });

  it('คนที่กดเจอปัญหาเดียวกันไปแล้ว ไม่มีปุ่มนั้นอีก (กดซ้ำได้ 409)', () => {
    expect(policy.allowedActions(roommate, roomTicket, { alreadyReported: true })).toEqual([]);
    expect(policy.allowedActions(alice, roomTicket, { alreadyReported: true })).toEqual(['cancel']);
  });

  it('ไม่ส่งปุ่มที่ endpoint ยังไม่เกิด (reopen = สัปดาห์ 5)', () => {
    for (const status of TICKET_STATUSES) {
      for (const u of everyone) {
        for (const a of UI_ACTIONS_NOT_IMPLEMENTED) expect(policy.allowedActions(u, at(status))).not.toContain(a);
      }
    }
  });
});
