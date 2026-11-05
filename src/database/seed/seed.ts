import '../../common/time/utc';
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { formatTicketNo, thaiBuddhistYear } from '../../common/time/thai-year';
import { AuditAction, CloseReason, TicketPriority, TicketScope, TicketStatus, UserRole } from '../../domain/enums';
import { AUTO_URGENT_REPORT_COUNT } from '../../domain/limits';
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

interface SeedComment {
  by: Exclude<Who, 'system'>;
  body: string;
  internal?: boolean;
}
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
  // จำนวนคนที่แจ้งเรื่องเดียวกันรวมผู้แจ้ง (same-issue) — เกิน AUTO_URGENT_REPORT_COUNT แล้วระบบยกเป็น urgent ให้
  crowd?: number;
  // ความเห็นหลังขั้นสุดท้าย — เดโมเปิดใบแล้วเห็นการคุยกันจริง รวมความเห็นภายในที่ผู้พักไม่เห็น
  comments?: SeedComment[];
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
  {
    scope: 'room',
    count: 1,
    steps: [assign, start, parts],
    tail: [5, 60],
    comments: [
      { by: 'tech', body: 'สั่งอะไหล่แล้ว ร้านแจ้งว่าได้ของภายใน 3 วัน' },
      { by: 'tech', body: 'อะไหล่ราคา 850 บาท ใช้งบซ่อมบำรุงของหอ', internal: true },
      { by: 'reporter', body: 'รับทราบครับ ระหว่างนี้ใช้ได้ปกติ' },
    ],
  },
  { scope: 'room', count: 1, steps: [assign, start, resolve], tail: [2, 40] },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [2, 40] },
  // เลย 72 ชม. แล้วแต่ยังไม่ถูกปิด — ไว้กดโชว์ POST /admin/jobs/auto-close/run
  { scope: 'room', count: 2, steps: [assign, start, resolve], tail: [80, 120] },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [80, 120] },
  // มีคนกด same-issue หลัง resolved → job ต้องข้ามใบนี้
  { scope: 'common_area', count: 1, steps: [assign, start, resolve], tail: [80, 100], disputed: true },
  // Staff ปิดทั้งที่ยังมีคนแย้ง — รายงานต้องแยกกรณีนี้ออกมาได้ (disputed_at ไม่ถูกล้างตอน confirm)
  { scope: 'common_area', count: 1, steps: [assign, start, resolve, confirm('common_area')], disputed: true },
  // ถูกส่งกลับแล้วยังรอช่างอยู่ — กลุ่ม "ถูกส่งกลับ" ของช่างและตัวกรอง reopened=true ของ Staff ต้องมีของ
  {
    scope: 'room',
    count: 1,
    steps: [assign, start, resolve, reopen('room')],
    tail: [1, 20],
    comments: [
      { by: 'reporter', body: 'เป็นอีกแล้วตอนกลางคืน ถ่ายคลิปไว้ให้ดูได้ครับ' },
      { by: 'staff', body: 'ส่งกลับให้ช่างคนเดิมแล้ว ถ้าเป็นอีกรอบจะเปลี่ยนเครื่องใหม่', internal: true },
    ],
  },
  { scope: 'common_area', count: 1, steps: [assign, start, resolve, reopen('common_area')], tail: [1, 20] },
  // เดโม same-issue: ขาดอีกคนเดียวจะถูกยกเป็นด่วนมาก — นักศึกษาที่ยังไม่ได้กดกดสดตอนนำเสนอได้ (DESIGN 6.5)
  { scope: 'common_area', count: 1, steps: [], tail: [12, 24], crowd: AUTO_URGENT_REPORT_COUNT },
  // ใบที่ระบบยกเป็นด่วนมากไปแล้ว — มี audit auto_escalate ที่ไม่มีผู้กด
  { scope: 'common_area', count: 1, steps: [assign], tail: [12, 24], crowd: AUTO_URGENT_REPORT_COUNT + 2 },
];

