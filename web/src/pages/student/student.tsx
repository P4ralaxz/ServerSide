import { useQuery } from '@tanstack/react-query';
import { listTickets } from '../../api/tickets';
import type { Ticket } from '../../api/types';
import { useMe } from '../../auth/RequireAuth';
import { isOpenTicket } from '../../ui/status';
import { TabBar } from '../../ui/TabBar';

// "ส่งซ่อมแล้ว" = ใบของห้องตัวเอง + ใบที่ตัวเองแจ้ง (เช่น ส่วนกลาง หรือห้องเก่าก่อนย้าย)
// ไม่ใช้ GET /tickets เปล่า ๆ เพราะนักศึกษามองเห็นใบส่วนกลางทุกอาคาร — รายการจะยาวด้วยใบของคนอื่น
export const MY_TICKETS_KEY = ['tickets', 'mine'] as const;

export function useMyTickets() {
  const me = useMe();
  return useQuery({
    queryKey: [...MY_TICKETS_KEY, me?.id],
    queryFn: async (): Promise<Ticket[]> => {
      const [room, mine] = await Promise.all([
        me?.room_id ? listTickets({ room_id: me.room_id, limit: 100 }) : Promise.resolve([]),
        listTickets({ mine: true, limit: 100 }),
      ]);
      const byId = new Map<string, Ticket>();
      for (const t of [...room, ...mine]) byId.set(t.id, t);
      return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });
}

// แถบล่าง 2 แท็บของนักศึกษา (UI-PLAN 5) — ตัวเลขบน "ส่งซ่อมแล้ว" = ใบที่ยังเปิดอยู่
export function StudentTabs({ active }: { active: 'report' | 'tickets' }) {
  const { data } = useMyTickets();
  const open = (data ?? []).filter(isOpenTicket).length;
  return (
    <TabBar
      active={active}
      tabs={[
        { key: 'report', label: 'แจ้งซ่อม', icon: 'qr', to: '/report' },
        { key: 'tickets', label: 'ส่งซ่อมแล้ว', icon: 'list', to: '/tickets', badge: open },
      ]}
    />
  );
}

// ที่ตั้งที่แสดงใต้ชื่อ — ห้อง หรืออาคาร + จุดของครุภัณฑ์ส่วนกลาง
export const whereOf = (x: {
  room: { room_no: string } | null;
  building: { name: string };
  location_note?: string | null;
}): string =>
  x.room ? `ห้อง ${x.room.room_no}` : [x.building.name, x.location_note ?? 'ส่วนกลาง'].filter(Boolean).join(' · ');

// ที่ตั้งสำหรับช่างและ Staff — เห็นหลายอาคาร เลขห้องซ้ำกันข้ามอาคารได้ จึงต้องบอกอาคารด้วย
export const placeOf = (x: { room: { room_no: string } | null; building: { name: string } }): string =>
  x.room ? `${x.building.name} ห้อง ${x.room.room_no}` : `${x.building.name} · ส่วนกลาง`;
