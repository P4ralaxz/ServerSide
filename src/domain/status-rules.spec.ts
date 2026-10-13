import { TICKET_STATUSES, TicketStatus, USER_ROLES } from './enums';
import {
  Actor,
  actorOf,
  ASSIGNABLE_STATUSES,
  canGoVia,
  canTransition,
  ENDPOINTS,
  isOpenStatus,
  NOTE_REQUIRED,
  OPEN_STATUSES,
  TRANSITION_ONLY_VIA,
  TRANSITIONS,
  transitionKey,
  UI_ACTION_CALL,
  UI_ACTIONS,
  VIA_ACTION,
} from './status-rules';

const ACTORS: Actor[] = [...USER_ROLES, 'system'];

describe('status machine', () => {
  // @parity test_smoke.py::test_cannot_jump_from_new_to_closed (new → open)
  it('open ข้ามไป closed ไม่ได้ ไม่ว่าใครกด', () => {
    for (const actor of ACTORS) expect(canTransition('open', 'closed', actor)).toBe(false);
  });

  // @parity test_smoke.py::test_technician_path_stops_at_resolved
  it('ช่างไปได้สูงสุด resolved — ไม่มีทางไหนที่ช่างพาใบไป closed ได้', () => {
    expect(canTransition('assigned', 'in_progress', 'technician')).toBe(true);
    expect(canTransition('in_progress', 'resolved', 'technician')).toBe(true);
    for (const from of TICKET_STATUSES) expect(canTransition(from, 'closed', 'technician')).toBe(false);
  });

  // @parity test_smoke.py::test_closed_and_rejected_are_terminal (+ cancelled ที่เพิ่มใหม่)
  it.each(['closed', 'rejected', 'cancelled'] as const)('%s เป็นสถานะสุดท้าย', (s) => {
    expect(TRANSITIONS[s]).toEqual({});
  });

  // @parity test_smoke.py::test_open_statuses_exclude_terminal — ห้ามลบ
  it('OPEN_STATUSES ไม่มี closed / rejected / cancelled', () => {
    for (const s of ['closed', 'rejected', 'cancelled'] as const) expect(isOpenStatus(s)).toBe(false);
    expect([...OPEN_STATUSES].sort()).toEqual(['assigned', 'in_progress', 'open', 'pending_parts', 'resolved']);
  });

  it('สถานะที่ไม่อยู่ใน OPEN_STATUSES คือสถานะสุดท้ายพอดี ไม่ขาดไม่เกิน', () => {
    const terminal = TICKET_STATUSES.filter((s) => Object.keys(TRANSITIONS[s]).length === 0);
    expect(TICKET_STATUSES.filter((s) => !isOpenStatus(s)).sort()).toEqual([...terminal].sort());
  });

  it('ยกเลิกใบได้เฉพาะตอน open', () => {
    const from = TICKET_STATUSES.filter((s) => TRANSITIONS[s].cancelled);
    expect(from).toEqual(['open']);
    expect(TRANSITIONS.open.cancelled).toEqual(['student']);
  });

  it('reopen (resolved → assigned) กดได้โดย student/staff เท่านั้น', () => {
    expect(TRANSITIONS.resolved.assigned).toEqual(['student', 'staff']);
  });

  it('ไม่มีแถว from = to (ck_real_transition จะปฏิเสธอยู่แล้ว)', () => {
    for (const s of TICKET_STATUSES) expect(TRANSITIONS[s][s]).toBeUndefined();
  });

  it('NOTE_REQUIRED ตรงกับของเดิม', () => {
    expect([...NOTE_REQUIRED].sort()).toEqual(['pending_parts', 'rejected']);
  });

  it('ทุกคู่ใน TRANSITION_ONLY_VIA ต้องเป็นเส้นทางที่มีอยู่จริงในตารางกฎ และชี้ไป endpoint ที่มีจริง', () => {
    for (const [key, endpoints] of Object.entries(TRANSITION_ONLY_VIA)) {
      const [from, to] = key.split('->') as [TicketStatus, TicketStatus];
      expect(TRANSITIONS[from][to]).toBeDefined();
      expect(endpoints?.length).toBeGreaterThan(0);
      for (const e of endpoints ?? []) expect(ENDPOINTS).toContain(e);
    }
  });
});

