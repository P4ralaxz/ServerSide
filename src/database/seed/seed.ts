import '../../common/time/utc';
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { formatTicketNo, thaiBuddhistYear } from '../../common/time/thai-year';
import { CloseReason, TicketPriority, TicketScope, TicketStatus, UserRole } from '../../domain/enums';
import { isOpenStatus } from '../../domain/status-rules';
import { dataSourceOptions } from '../data-source';

// ข้อมูลตัวอย่างสำหรับ dev และเดโม — รัน: npm run seed (ล้างข้อมูลเดิมทั้งหมดก่อน)
//
// เวลาของ log ทุกแถวต้องเดินต่อกันจริง: ถ้าใส่ now() ทุกแถว รายงาน "เวลาค้างต่อขั้น" จะเป็น 0 ทุกช่อง
// จึงสร้างใบย้อนหลังแล้วเดินเวลาไปข้างหน้าทีละขั้น โดยขั้นสุดท้ายต้องไม่เลยเวลาปัจจุบัน

const HOUR = 3_600_000;
const WINDOW_HOURS = 30 * 24;

// PRNG แบบกำหนด seed: รูปร่างข้อมูลเหมือนเดิมทุกครั้งที่ seed ซ้อมเดโมแล้วได้ตัวเลขชุดเดิม
const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

type Who = 'reporter' | 'staff' | 'tech' | 'system';
type Range = [min: number, max: number];

interface Step {
  to: TicketStatus;
  by: Who;
  note?: string;
  hours?: Range; // เวลาที่ค้างในขั้นก่อนหน้า ก่อนจะเดินมาขั้นนี้
}

interface Scenario {
  scope: TicketScope;
  count: number;
  steps: Step[];
  tail?: Range; // ชั่วโมงจากขั้นสุดท้ายถึงตอนนี้ — ไม่ระบุ = กระจายทั่วช่วง 30 วัน
  disputed?: boolean;
}

const assign: Step = { to: 'assigned', by: 'staff', hours: [1, 12] };
const start: Step = { to: 'in_progress', by: 'tech' };
const resolve: Step = { to: 'resolved', by: 'tech' };
const parts: Step = { to: 'pending_parts', by: 'tech', note: 'รออะไหล่จากร้าน' };
const reject: Step = { to: 'rejected', by: 'staff', note: 'ไม่อยู่ในความรับผิดชอบของหอพัก', hours: [1, 24] };
const cancel: Step = { to: 'cancelled', by: 'reporter', hours: [0.2, 3] };
// ระบบปิดเมื่อครบ 72 ชม. พอดี บวกรอบ cron ไม่เกิน 15 นาที
const autoClose: Step = { to: 'closed', by: 'system', hours: [72, 72.25] };
// ห้องพัก: คนในห้องเป็นคนกด · ส่วนกลาง: Staff (กฎข้อ 2)
const confirm = (scope: TicketScope): Step => ({
  to: 'closed',
  by: scope === 'room' ? 'reporter' : 'staff',
  hours: [1, 48],
});
const reopen = (scope: TicketScope): Step => ({
  to: 'assigned',
  by: scope === 'room' ? 'reporter' : 'staff',
  note: 'ยังไม่หาย อาการเดิมกลับมา',
  hours: [1, 24],
});

