import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState, type FormEvent } from 'react';
import { listBuildings, listRooms } from '../../api/assets';
import { ApiError } from '../../api/client';
import { EMAIL_TAKEN, errorMessage } from '../../api/errors';
import type { UpdateUserDto } from '../../api/schema.gen';
import type { Room, User } from '../../api/types';
import { createUser, listUsers, updateUser } from '../../api/users';
import { useMe } from '../../auth/RequireAuth';
import { Button } from '../../ui/Button';
import { useConfirm } from '../../ui/Confirm';
import { Loading } from '../../ui/Empty';
import { Field, invalidProps } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { livesInRoom, matchesRole, roleLabel, ROLES } from '../../ui/role';
import { useToast } from '../../ui/Toast';
import { DeskBar, DeskPage } from '../staff/desk';

type Role = User['role'];
const USERS_KEY = ['users'] as const;

const nameOf = (u: User): string => u.full_name ?? u.email;

// จัดการผู้ใช้ของ admin (ต้นแบบแท็บ Admin) — เปลี่ยนบทบาท ผูกห้อง ระงับ / เปิดใช้ และเพิ่มบัญชีล่วงหน้า
// กฎทั้งหมดอยู่ที่ API (UsersService): แก้บทบาทตัวเองไม่ได้ · ช่างที่มีงานค้างเปลี่ยนบทบาท/ระงับไม่ได้ · ห้องเต็ม
// หน้านี้แค่ไม่โชว์ปุ่มที่รู้แน่ว่าทำไม่ได้ (แถวของตัวเอง) แล้วแสดง error ของ API ตาม code
export function UsersPage() {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<Role | ''>('');
  const [rowError, setRowError] = useState<string | null>(null);

  const users = useQuery({ queryKey: USERS_KEY, queryFn: listUsers });
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: listBuildings });

  const update = useMutation({
    mutationFn: (a: { user: User; body: UpdateUserDto; done: string }) => updateUser(a.user.id, a.body),
    onSuccess: (_u, a) => {
      setRowError(null);
      toast(a.done);
    },
    onError: (e, a) => setRowError(`${nameOf(a.user)}: ${errorMessage(e)}`),
    // สำเร็จหรือไม่ก็โหลดใหม่ — select กลับไปเป็นค่าจริงในฐานข้อมูล ไม่ค้างค่าที่เลือกแต่ API ไม่รับ
    onSettled: () => qc.invalidateQueries({ queryKey: USERS_KEY }),
  });

  // จำนวนคนในแต่ละห้อง นับจากรายชื่อทั้งหมดแบบเดียวกับที่ API นับตอนเช็คห้องเต็ม (รวมบัญชีที่ถูกระงับ)
  const occupants = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of users.data ?? []) if (u.room_id) m.set(u.room_id, (m.get(u.room_id) ?? 0) + 1);
    return m;
  }, [users.data]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users.data ?? []).filter(
      (u) =>
        matchesRole(u.role, roleFilter) && (!q || u.email.includes(q) || (u.full_name ?? '').toLowerCase().includes(q)),
    );
  }, [users.data, search, roleFilter]);

  const roomName = (id: string): string => rooms.data?.find((r) => r.id === id)?.room_no ?? '';

  const changeRole = async (u: User, role: Role) => {
    // นักศึกษาที่ผูกห้องอยู่แล้วไปเป็นบทบาทอื่น → ถอดออกจากห้องในคำขอเดียวกัน
    // ไม่งั้นช่างโดน TECHNICIAN_CANNOT_HAVE_ROOM และ Staff จะมีห้องค้างที่หน้านี้ไม่แสดง
    const leaveRoom = u.room_id !== null && !livesInRoom(role);
    const ok = await confirm({
      title: 'เปลี่ยนบทบาท',
      body: (
        <>
          เปลี่ยนบทบาทของ <b>{nameOf(u)}</b> จาก{roleLabel(u.role)}เป็น<b>{roleLabel(role)}</b>
          {leaveRoom && <> และถอดออกจากห้องพัก ห้อง {roomName(u.room_id!)}</>} มีผลทันทีที่ผู้ใช้ทำรายการครั้งถัดไป
        </>
      ),
      confirmLabel: 'เปลี่ยนบทบาท',
    });
    if (!ok) return;
    update.mutate({
      user: u,
      body: leaveRoom ? { role, room_id: null } : { role },
      done: `เปลี่ยน ${nameOf(u)} เป็น${roleLabel(role)}แล้ว`,
    });
  };

  const changeRoom = (u: User, roomId: string) =>
    update.mutate({
      user: u,
      body: { room_id: roomId || null },
      done: roomId ? `ผูก ${nameOf(u)} กับห้อง ${roomName(roomId)} แล้ว` : `ถอด ${nameOf(u)} ออกจากห้องแล้ว`,
    });

  const toggleActive = async (u: User) => {
    const ok =
      !u.is_active ||
      (await confirm({
        title: 'ระงับบัญชี',
        body: (
          <>
            <b>{nameOf(u)}</b> จะใช้งานระบบไม่ได้ทันที จนกว่าจะเปิดใช้บัญชีอีกครั้ง
          </>
        ),
        confirmLabel: 'ระงับบัญชี',
        danger: true,
      }));
    if (!ok) return;
    update.mutate({
      user: u,
      body: { is_active: !u.is_active },
      done: u.is_active ? `ระงับบัญชี ${nameOf(u)} แล้ว` : `เปิดใช้บัญชี ${nameOf(u)} แล้ว`,
    });
  };

  return (
    <DeskPage>
      <div className="desk">
        <DeskBar active="users" />
        <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="rtitle">
            <h1 style={{ fontSize: 20 }}>ผู้ใช้</h1>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input
                className="select"
                type="search"
                placeholder="ค้นอีเมลหรือชื่อ"
                aria-label="ค้นอีเมลหรือชื่อ"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <select
                className="select"
                aria-label="กรองตามบทบาท"
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as Role | '')}
              >
                <option value="">ทุกบทบาท</option>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {roleLabel(r)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <AddUser onAdded={() => qc.invalidateQueries({ queryKey: USERS_KEY })} />

          {rowError && <Notice tone="bad">{rowError}</Notice>}

          {users.isPending && <Loading rows={4} />}
          {users.isError && <Notice tone="bad">{errorMessage(users.error)}</Notice>}
          {users.data && (
            <div className="tablewrap">
              <table>
                <caption className="sr-only">รายชื่อผู้ใช้</caption>
                <thead>
                  <tr>
                    <th>อีเมล</th>
                    <th>ชื่อ</th>
                    <th>บทบาท</th>
                    <th>ห้องพัก</th>
                    <th>สถานะ</th>
                    <th>
                      <span className="sr-only">จัดการ</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="num">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={6} className="muted">
                        ไม่พบผู้ใช้ที่ตรงกับคำค้น
                      </td>
                    </tr>
                  )}
                  {rows.map((u) => {
                    const self = u.id === me?.id;
                    return (
                      <tr key={u.id}>
                        <td>{u.email}</td>
                        <td>{u.full_name ?? <span className="muted">-</span>}</td>
                        <td>
                          <select
                            className="select"
                            aria-label={`บทบาทของ ${u.email}`}
                            value={u.role}
                            disabled={self || update.isPending}
                            onChange={(e) => changeRole(u, e.target.value as Role)}
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>
                                {roleLabel(r)}
                              </option>
                            ))}
                          </select>
                          {self && <span className="sub">บัญชีของคุณ</span>}
                        </td>
                        <td>
                          {livesInRoom(u.role) ? (
                            <RoomSelect
                              user={u}
                              rooms={rooms.data ?? []}
                              buildings={buildings.data ?? []}
                              occupants={occupants}
                              disabled={update.isPending}
                              onChange={(id) => changeRoom(u, id)}
                            />
                          ) : (
                            <span className="muted">ไม่มี</span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${u.is_active ? 's-closed' : 's-muted'}`}>
                            {u.is_active ? 'ใช้งาน' : 'ระงับ'}
                          </span>
                        </td>
                        <td>
                          {!self && (
                            <Button
                              small
                              variant={u.is_active ? 'danger' : 'default'}
                              disabled={update.isPending}
                              onClick={() => toggleActive(u)}
                            >
                              <span aria-hidden="true">{u.is_active ? 'ระงับ' : 'เปิดใช้'}</span>
                              <span className="sr-only">
                                {u.is_active ? 'ระงับ' : 'เปิดใช้'} {u.email}
                              </span>
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DeskPage>
  );
}

// ห้องจัดกลุ่มตามอาคาร พร้อมจำนวนคน/ความจุ · ห้องเต็มเลือกไม่ได้ (API ตอบ ROOM_FULL อยู่ดีถ้ามีคนเข้าพร้อมกัน)
function RoomSelect({
  user,
  rooms,
  buildings,
  occupants,
  disabled,
  onChange,
}: {
  user: User;
  rooms: Room[];
  buildings: { id: string; name: string }[];
  occupants: Map<string, number>;
  disabled: boolean;
  onChange: (roomId: string) => void;
}) {
  return (
    <select
      className="select"
      aria-label={`ห้องพักของ ${user.email}`}
      value={user.room_id ?? ''}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">ยังไม่ผูกห้อง</option>
      {buildings.map((b) => (
        <optgroup key={b.id} label={b.name}>
          {rooms
            .filter((r) => r.building_id === b.id)
            .map((r) => {
              const n = occupants.get(r.id) ?? 0;
              const full = n >= r.capacity && r.id !== user.room_id;
              return (
                <option key={r.id} value={r.id} disabled={full}>
                  {r.room_no} ({n}/{r.capacity}
                  {full ? ' เต็ม' : ''})
                </option>
              );
            })}
        </optgroup>
      ))}
    </select>
  );
}

// เพิ่มบัญชีล่วงหน้า (ช่าง / Staff ที่ยังไม่เคย login) — นักศึกษาไม่ต้องเพิ่ม login ครั้งแรกแล้วได้บัญชีเอง
function AddUser({ onAdded }: { onAdded: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<Role>('technician');
  const [err, setErr] = useState<{ email?: string; form?: string }>({});

  const create = useMutation({
    mutationFn: () => createUser({ email: email.trim(), role, full_name: name.trim() || null }),
    onSuccess: (u) => {
      toast(`เพิ่มบัญชี ${u.email} แล้ว`);
      setEmail('');
      setName('');
      setErr({});
      onAdded();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'UNIQUE_VIOLATION') return setErr({ email: EMAIL_TAKEN });
      const fields = e instanceof ApiError ? e.fieldErrors() : {};
      setErr(fields.email ? { email: fields.email } : { form: errorMessage(e) });
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setErr({ email: 'กรอกอีเมล' });
    create.mutate();
  };

  return (
    <form className="card" style={{ border: '1px solid var(--line)' }} onSubmit={submit} noValidate>
      <h2 style={{ fontSize: 16, margin: 0 }}>เพิ่มบัญชี</h2>
      <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field id="new-email" label="อีเมล @kmitl.ac.th" error={err.email} style={{ flex: '2 1 220px' }}>
          <input
            id="new-email"
            className={`input${err.email ? ' err' : ''}`}
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            {...invalidProps('new-email', err.email)}
          />
        </Field>
        <Field id="new-name" label="ชื่อ (ไม่บังคับ)" style={{ flex: '2 1 180px' }}>
          <input id="new-name" className="input" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field id="new-role" label="บทบาท" style={{ flex: '1 1 120px' }}>
          <select id="new-role" className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" variant="primary" busy={create.isPending}>
          เพิ่มบัญชี
        </Button>
      </div>
      {err.form && <Notice tone="bad">{err.form}</Notice>}
    </form>
  );
}
