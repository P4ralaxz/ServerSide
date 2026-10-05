import { TICKET_STATUSES, TicketStatus, USER_ROLES } from './enums';
import {
  Actor,
  canTransition,
  DEDICATED_ENDPOINTS,
  ENDPOINTS,
  isOpenStatus,
  NOTE_REQUIRED,
  OPEN_STATUSES,
  TRANSITIONS,
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

  it('ปลายทางที่มี endpoint เฉพาะ ต้องเป็นปลายทางที่มีอยู่จริงในตารางกฎ', () => {
    const reachable = new Set(TICKET_STATUSES.flatMap((s) => Object.keys(TRANSITIONS[s]) as TicketStatus[]));
    for (const to of Object.keys(DEDICATED_ENDPOINTS)) expect(reachable.has(to as TicketStatus)).toBe(true);
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