const SCENARIOS: Scenario[] = [
  { scope: 'room', count: 6, steps: [assign, start, resolve, confirm('room')] },
  { scope: 'common_area', count: 4, steps: [assign, start, resolve, confirm('common_area')] },
  { scope: 'room', count: 3, steps: [assign, start, resolve, autoClose] },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve, autoClose] },
  { scope: 'room', count: 3, steps: [assign, start, parts, start, resolve, confirm('room')] },
  { scope: 'room', count: 2, steps: [assign, start, resolve, reopen('room'), start, resolve, confirm('room')] },
  {
    scope: 'common_area',
    count: 1,
    steps: [assign, start, resolve, reopen('common_area'), start, resolve, confirm('common_area')],
  },
  { scope: 'room', count: 1, steps: [reject] },
  { scope: 'common_area', count: 1, steps: [reject] },
  { scope: 'room', count: 1, steps: [assign, reject] },
  { scope: 'room', count: 1, steps: [cancel] },
  { scope: 'common_area', count: 1, steps: [cancel] },
  // ใบที่ยังค้างอยู่ในแต่ละขั้น — ไว้ให้คิวของ Staff/ช่างมีของตอนเดโม
  { scope: 'room', count: 2, steps: [], tail: [1, 30] },
  { scope: 'common_area', count: 1, steps: [], tail: [1, 30] },
  { scope: 'room', count: 2, steps: [assign], tail: [1, 30] },
  { scope: 'room', count: 1, steps: [assign, start], tail: [1, 30] },
  { scope: 'common_area', count: 1, steps: [assign, start], tail: [1, 30] },
  { scope: 'room', count: 1, steps: [assign, start, parts], tail: [5, 60] },
  { scope: 'room', count: 1, steps: [assign, start, resolve], tail: [2, 40] },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [2, 40] },
  // เลย 72 ชม. แล้วแต่ยังไม่ถูกปิด — ไว้กดโชว์ POST /admin/jobs/auto-close/run
  { scope: 'room', count: 2, steps: [assign, start, resolve], tail: [80, 120] },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [80, 120] },
  // มีคนกด same-issue หลัง resolved → job ต้องข้ามใบนี้
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [80, 100], disputed: true },
];

interface Asset {
  id: string;
  roomId: string | null;
  title: string;
}

interface Person {
  id: string;
  role: UserRole;
  roomId: string | null;
}

// ปัญหาที่ไม่ผูกกับของชิ้นไหน (ผนังร้าว ท่อเหม็น) ต้องมีครุภัณฑ์ให้ชี้ เพราะ asset_id NOT NULL (กฎข้อ 1)
// แบ่งตามหมวดแทน "อื่น ๆ" ชิ้นเดียวต่อห้อง: ปัญหาคนละหมวดในห้องเดียวกันแจ้งพร้อมกันได้
// ปัญหาสองเรื่องในหมวดเดียวกันยังชน 409 — เป็นข้อจำกัดที่ยอมรับ (DESIGN 12.1) ให้เพิ่มรายละเอียดทาง comment ของใบเดิม
const GENERAL_ASSETS = [
  { suffix: 'G-STRUCT', name: 'ผนัง / ฝ้า / พื้น', category: 'structure', title: 'ฝ้าเพดานมีคราบน้ำรั่ว' },
  { suffix: 'G-DOOR', name: 'ประตู / หน้าต่าง / กุญแจ', category: 'door_window', title: 'กุญแจประตูฝืด ไขไม่เข้า' },
  { suffix: 'G-ELEC', name: 'ไฟฟ้าทั่วไป', category: 'electrical', title: 'ปลั๊กไฟไม่มีไฟ' },
  { suffix: 'G-PLUMB', name: 'ประปาทั่วไป', category: 'plumbing', title: 'ท่อระบายน้ำมีกลิ่นเหม็น' },
];

const ROOM_ASSETS = [
  { suffix: 'AC', name: 'เครื่องปรับอากาศ', category: 'electrical', title: 'แอร์ไม่เย็น' },
  { suffix: 'LIGHT', name: 'หลอดไฟเพดาน', category: 'electrical', title: 'หลอดไฟกะพริบ' },
  { suffix: 'TAP', name: 'ก๊อกน้ำอ่างล้างหน้า', category: 'plumbing', title: 'ก๊อกน้ำรั่ว' },
  { suffix: 'BED', name: 'เตียงนอน', category: 'furniture', title: 'ขาเตียงหัก' },
  ...GENERAL_ASSETS,
];

const COMMON_ASSETS = [
  {
    suffix: 'LIFT',
    name: 'ลิฟต์โดยสาร',
    category: 'elevator',
    note: 'ลิฟต์ฝั่งตะวันออก',
    title: 'ลิฟต์ค้างระหว่างชั้น',
  },
  { suffix: 'WATER', name: 'ตู้กดน้ำดื่ม', category: 'appliance', note: 'โถงชั้น 1', title: 'ตู้กดน้ำไม่เย็น' },
  {
    suffix: 'WASH',
    name: 'เครื่องซักผ้า',
    category: 'appliance',
    note: 'ห้องซักล้างชั้น 1',
    title: 'เครื่องซักผ้าไม่ปั่น',
  },
  { suffix: 'HALL', name: 'ไฟทางเดิน', category: 'electrical', note: 'ทางเดินชั้น 3', title: 'ไฟทางเดินดับ' },
  ...GENERAL_ASSETS.map((a) => ({ ...a, note: 'พื้นที่ส่วนกลางทั้งอาคาร' })),
];