interface Asset {
  id: string;
  code: string;
  roomId: string | null;
  title: string;
  symptom: string;
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
  {
    suffix: 'G-STRUCT',
    name: 'ผนัง / ฝ้า / พื้น',
    category: 'structure',
    title: 'ฝ้าเพดานมีคราบน้ำรั่ว',
    symptom: 'มีคราบน้ำเป็นวงตรงมุมห้อง ฝนตกแล้วหยด',
  },
  {
    suffix: 'G-DOOR',
    name: 'ประตู / หน้าต่าง / กุญแจ',
    category: 'door_window',
    title: 'กุญแจประตูฝืด ไขไม่เข้า',
    symptom: 'ต้องกดลูกบิดค้างไว้ถึงจะไขได้',
  },
  {
    suffix: 'G-ELEC',
    name: 'ไฟฟ้าทั่วไป',
    category: 'electrical',
    title: 'ปลั๊กไฟไม่มีไฟ',
    symptom: 'ปลั๊กข้างโต๊ะเสียบแล้วไฟไม่เข้า',
  },
  {
    suffix: 'G-PLUMB',
    name: 'ประปาทั่วไป',
    category: 'plumbing',
    title: 'ท่อระบายน้ำมีกลิ่นเหม็น',
    symptom: 'มีกลิ่นขึ้นมาจากท่อในห้องน้ำตอนกลางคืน',
  },
];

const ROOM_ASSETS = [
  {
    suffix: 'AC',
    name: 'เครื่องปรับอากาศ',
    category: 'electrical',
    title: 'แอร์ไม่เย็น',
    symptom: 'เปิด 25 องศาแล้วมีแต่ลม ไม่เย็น',
  },
  {
    suffix: 'LIGHT',
    name: 'หลอดไฟเพดาน',
    category: 'electrical',
    title: 'หลอดไฟกะพริบ',
    symptom: 'เปิดแล้วกะพริบ บางครั้งไม่ติด',
  },
  {
    suffix: 'TAP',
    name: 'ก๊อกน้ำอ่างล้างหน้า',
    category: 'plumbing',
    title: 'ก๊อกน้ำรั่ว',
    symptom: 'น้ำหยดตลอดแม้ปิดสุดแล้ว',
  },
  {
    suffix: 'BED',
    name: 'เตียงนอน',
    category: 'furniture',
    title: 'ขาเตียงหัก',
    symptom: 'ขาเตียงฝั่งหัวเตียงหัก เตียงเอียง',
  },
  ...GENERAL_ASSETS,
];

const COMMON_ASSETS = [
  {
    suffix: 'LIFT',
    name: 'ลิฟต์โดยสาร',
    category: 'elevator',
    note: 'ลิฟต์ฝั่งตะวันออก',
    title: 'ลิฟต์ค้างระหว่างชั้น',
    symptom: 'ประตูลิฟต์ปิดไม่สนิท ค้างบ่อยช่วงชั้น 3',
  },
  {
    suffix: 'WATER',
    name: 'ตู้กดน้ำดื่ม',
    category: 'appliance',
    note: 'โถงชั้น 1',
    title: 'ตู้กดน้ำไม่เย็น',
    symptom: 'กดฝั่งน้ำเย็นแล้วได้น้ำอุณหภูมิห้อง',
  },
  {
    suffix: 'WASH',
    name: 'เครื่องซักผ้า',
    category: 'appliance',
    note: 'ห้องซักล้างชั้น 1',
    title: 'เครื่องซักผ้าไม่ปั่น',
    symptom: 'ครบรอบแล้วผ้ายังเปียกโชก ไม่ปั่นหมาด',
  },
  {
    suffix: 'HALL',
    name: 'ไฟทางเดิน',
    category: 'electrical',
    note: 'ทางเดินชั้น 3',
    title: 'ไฟทางเดินดับ',
    symptom: 'ไฟดับทั้งแถวช่วงหน้าลิฟต์',
  },
  ...GENERAL_ASSETS.map((a) => ({ ...a, note: 'พื้นที่ส่วนกลางทั้งอาคาร' })),
];

