import { USER_ROLES } from '../../domain/enums';
import { TicketAction, VIA_ACTION } from '../../domain/status-rules';
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

const roomTicket: PolicyTicket = { scope: 'room', roomId: ROOM_A, reporterId: 'alice', assignedTo: 'tech' };
const commonTicket: PolicyTicket = { scope: 'common_area', roomId: null, reporterId: 'alice', assignedTo: 'tech' };

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

  it.each<[TicketAction, string[], string[]]>([
    //  action           ใบห้องพัก (ห้อง A, alice แจ้ง, tech รับ)   ใบส่วนกลาง
    ['same_issue', ['alice', 'roommate'], ['alice', 'roommate', 'bob', 'homeless']],
    ['confirm', ['alice', 'roommate'], ['staff-1']],
    ['reopen', ['alice', 'roommate'], ['staff-1']],
    ['cancel', ['alice'], ['alice']],
    ['change_status', ['tech'], ['tech']],
    ['schedule', ['tech', 'staff-1'], ['tech', 'staff-1']],
    ['assign', ['staff-1'], ['staff-1']],
    ['reject', ['staff-1'], ['staff-1']],
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
    const broken: PolicyTicket = { scope: 'room', roomId: null, reporterId: 'x', assignedTo: null };
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

  it('ส่วนกลาง: นักศึกษาทุกคนและ staff — ช่างกับ admin แจ้งไม่ได้ (ชั้น 1)', () => {
    expect(who(common)).toEqual(['alice', 'roommate', 'bob', 'homeless', 'staff-1']);
  });
});