export interface SeedSummary {
  buildings: number;
  rooms: number;
  users: number;
  assets: number;
  tickets: number;
}

export async function seed(ds: DataSource, now: Date = new Date()): Promise<SeedSummary> {
  const rng = mulberry32(2569);
  const between = ([min, max]: Range) => min + rng() * (max - min);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];

  return ds.transaction(async (m: EntityManager) => {
    await m.query(`
      TRUNCATE ticket_comments, ticket_reporters, ticket_audit_logs, ticket_status_logs, tickets,
               ticket_counters, assets, login_codes, users, rooms, buildings
      RESTART IDENTITY CASCADE`);

    // ---- อาคาร / ห้อง / ครุภัณฑ์ ----
    const rooms: { id: string; buildingCode: string }[] = [];
    const assets: Asset[] = [];
    const addAsset = async (
      code: string,
      a: { name: string; category: string; title: string; note?: string },
      buildingId: string,
      roomId: string | null,
    ) => {
      const id = randomUUID();
      await m.query(
        `INSERT INTO assets (id, asset_code, name, category, building_id, room_id, location_note, qr_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, code, a.name, a.category, buildingId, roomId, a.note ?? null, randomBytes(16).toString('hex')],
      );
      assets.push({ id, roomId, title: a.title });
    };

    const buildingCodes = ['D1', 'D2'];
    for (const code of buildingCodes) {
      const buildingId = randomUUID();
      await m.query(`INSERT INTO buildings (id, code, name) VALUES ($1, $2, $3)`, [
        buildingId,
        code,
        `หอพักนักศึกษา ${code}`,
      ]);
      for (const floor of [3, 4]) {
        for (let n = 1; n <= 5; n++) {
          const roomId = randomUUID();
          const roomNo = `${floor}${String(n).padStart(2, '0')}`;
          await m.query(`INSERT INTO rooms (id, building_id, room_no, floor, capacity) VALUES ($1, $2, $3, $4, 2)`, [
            roomId,
            buildingId,
            roomNo,
            floor,
          ]);
          rooms.push({ id: roomId, buildingCode: code });
          for (const a of ROOM_ASSETS) await addAsset(`${code}-${roomNo}-${a.suffix}`, a, buildingId, roomId);
        }
      }
      for (const a of COMMON_ASSETS) await addAsset(`${code}-CM-${a.suffix}`, a, buildingId, null);
    }

    // ---- ผู้ใช้ครบ 4 role ----
    const people: Person[] = [];
    const addUser = async (email: string, fullName: string, role: UserRole, roomId: string | null = null) => {
      const id = randomUUID();
      // สร้างบัญชีก่อนช่วงข้อมูล 30 วัน ไม่งั้นจะมีใบที่ถูกแจ้งก่อนผู้แจ้งมีบัญชี
      await m.query(
        `INSERT INTO users (id, email, full_name, role, room_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, email, fullName, role, roomId, new Date(now.getTime() - 60 * 24 * HOUR)],
      );
      people.push({ id, role, roomId });
    };

    await addUser('demo.admin@kmitl.ac.th', 'ผู้ดูแลระบบ', 'admin');
    for (let i = 1; i <= 2; i++) await addUser(`demo.staff${i}@kmitl.ac.th`, `เจ้าหน้าที่หอพัก คนที่ ${i}`, 'staff');
    for (let i = 1; i <= 3; i++) await addUser(`demo.tech${i}@kmitl.ac.th`, `ช่างซ่อมบำรุง คนที่ ${i}`, 'technician');
    // ห้องละ 2 คน 3 ห้องแรกของแต่ละอาคาร (รูมเมทยืนยันแทนกันได้) + 2 คนที่ยังไม่ถูกผูกห้อง
    const housedRooms = buildingCodes.flatMap((code) => rooms.filter((r) => r.buildingCode === code).slice(0, 3));
    for (let i = 1; i <= 14; i++) {
      const room = i <= 12 ? housedRooms[Math.floor((i - 1) / 2)].id : null;
      await addUser(`demo.s00${String(i).padStart(2, '0')}@kmitl.ac.th`, `นักศึกษา คนที่ ${i}`, 'student', room);
    }

    const students = people.filter((p) => p.role === 'student');
    const housed = students.filter((p) => p.roomId);
    const staff = people.filter((p) => p.role === 'staff');
    const techs = people.filter((p) => p.role === 'technician');
    const commonAssets = assets.filter((a) => !a.roomId);

    // ---- วางแผนใบแจ้งซ่อมในหน่วยความจำก่อน เพื่อเรียงเลขใบตามเวลาแจ้งจริง ----
    interface Planned {
      id: string;
      asset: Asset;
      scope: TicketScope;
      reporter: Person;
      createdAt: Date;
      status: TicketStatus;
      priority: TicketPriority;
      assignedTo: string | null;
      permissionToEnter: boolean;
      scheduledAt: Date | null;
      resolvedAt: Date | null;
      closedAt: Date | null;
      confirmedBy: string | null;
      closeReason: CloseReason | null;
      disputedAt: Date | null;
      reopenCount: number;
      updatedAt: Date;
      logs: { from: TicketStatus | null; to: TicketStatus; actorId: string | null; note: string | null; at: Date }[];
      secondReporter: Person | null;
    }

    // ครุภัณฑ์ที่มีใบเปิดอยู่แล้ว — idx_tickets_asset_open ยอมให้มีได้ใบเดียว
    const busy = new Set<string>();
    const planned: Planned[] = [];

    for (const sc of SCENARIOS) {
      for (let i = 0; i < sc.count; i++) {
        const finalStatus = sc.steps.at(-1)?.to ?? 'open';
        const needsFree = isOpenStatus(finalStatus);

        let reporter: Person;
        let asset: Asset | undefined;
        for (let tries = 0; !asset; tries++) {
          if (tries > 200) throw new Error('ครุภัณฑ์ว่างไม่พอสำหรับ scenario ที่กำหนด');
          reporter = sc.scope === 'room' ? pick(housed) : pick(rng() < 0.2 ? staff : students);
          const pool = sc.scope === 'room' ? assets.filter((a) => a.roomId === reporter.roomId) : commonAssets;
          const candidate = pick(pool);
          if (!needsFree || !busy.has(candidate.id)) asset = candidate;
        }
        if (needsFree) busy.add(asset.id);

        const waits = sc.steps.map((s) => between(s.hours ?? [2, 48]));
        const elapsed = waits.reduce((a, b) => a + b, 0);
        const tail = between(sc.tail ?? [1, Math.max(2, WINDOW_HOURS - elapsed)]);
        let at = new Date(now.getTime() - (elapsed + tail) * HOUR);

        const t: Planned = {
          id: randomUUID(),
          asset,
          scope: sc.scope,
          reporter: reporter!,
          createdAt: at,
          status: 'open',
          priority: pick<TicketPriority>(['normal', 'normal', 'normal', 'high', 'low', 'urgent']),
          assignedTo: null,
          permissionToEnter: sc.scope === 'room' && rng() < 0.7,
          scheduledAt: null,
          resolvedAt: null,
          closedAt: null,
          confirmedBy: null,
          closeReason: null,
          disputedAt: null,
          reopenCount: 0,
          updatedAt: at,
          logs: [{ from: null, to: 'open', actorId: reporter!.id, note: null, at }],
          secondReporter: null,
        };

        sc.steps.forEach((step, idx) => {
          at = new Date(at.getTime() + waits[idx] * HOUR);
          const from = t.status;
          if (step.to === 'assigned' && from === 'open') {
            t.assignedTo = pick(techs).id;
            // ใบห้องพักที่ผู้แจ้งไม่อนุญาตให้เข้าห้อง ต้องมีนัดก่อนช่างเริ่มงานได้ (DESIGN 6.7)
            if (sc.scope === 'room' && !t.permissionToEnter) t.scheduledAt = new Date(at.getTime() + HOUR);
          }
          if (step.to === 'assigned' && from === 'resolved') {
            t.resolvedAt = null;
            t.reopenCount += 1;
          }
          if (step.to === 'resolved') t.resolvedAt = at;
          if (step.to === 'closed') {
            t.closedAt = at;
            t.confirmedBy = step.by === 'system' ? null : step.by === 'reporter' ? t.reporter.id : pick(staff).id;
            t.closeReason =
              step.by === 'system' ? 'auto_closed' : step.by === 'reporter' ? 'user_confirmed' : 'staff_confirmed';
          }
          const actorId =
            step.by === 'system'
              ? null
              : step.by === 'reporter'
                ? t.reporter.id
                : step.by === 'tech'
                  ? t.assignedTo
                  : step.to === 'closed'
                    ? t.confirmedBy
                    : pick(staff).id;
          t.logs.push({ from, to: step.to, actorId, note: step.note ?? null, at });
          t.status = step.to;
          t.updatedAt = at;
        });

        if (sc.disputed && t.resolvedAt) {
          t.disputedAt = new Date(t.resolvedAt.getTime() + 5 * HOUR);
          t.secondReporter = students.find((s) => s.id !== t.reporter.id) ?? null;
          t.updatedAt = t.disputedAt;
        }
        planned.push(t);
      }
    }

    // ---- เขียนลง DB เรียงตามเวลาแจ้ง: เลขใบต้องเดินตามเวลา และปี พ.ศ. คิดตามเวลาไทย ----
    planned.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const counters = new Map<number, number>();

    for (const t of planned) {
      const beYear = thaiBuddhistYear(t.createdAt);
      const seq = (counters.get(beYear) ?? 0) + 1;
      counters.set(beYear, seq);

      await m.query(
        `INSERT INTO tickets (id, ticket_no, batch_id, asset_id, scope, room_id, reporter_id, assigned_to, status, priority,
                              title, description, report_count, reopen_count, permission_to_enter, scheduled_at,
                              resolved_at, closed_at, confirmed_by, close_reason, disputed_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)`,
        [
          t.id,
          formatTicketNo(beYear, seq),
          randomUUID(),
          t.asset.id,
          t.scope,
          t.scope === 'room' ? t.asset.roomId : null,
          t.reporter.id,
          t.assignedTo,
          t.status,
          t.priority,
          t.asset.title,
          null,
          t.secondReporter ? 2 : 1,
          t.reopenCount,
          t.permissionToEnter,
          t.scheduledAt,
          t.resolvedAt,
          t.closedAt,
          t.confirmedBy,
          t.closeReason,
          t.disputedAt,
          t.createdAt,
          t.updatedAt,
        ],
      );

      for (const l of t.logs) {
        await m.query(
          `INSERT INTO ticket_status_logs (ticket_id, from_status, to_status, actor_id, note, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [t.id, l.from, l.to, l.actorId, l.note, l.at],
        );
      }

      await m.query(`INSERT INTO ticket_reporters (ticket_id, user_id, created_at) VALUES ($1, $2, $3)`, [
        t.id,
        t.reporter.id,
        t.createdAt,
      ]);
      if (t.secondReporter && t.disputedAt) {
        await m.query(`INSERT INTO ticket_reporters (ticket_id, user_id, created_at) VALUES ($1, $2, $3)`, [
          t.id,
          t.secondReporter.id,
          t.disputedAt,
        ]);
        await m.query(
          `INSERT INTO ticket_audit_logs (ticket_id, action, actor_id, detail, created_at) VALUES ($1, 'same_issue', $2, $3, $4)`,
          [t.id, t.secondReporter.id, JSON.stringify({ report_count: 2 }), t.disputedAt],
        );
      }
    }

    // ตัวนับต้องตามทันเลขที่ใช้ไปแล้ว ไม่งั้นใบแรกที่แจ้งผ่าน API จะชน UNIQUE ของ ticket_no
    for (const [beYear, lastNo] of counters) {
      await m.query(`INSERT INTO ticket_counters (be_year, last_no) VALUES ($1, $2)`, [beYear, lastNo]);
    }

    return {
      buildings: buildingCodes.length,
      rooms: rooms.length,
      users: people.length,
      assets: assets.length,
      tickets: planned.length,
    };
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed ล้างข้อมูลทั้งหมด — ห้ามรันบน production');
  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
  await ds.initialize();
  try {
    const summary = await seed(ds);
    console.log('seed เสร็จ', summary);
  } catch (e) {
    if ((e as { code?: string }).code === '42P01') {
      throw new Error('ยังไม่มีตาราง — รัน `npm run migration:run` ก่อนแล้วค่อย seed');
    }
    throw e;
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
