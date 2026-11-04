import '../common/time/utc';
import 'dotenv/config';
import { DataSource } from 'typeorm';
import { UserRole } from '../domain/enums';
import { dataSourceOptions } from '../database/data-source';

// npm run user:demo -- you@kmitl.ac.th
// สร้างบัญชีทดลองครบทุกบทบาทบน DB ที่ใช้งานจริง โดยใช้อีเมลแบบมี +แท็ก ของเจ้าของเครื่อง เช่น you+student1@kmitl.ac.th
// บัญชี demo.*@kmitl.ac.th จาก seed รับรหัสไม่ได้เพราะไม่มีกล่องเมลจริง — +แท็ก ส่งเข้ากล่องของ you@ ทุกบัญชี
// (เมลมหาวิทยาลัยเป็น Google Workspace ซึ่งรับ +แท็ก) จึงลองครบทุกบทบาทได้ด้วยกล่องเมลเดียว โดยไม่ต้องมีทางลัด login
// รันซ้ำได้: บัญชีที่มีอยู่แล้วไม่ถูกแก้ — admin อาจเปลี่ยนบทบาทหรือห้องไปแล้วจากหน้าผู้ใช้ สคริปต์ต้องไม่เขียนทับ
const PLAIN_UNIVERSITY_EMAIL = /^[^@\s+]+@kmitl\.ac\.th$/;

export const DEMO_ACCOUNTS: { tag: string; role: UserRole; fullName: string }[] = [
  { tag: 'student1', role: 'student', fullName: 'เดโม นักศึกษา 1' },
  { tag: 'student2', role: 'student', fullName: 'เดโม นักศึกษา 2' },
  { tag: 'tech1', role: 'technician', fullName: 'เดโม ช่าง 1' },
  { tag: 'tech2', role: 'technician', fullName: 'เดโม ช่าง 2' },
  { tag: 'staff1', role: 'staff', fullName: 'เดโม เจ้าหน้าที่ 1' },
  { tag: 'staff2', role: 'staff', fullName: 'เดโม เจ้าหน้าที่ 2' },
  { tag: 'admin1', role: 'admin', fullName: 'เดโม ผู้ดูแล 1' },
];

export interface DemoAccount {
  email: string;
  role: UserRole;
  room: string | null; // เช่น D1-304
  created: boolean;
}

export const ensureDemoAccounts = async (ds: DataSource, raw: string): Promise<DemoAccount[]> => {
  // normalize แบบเดียวกับ IsUniversityEmail — ไม่งั้น login ด้วยตัวพิมพ์ต่างกันแล้วหาบัญชีไม่เจอ
  const base = raw.trim().toLowerCase();
  if (!PLAIN_UNIVERSITY_EMAIL.test(base)) throw new Error('ต้องเป็นอีเมล @kmitl.ac.th ของคุณเอง (ไม่มี +แท็ก)');
  const [local, domain] = base.split('@');

  return ds.transaction(async (m) => {
    const out: DemoAccount[] = [];
    for (const a of DEMO_ACCOUNTS) {
      const email = `${local}+${a.tag}@${domain}`;
      const [existing]: { role: UserRole; room: string | null }[] = await m.query(
        `SELECT u.role, b.code || '-' || r.room_no AS room
           FROM users u
           LEFT JOIN rooms r ON r.id = u.room_id
           LEFT JOIN buildings b ON b.id = r.building_id
          WHERE u.email = $1 AND u.deleted_at IS NULL`,
        [email],
      );
      if (existing) {
        out.push({ email, role: existing.role, room: existing.room, created: false });
        continue;
      }

      // นักศึกษาต้องมีห้อง ไม่งั้นแจ้งซ่อมห้องพักไม่ได้ — ห้องแรกที่ยังว่าง นักศึกษาเดโมสองคนจึงได้ห้องเดียวกัน
      // (ลองกรณีรูมเมทยืนยันแทนกันได้) · lock ห้องก่อนนับ เหตุผลเดียวกับ assertRoomHasSpace ของ UsersService
      let room: { id: string; label: string } | undefined;
      if (a.role === 'student') {
        [room] = await m.query(
          `SELECT r.id, b.code || '-' || r.room_no AS label
             FROM rooms r JOIN buildings b ON b.id = r.building_id
            WHERE r.deleted_at IS NULL AND b.deleted_at IS NULL
              AND r.capacity > (SELECT count(*) FROM users u WHERE u.room_id = r.id AND u.deleted_at IS NULL)
            ORDER BY b.code, r.room_no
            LIMIT 1
              FOR UPDATE OF r`,
        );
      }
      await m.query(`INSERT INTO users (email, full_name, role, room_id) VALUES ($1, $2, $3, $4)`, [
        email,
        a.fullName,
        a.role,
        room?.id ?? null,
      ]);
      out.push({ email, role: a.role, room: room?.label ?? null, created: true });
    }
    return out;
  });
};

const main = async (): Promise<void> => {
  const email = process.argv[2];
  if (!email) throw new Error('ใส่อีเมลของคุณ: npm run user:demo -- you@kmitl.ac.th');
  const ds = new DataSource(dataSourceOptions(process.env.DATABASE_URL ?? ''));
  await ds.initialize();
  try {
    const rows = await ensureDemoAccounts(ds, email);
    for (const r of rows) {
      const room = r.room
        ? ` ห้อง ${r.room}`
        : r.role === 'student'
          ? ' (ไม่มีห้องว่าง — ผูกห้องเองที่หน้าผู้ใช้)'
          : '';
      console.log(`${r.created ? 'สร้าง' : 'มีอยู่แล้ว'}  ${r.role.padEnd(10)} ${r.email}${room}`);
    }
    console.log('รหัส login ของทุกบัญชีจะเข้ากล่องเมลของ', email.trim().toLowerCase());
  } finally {
    await ds.destroy();
  }
};

if (require.main === module) {
  main().catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