// ชื่อของบัญชีทีม (ห้องละ 2 ชื่อต่อคนสำหรับ staff / tech, 6 ชื่อต่อคนสำหรับนักศึกษา) — รองรับ MAX_SEED_OWNERS คน
// ช่างห้ามขึ้นต้นด้วย "ช่าง" เหตุผลเดียวกับชุด demo.* ("ส่งกลับให้ช่างช่าง…")
const TEAM_TECH = [
  'สมชาย ใจดี',
  'ประเสริฐ มั่นคง',
  'อนุชา ทองดี',
  'วีระพงษ์ สายไฟ',
  'ไพโรจน์ แก้วใส',
  'สุรชัย พลังดี',
  'บุญมี ทองคำ',
  'ชาตรี ศรีเมือง',
  'ณรงค์ ดวงดี',
  'เกียรติ ภักดี',
];
const TEAM_STAFF = [
  'วิภา สมบูรณ์',
  'ธีรพงษ์ แสงทอง',
  'กนกพร ใจงาม',
  'ปิยะ วงศ์ดี',
  'สุดา รุ่งเรือง',
  'อารีย์ ศรีสุข',
  'มาลี บุญมา',
  'ศักดิ์ชัย มีสุข',
  'รัตนา ทองแท้',
  'วิไล ใจเย็น',
];
const TEAM_STUDENT = [
  'ภูมิ รักเรียน',
  'ณิชา ใจดี',
  'ธนกร มั่นเพียร',
  'พิมพ์ชนก สุขใจ',
  'กันต์ ศรีวงศ์',
  'ปาริชาติ ทองดี',
  'ภาคิน วงศ์ไทย',
  'ชนิดา แสงทอง',
  'วรพล ศรีสวัสดิ์',
  'อรุณี มีสุข',
  'ศุภกร ใจกล้า',
  'นภัสสร แก้วมณี',
  'กฤษดา พึ่งบุญ',
  'เบญจวรรณ จันทร์เพ็ญ',
  'อนันต์ ทองมา',
  'ศิริพร สายบุญ',
  'ธีรเดช รุ่งโรจน์',
  'กมลชนก ศรีสุข',
  'ปกรณ์ บุญยืน',
  'สุนิสา ดีงาม',
  'อภิชาติ เพชรดี',
  'วรรณา ชื่นใจ',
  'ชยพล ทองสุข',
  'ลลิตา ศรีงาม',
  'ธนวัฒน์ ใจมั่น',
  'พรทิพย์ บุญเรือง',
  'สิทธิชัย แก้วกล้า',
  'จิราพร ทองใบ',
  'นพดล สายสุข',
  'มณีรัตน์ ดวงแก้ว',
];

export interface SeedSummary {
  buildings: number;
  rooms: number;
  users: number;
  assets: number;
  tickets: number;
}

// บัญชีของทีม (npm run seed -- you@kmitl.ac.th …) แทน demo.* — รหัส login เข้าเมลจริงของแต่ละคน
// ทุกคนได้ชุดเดียวกัน เดโมครบทุกขั้นได้ด้วยบัญชีของคนเดียว (docs/demo.md):
//   +student1 +student2 ห้องเดียวกัน · +student3 อีกห้อง ไม่เคยแจ้งอะไร (ใช้เป็น "คนห้องอื่น" และ "คนที่ 11")
//   +tech1 +tech2 · +staff1 +staff2 · +admin1 · +resident1–3 ผู้พักในข้อมูลเดโม ไม่มีใคร login
export const MAX_SEED_OWNERS = 5;
const PLAIN_UNIVERSITY_EMAIL = /^[^@s+]+@kmitl.ac.th$/;

export interface SeedOptions {
  now?: Date;
  owners?: string[];
}