describe('TRANSITION_ONLY_VIA', () => {
  // mutation check: ลบคู่นี้ออกแล้วเทสนี้ต้องแดง — Staff จะกด /assign กับใบ resolved ได้
  it('resolved → assigned ไปได้ทาง /reopen เท่านั้น ไม่ใช่ /assign', () => {
    expect(canGoVia('resolved', 'assigned', '/reopen', 'staff')).toBe(true);
    expect(canGoVia('resolved', 'assigned', '/assign', 'staff')).toBe(false);
    expect(canGoVia('resolved', 'assigned', '/status', 'staff')).toBe(false);
  });

  it('resolved → closed ไปได้ทาง /confirm และ job ปิดอัตโนมัติ แต่ไม่ใช่ /status', () => {
    expect(canGoVia('resolved', 'closed', '/confirm', 'staff')).toBe(true);
    expect(canGoVia('resolved', 'closed', 'system:auto-close', 'system')).toBe(true);
    expect(canGoVia('resolved', 'closed', '/status', 'staff')).toBe(false);
  });

  it('ยกเลิกและไม่รับเรื่องไปได้ทาง endpoint ของตัวเองเท่านั้น', () => {
    expect(canGoVia('open', 'cancelled', '/cancel', 'student')).toBe(true);
    expect(canGoVia('open', 'cancelled', '/status', 'student')).toBe(false);
    expect(canGoVia('open', 'rejected', '/reject', 'staff')).toBe(true);
    expect(canGoVia('open', 'rejected', '/status', 'staff')).toBe(false);
    expect(canGoVia('assigned', 'rejected', '/status', 'staff')).toBe(false);
  });

  it('เส้นทางที่ไม่อยู่ในตารางนี้ ใช้ endpoint ไหนก็ได้เท่าที่ตารางกฎยอม', () => {
    expect(TRANSITION_ONLY_VIA[transitionKey('open', 'assigned')]).toBeUndefined();
    expect(canGoVia('open', 'assigned', '/assign', 'staff')).toBe(true);
    expect(canGoVia('in_progress', 'resolved', '/status', 'technician')).toBe(true);
  });

  it('/assign รับได้ตั้งแต่ open ถึง pending_parts แต่ไม่รับใบ resolved', () => {
    expect([...ASSIGNABLE_STATUSES].sort()).toEqual(['assigned', 'in_progress', 'open', 'pending_parts']);
  });
});

describe('actorOf (admin ⊇ staff)', () => {
  it('admin ถือสิทธิ์เป็น staff ในตารางกฎ', () => {
    expect(actorOf({ role: 'admin' })).toBe('staff');
    expect(canTransition('open', 'assigned', actorOf({ role: 'admin' }))).toBe(true);
    expect(canTransition('open', 'rejected', actorOf({ role: 'admin' }))).toBe(true);
  });

  it('role อื่นไม่ถูกแปลง และ null = ระบบ', () => {
    for (const role of ['student', 'technician', 'staff'] as const) expect(actorOf({ role })).toBe(role);
    expect(actorOf(null)).toBe('system');
  });

  it('admin ไม่ได้กลายเป็น student — จึง reopen/confirm ใบห้องพักไม่ได้ที่ชั้นสถานะ', () => {
    expect(actorOf({ role: 'admin' })).not.toBe('student');
  });
});

describe('UI_ACTION_CALL', () => {
  it('ทุกปุ่มชี้ไป endpoint ที่มีจริง', () => {
    for (const a of UI_ACTIONS) expect(ENDPOINTS).toContain(UI_ACTION_CALL[a].endpoint);
  });

  it('ปุ่มของช่างทั้งสี่ยิง /status และแยกกันด้วยขั้นปัจจุบัน', () => {
    for (const a of ['start', 'pending_parts', 'resume', 'resolve'] as const) {
      expect(UI_ACTION_CALL[a].endpoint).toBe('/status');
      expect(UI_ACTION_CALL[a].from).toBeDefined();
    }
    // start กับ resume ไปที่ in_progress ทั้งคู่ — แยกออกจากกันได้ด้วย from เท่านั้น
    expect(UI_ACTION_CALL.start.to).toBe(UI_ACTION_CALL.resume.to);
    expect(UI_ACTION_CALL.start.from).not.toEqual(UI_ACTION_CALL.resume.from);
  });

  it('ปุ่มที่เป็นการเปลี่ยนขั้น ต้องเป็นเส้นทางที่มีจริงในตารางกฎ', () => {
    for (const a of UI_ACTIONS) {
      const call = UI_ACTION_CALL[a];
      if (call.to === undefined) continue;
      const froms = call.from ?? TICKET_STATUSES.filter((s) => TRANSITIONS[s][call.to!]);
      expect(froms.length).toBeGreaterThan(0);
      for (const from of froms) expect(TRANSITIONS[from][call.to]).toBeDefined();
    }
  });
});

describe('VIA_ACTION', () => {
  it('ครอบ Endpoint ทุกค่า', () => {
    expect(Object.keys(VIA_ACTION).sort()).toEqual([...ENDPOINTS].sort());
  });

  it('/assign กับ /reopen ต้องได้ action คนละตัว ทั้งที่ปลายทางเป็น assigned ทั้งคู่', () => {
    expect(VIA_ACTION['/assign']).not.toBe(VIA_ACTION['/reopen']);
    expect(VIA_ACTION['/confirm']).not.toBe(VIA_ACTION['system:auto-close']);
  });

  it('action ไม่ซ้ำกันข้าม endpoint', () => {
    const actions = Object.values(VIA_ACTION);
    expect(new Set(actions).size).toBe(actions.length);
  });
});