export async function seed(ds: DataSource, opts: SeedOptions = {}): Promise<SeedSummary> {
  const now = opts.now ?? new Date();
  const owners = (opts.owners ?? []).map((o) => o.trim().toLowerCase());
  if (owners.length > MAX_SEED_OWNERS) throw new Error(`ใส่อีเมลได้ไม่เกิน ${MAX_SEED_OWNERS} คน (ห้อง 301–305)`);
  for (const o of owners)
    if (!PLAIN_UNIVERSITY_EMAIL.test(o)) throw new Error(`${o}: ต้องเป็นอีเมล @kmitl.ac.th ไม่มี +แท็ก`);
  const rng = mulberry32(2569);
  const between = ([min, max]: Range) => min + rng() * (max - min);
  const pick = <T>(xs: T[]): T => xs[Math.floor(rng() * xs.length)];

  return ds.transaction(async (m: EntityManager) => {
    await m.query(`
      TRUNCATE ticket_comments, ticket_reporters, ticket_audit_logs, ticket_status_logs, tickets,
               ticket_counters, assets, login_codes, users, rooms, buildings
      RESTART IDENTITY CASCADE`);

    // ---- อาคาร / ห้อง / ครุภัณฑ์ ----
    const rooms: { id: string; buildingCode: string; roomNo: string }[] = [];
    const assets: Asset[] = [];
    const addAsset = async (
      code: string,
      a: { name: string; category: string; title: string; symptom: string; note?: string },
      buildingId: string,
      roomId: string | null,
    ) => {
      const id = randomUUID();
      await m.query(
        `INSERT INTO assets (id, asset_code, name, category, building_id, room_id, location_note, qr_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, code, a.name, a.category, buildingId, roomId, a.note ?? null, randomBytes(16).toString('hex')],
      );
      assets.push({ id, code, roomId, title: a.title, symptom: a.symptom });
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
          rooms.push({ id: roomId, buildingCode: code, roomNo });
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
      const p = { id, role, roomId };
      people.push(p);
      return p;
    };

    // students = คนที่กดแจ้ง / เจอปัญหาเดียวกันในข้อมูลได้ · housed = ผู้แจ้งใบห้องพักของ scenario สุ่ม
    let students: Person[];
    let housed: Person[];
    const team: { student1: Person; tech1: Person; staff1: Person; roomCode: string }[] = [];
    if (owners.length === 0) {
      await addUser('demo.admin@kmitl.ac.th', 'ผู้ดูแลระบบ', 'admin');
      // ชื่อคนจริงแบบเดียวกับต้นแบบหน้าจอ — หน้าจอเขียนประโยคอย่าง "ส่งกลับให้ช่างสมชายแล้ว"
      // ถ้าชื่อในระบบขึ้นต้นด้วย "ช่าง" เอง ประโยคจะกลายเป็น "ช่างช่าง…"
      const staffNames = ['วิภา สมบูรณ์', 'ธีรพงษ์ แสงทอง'];
      const techNames = ['สมชาย ใจดี', 'ประเสริฐ มั่นคง', 'อนุชา ทองดี'];
      for (let i = 1; i <= 2; i++) await addUser(`demo.staff${i}@kmitl.ac.th`, staffNames[i - 1], 'staff');
      for (let i = 1; i <= 3; i++) await addUser(`demo.tech${i}@kmitl.ac.th`, techNames[i - 1], 'technician');
      // ห้องละ 2 คน 3 ห้องแรกของแต่ละอาคาร (รูมเมทยืนยันแทนกันได้) + 2 คนที่ยังไม่ถูกผูกห้อง
      const housedRooms = buildingCodes.flatMap((code) => rooms.filter((r) => r.buildingCode === code).slice(0, 3));
      for (let i = 1; i <= 14; i++) {
        const room = i <= 12 ? housedRooms[Math.floor((i - 1) / 2)].id : null;
        await addUser(`demo.s00${String(i).padStart(2, '0')}@kmitl.ac.th`, `นักศึกษา คนที่ ${i}`, 'student', room);
      }
      students = people.filter((p) => p.role === 'student');
      housed = students.filter((p) => p.roomId);
    } else {
      const roomOf = (code: string, no: string) => rooms.find((r) => r.buildingCode === code && r.roomNo === no)!.id;
      students = [];
      housed = [];
      for (const [k, owner] of owners.entries()) {
        const [local, domain] = owner.split('@');
        const mail = (tag: string) => `${local}+${tag}@${domain}`;
        const no = `30${k + 1}`;
        // ห้องของแต่ละคนตายตัว เอกสารเดโมอ้างได้: +student1/2 → D1-30x · +student3 → D2-30x · resident2/3 → D1-40x
        const roomA = roomOf('D1', no);
        const roomB = roomOf('D2', no);
        const roomC = roomOf('D1', `40${k + 1}`);
        await addUser(mail('admin1'), `ผู้ดูแลระบบ ${local}`, 'admin');
        const staff1 = await addUser(mail('staff1'), TEAM_STAFF[k * 2], 'staff');
        await addUser(mail('staff2'), TEAM_STAFF[k * 2 + 1], 'staff');
        const tech1 = await addUser(mail('tech1'), TEAM_TECH[k * 2], 'technician');
        await addUser(mail('tech2'), TEAM_TECH[k * 2 + 1], 'technician');
        const student1 = await addUser(mail('student1'), TEAM_STUDENT[k * 6], 'student', roomA);
        const student2 = await addUser(mail('student2'), TEAM_STUDENT[k * 6 + 1], 'student', roomA);
        // +student3 ไม่อยู่ใน students / housed — ต้องไม่เคยแจ้งหรือกดเจอปัญหาเดียวกัน ถึงจะเป็น "คนที่ 11" ได้
        await addUser(mail('student3'), TEAM_STUDENT[k * 6 + 2], 'student', roomB);
        const residents = [
          await addUser(mail('resident1'), TEAM_STUDENT[k * 6 + 3], 'student', roomB),
          await addUser(mail('resident2'), TEAM_STUDENT[k * 6 + 4], 'student', roomC),
          await addUser(mail('resident3'), TEAM_STUDENT[k * 6 + 5], 'student', roomC),
        ];
        students.push(student1, student2, ...residents);
        // ใบสุ่มของห้องพักใช้แต่ผู้พักเสริม — ห้องของ +student1/2 ว่างไว้ให้แจ้งสดตอนเดโม
        housed.push(...residents);
        team.push({ student1, tech1, staff1, roomCode: `D1-${no}` });
      }
    }
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
      // สิ่งที่ขั้นไม่เปลี่ยน (DESIGN 3.2) — รายงานและหน้าประวัติต้องมีของจริงให้แสดงตอนเดโม
      audits: { action: AuditAction; actorId: string | null; detail: Record<string, unknown>; at: Date }[];
      // ใบที่แจ้งพร้อมกันในคำขอเดียวใช้ค่าเดียวกัน — ไม่ระบุ = ใบเดี่ยว
      batchId: string | null;
      // คนที่กดเจอปัญหาเดียวกันหลังผู้แจ้ง เรียงตามเวลา — report_count = 1 + จำนวนนี้
      sameIssue: { user: Person; at: Date }[];
      escalatedAt: Date | null;
      comments: { authorId: string; body: string; internal: boolean; at: Date }[];
    }

    // ครุภัณฑ์ที่มีใบเปิดอยู่แล้ว — idx_tickets_asset_open ยอมให้มีได้ใบเดียว
    const busy = new Set<string>();
    const planned: Planned[] = [];

    for (const sc of SCENARIOS) {
      for (let i = 0; i < sc.count; i++) {
        const finalStatus = sc.steps.at(-1)?.to ?? 'open';
        const needsFree = isOpenStatus(finalStatus);

        // ใบที่จบด้วยการถอนคำแจ้งต้องมีผู้แจ้งเป็นนักศึกษา: /cancel เป็นสิทธิ์ของ student เท่านั้น (DESIGN 3.5)
        // ถ้าปล่อยให้ staff เป็นผู้แจ้งใบส่วนกลางที่ถูกยกเลิก seed จะมี log ที่ API สร้างไม่ได้
        const cancelled = sc.steps.some((s) => s.to === 'cancelled');
        let reporter: Person;
        let asset: Asset | undefined;
        for (let tries = 0; !asset; tries++) {
          if (tries > 200) throw new Error('ครุภัณฑ์ว่างไม่พอสำหรับ scenario ที่กำหนด');
          // same-issue กดได้เฉพาะนักศึกษา (DESIGN 12.1) — ใบที่มีคนแจ้งตามเยอะจึงให้นักศึกษาเป็นผู้แจ้งแรกด้วย
          reporter =
            sc.scope === 'room' ? pick(housed) : pick(!cancelled && !sc.crowd && rng() < 0.2 ? staff : students);
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
          audits: [],
          batchId: null,
          sameIssue: [],
          escalatedAt: null,
          comments: [],
        };
        // ใบเดโม same-issue เริ่มที่ปกติ — ให้เห็นว่าระบบเป็นคนยกเป็นด่วนมาก ไม่ใช่ Staff ตั้งไว้แต่แรก
        if (sc.crowd) t.priority = 'normal';

        // Staff ปรับความด่วนหลังอ่านเรื่อง — ใบที่ไม่ใช่ normal ต้องมีร่องรอยว่าใครปรับ ไม่ใช่โผล่มาเอง
        if (t.priority !== 'normal') {
          t.audits.push({
            action: 'priority',
            actorId: pick(staff).id,
            detail: { from: 'normal', to: t.priority },
            at: new Date(at.getTime() + 0.3 * HOUR),
          });
        }

        sc.steps.forEach((step, idx) => {
          at = new Date(at.getTime() + waits[idx] * HOUR);
          const from = t.status;
          if (step.to === 'assigned' && from === 'open') {
            t.assignedTo = pick(techs).id;
            // มอบหมายครั้งแรกลง audit assign คู่กับ status log — /assign ของจริงเขียนสองที่เหมือนกัน (DESIGN 6.9)
            t.audits.push({
              action: 'assign',
              actorId: pick(staff).id,
              detail: { from: null, to: t.assignedTo },
              at,
            });
            // ใบห้องพักที่ผู้แจ้งไม่อนุญาตให้เข้าห้อง ต้องมีนัดก่อนช่างเริ่มงานได้ (DESIGN 6.7)
            if (sc.scope === 'room' && !t.permissionToEnter) {
              t.scheduledAt = new Date(at.getTime() + HOUR);
              t.audits.push({
                action: 'schedule',
                actorId: t.assignedTo,
                detail: { from: null, to: t.scheduledAt.toISOString() },
                at: new Date(at.getTime() + 0.2 * HOUR),
              });
            }
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
          // คนแย้งต้องกดก่อน Staff ปิดใบ — ใบที่ปิดแล้วจึงวางเวลาแย้งไว้กลางช่วงรอยืนยัน
          t.disputedAt = t.closedAt
            ? new Date((t.resolvedAt.getTime() + t.closedAt.getTime()) / 2)
            : new Date(t.resolvedAt.getTime() + 5 * HOUR);
          const disputer = students.find((s) => s.id !== t.reporter.id);
          if (disputer) t.sameIssue.push({ user: disputer, at: t.disputedAt });
          if (!t.closedAt) t.updatedAt = t.disputedAt;
        }

        if (sc.crowd) {
          // นักศึกษาคนอื่นทยอยกดหลังแจ้ง คนละครั้ง (ticket_reporters PK) — ห้ามเกินเวลาปัจจุบัน
          const others = students.filter((s) => s.id !== t.reporter.id).slice(0, sc.crowd - 1);
          others.forEach((user, k) => {
            const at = new Date(t.createdAt.getTime() + (k + 1) * 0.15 * HOUR);
            t.sameIssue.push({ user, at });
            // คนที่ทำให้ report_count เกินเกณฑ์ → ระบบยกเป็น urgent ครั้งเดียว (DESIGN 6.5)
            if (k + 2 > AUTO_URGENT_REPORT_COUNT && t.escalatedAt === null) {
              t.escalatedAt = at;
              t.priority = 'urgent';
            }
          });
        }

        // ความเห็นวางต่อจากเหตุการณ์สุดท้ายของใบ ทีละ 15 นาที และไม่เลยเวลาปัจจุบัน
        (sc.comments ?? []).forEach((c, k, all) => {
          const at = new Date(
            Math.min(t.updatedAt.getTime() + (k + 1) * 0.25 * HOUR, now.getTime() - (all.length - k) * 60_000),
          );
          const authorId = c.by === 'reporter' ? t.reporter.id : c.by === 'tech' ? t.assignedTo! : staff[0].id;
          t.comments.push({ authorId, body: c.body, internal: c.internal ?? false, at });
        });
        planned.push(t);
      }
    }

    // ---- ใบรออะไหล่ของแต่ละคนในทีม (เดโมขั้น 9) ----
    // ห้องของ +student1 · ช่าง +tech1 ของคนเดียวกัน — ใครคุมจอก็โชว์ความเห็นภายในได้ด้วยบัญชีของตัวเอง
    // เวลาเดินตามจริง: แจ้ง → มอบหมาย → เริ่มงาน → รออะไหล่ → ความเห็น และไม่เลยเวลาปัจจุบัน
    for (const [k, mine] of team.entries()) {
      const asset = assets.find((a) => a.code === `${mine.roomCode}-LIGHT`)!;
      busy.add(asset.id);
      const at = (h: number) => new Date(now.getTime() - (20 + k - h) * HOUR);
      const reporter = mine.student1;
      const tech = mine.tech1.id;
      planned.push({
        id: randomUUID(),
        asset,
        scope: 'room',
        reporter,
        createdAt: at(0),
        status: 'pending_parts',
        priority: 'normal',
        assignedTo: tech,
        permissionToEnter: true,
        scheduledAt: null,
        resolvedAt: null,
        closedAt: null,
        confirmedBy: null,
        closeReason: null,
        disputedAt: null,
        reopenCount: 0,
        updatedAt: at(3),
        logs: [
          { from: null, to: 'open', actorId: reporter.id, note: null, at: at(0) },
          { from: 'open', to: 'assigned', actorId: mine.staff1.id, note: null, at: at(1) },
          { from: 'assigned', to: 'in_progress', actorId: tech, note: null, at: at(2) },
          {
            from: 'in_progress',
            to: 'pending_parts',
            actorId: tech,
            note: 'หลอดไฟรุ่นเดียวกันหมด สั่งจากร้านแล้ว',
            at: at(3),
          },
        ],
        audits: [{ action: 'assign', actorId: mine.staff1.id, detail: { from: null, to: tech }, at: at(1) }],
        batchId: null,
        sameIssue: [],
        escalatedAt: null,
        comments: [
          { authorId: tech, body: 'สั่งหลอดไฟแล้ว ร้านแจ้งว่าได้ของภายใน 3 วัน', internal: false, at: at(3.25) },
          { authorId: tech, body: 'อะไหล่ราคา 850 บาท ใช้งบซ่อมบำรุงของหอ', internal: true, at: at(3.5) },
          { authorId: reporter.id, body: 'รับทราบครับ ระหว่างนี้ใช้โคมตั้งโต๊ะไปก่อน', internal: false, at: at(3.75) },
        ],
      });
    }

    // ---- ใบแบบ batch: แจ้งหลายรายการในคำขอเดียว = หลายใบที่ batch_id เดียวกัน (กฎข้อ 1) ----
    // ต้องมีของจริงใน seed ไม่งั้นหน้า "ส่งแจ้งซ่อมแล้ว" และการกรองด้วย batch_id ไม่มีอะไรให้ทดสอบ
    const batchReporter = housed.find(
      (p) => assets.filter((a) => a.roomId === p.roomId && !busy.has(a.id)).length >= 2,
    );
    if (batchReporter) {
      const batchId = randomUUID();
      const at = new Date(now.getTime() - between([2, 20]) * HOUR);
      for (const asset of assets.filter((a) => a.roomId === batchReporter.roomId && !busy.has(a.id)).slice(0, 2)) {
        busy.add(asset.id);
        planned.push({
          id: randomUUID(),
          asset,
          scope: 'room',
          reporter: batchReporter,
          createdAt: at,
          status: 'open',
          priority: 'normal',
          assignedTo: null,
          permissionToEnter: true,
          scheduledAt: null,
          resolvedAt: null,
          closedAt: null,
          confirmedBy: null,
          closeReason: null,
          disputedAt: null,
          reopenCount: 0,
          updatedAt: at,
          logs: [{ from: null, to: 'open', actorId: batchReporter.id, note: null, at }],
          audits: [],
          batchId,
          sameIssue: [],
          escalatedAt: null,
          comments: [],
        });
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
          t.batchId ?? randomUUID(),
          t.asset.id,
          t.scope,
          t.scope === 'room' ? t.asset.roomId : null,
          t.reporter.id,
          t.assignedTo,
          t.status,
          t.priority,
          t.asset.title,
          t.asset.symptom, // อาการบังคับที่ API (DESIGN 7.7) — ใบเดโมต้องมีเหมือนใบที่สร้างจากหน้าจอ
          1 + t.sameIssue.length,
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

      for (const a of t.audits) {
        await m.query(
          `INSERT INTO ticket_audit_logs (ticket_id, action, actor_id, detail, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [t.id, a.action, a.actorId, JSON.stringify(a.detail), a.at],
        );
      }

      await m.query(`INSERT INTO ticket_reporters (ticket_id, user_id, created_at) VALUES ($1, $2, $3)`, [
        t.id,
        t.reporter.id,
        t.createdAt,
      ]);
      // แถวเดียวกับที่ POST /same-issue เขียน: ticket_reporters + audit same_issue (+ auto_escalate ไม่มีผู้กด)
      for (const [k, s] of t.sameIssue.entries()) {
        await m.query(`INSERT INTO ticket_reporters (ticket_id, user_id, created_at) VALUES ($1, $2, $3)`, [
          t.id,
          s.user.id,
          s.at,
        ]);
        await m.query(
          `INSERT INTO ticket_audit_logs (ticket_id, action, actor_id, detail, created_at) VALUES ($1, 'same_issue', $2, $3, $4)`,
          [t.id, s.user.id, JSON.stringify({ report_count: k + 2 }), s.at],
        );
        if (s.at === t.escalatedAt) {
          await m.query(
            `INSERT INTO ticket_audit_logs (ticket_id, action, actor_id, detail, created_at) VALUES ($1, 'auto_escalate', NULL, $2, $3)`,
            [t.id, JSON.stringify({ from: 'normal', to: 'urgent', report_count: k + 2 }), s.at],
          );
        }
      }

      for (const c of t.comments) {
        await m.query(
          `INSERT INTO ticket_comments (ticket_id, author_id, body, is_internal, created_at) VALUES ($1, $2, $3, $4, $5)`,
          [t.id, c.authorId, c.body, c.internal, c.at],
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

// npm run seed                                   → บัญชี demo.* (เทสและ dev)
// npm run seed -- a@kmitl.ac.th b@kmitl.ac.th   → บัญชี +แท็ก ของทีม (นำเสนอ / ซ้อม)
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') throw new Error('seed ล้างข้อมูลทั้งหมด — ห้ามรันบน production');
  const owners = process.argv.slice(2);
  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
  await ds.initialize();
  try {
    const summary = await seed(ds, { owners });
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
