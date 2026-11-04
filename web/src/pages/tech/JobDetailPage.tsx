import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, isNotFound } from '../../api/client';
import { errorMessage, NOT_FOUND_TICKET } from '../../api/errors';
import { changeStatus, getHistory, getTicket, scheduleTicket } from '../../api/tickets';
import type { Ticket } from '../../api/types';
import { useMe } from '../../auth/RequireAuth';
import { AppHeader } from '../../ui/AppHeader';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Card, Eyebrow, KeyValues } from '../../ui/Card';
import { Empty, Loading } from '../../ui/Empty';
import { Field, invalidProps } from '../../ui/Field';
import { formatWhen, isoToThaiLocal, isPast, thaiLocalToIso } from '../../ui/format';
import { Notice } from '../../ui/Notice';
import { Pill } from '../../ui/Pill';
import { Priority } from '../../ui/Priority';
import { Shell } from '../../ui/Shell';
import { awaitsConfirmation, buildTimeline, can, isReturned, TECH_AUDITS } from '../../ui/status';
import { Timeline } from '../../ui/Timeline';
import { CommentsCard } from '../CommentsCard';
import { useToast } from '../../ui/Toast';
import { placeOf } from '../student/student';
import { JOBS_KEY } from './JobsPage';
import { Avatar } from './tech';

type Sheet = 'resolve' | 'parts' | 'schedule' | null;
type Act =
  | { kind: 'start' }
  | { kind: 'resume' }
  | { kind: 'resolve'; note: string }
  | { kind: 'parts'; note: string }
  | { kind: 'schedule'; at: string };

const NEED_PARTS = 'บอกชื่ออะไหล่ที่รอ Staff จะได้ช่วยตาม';
const NEED_FUTURE = 'เลือกวันและเวลาในอนาคต';

// รายละเอียดงานของช่าง (UI-PLAN 5) — ปุ่มทุกปุ่มมาจาก ticket.actions · ช่างไปได้สูงสุดแค่ซ่อมเสร็จ (กฎข้อ 2)
export function JobDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [note, setNote] = useState('');
  const [parts, setParts] = useState('');
  const [when, setWhen] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id) });
  const history = useQuery({ queryKey: ['history', id], queryFn: () => getHistory(id), enabled: ticket.isSuccess });

  const act = useMutation({
    mutationFn: async (a: Act): Promise<{ a: Act; t: Ticket }> => {
      switch (a.kind) {
        case 'start':
        case 'resume':
          return { a, t: await changeStatus(id, 'in_progress') };
        case 'resolve':
          return { a, t: await changeStatus(id, 'resolved', a.note || undefined) };
        case 'parts':
          return { a, t: await changeStatus(id, 'pending_parts', a.note) };
        case 'schedule':
          return { a, t: await scheduleTicket(id, a.at) };
      }
    },
    onSuccess: ({ a, t }) => {
      close();
      // ข้อความตามต้นแบบ — คำเดียวกับปุ่มที่กด (UI-PLAN 2 ข้อ 6)
      if (a.kind === 'start') toast('เริ่มงานแล้ว');
      if (a.kind === 'resume') toast('กลับมาซ่อมต่อแล้ว');
      if (a.kind === 'resolve') toast(`ส่งให้${t.room ? 'ผู้พัก' : 'Staff'}ยืนยันแล้ว`);
      if (a.kind === 'parts') toast('บันทึกว่ารออะไหล่แล้ว');
      if (a.kind === 'schedule') toast(`บันทึกนัด ${formatWhen(t.scheduled_at!)} แล้ว`);
    },
    onError: (e) => {
      // 400 จาก API ของช่องในแผ่น → แสดงใต้ช่องนั้น ไม่ปิดแผ่น
      if (e instanceof ApiError && (e.code === 'NOTE_REQUIRED' || e.fieldErrors().note))
        return setFieldError(NEED_PARTS);
      if (e instanceof ApiError && (e.code === 'SCHEDULE_IN_PAST' || e.fieldErrors().scheduled_at)) {
        return setFieldError(NEED_FUTURE);
      }
      close();
      toast(errorMessage(e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ticket', id] });
      void qc.invalidateQueries({ queryKey: ['history', id] });
      void qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });

  function close() {
    setSheet(null);
    setFieldError(null);
  }
  const open = (s: Exclude<Sheet, null>, t: Ticket) => {
    setFieldError(null);
    if (s === 'schedule') setWhen(t.scheduled_at && !isPast(t.scheduled_at) ? isoToThaiLocal(t.scheduled_at) : '');
    setSheet(s);
  };

  const header = <AppHeader title="รายละเอียดงาน" back="/jobs" right={<Avatar />} />;
  if (ticket.isPending) {
    return (
      <Shell header={header}>
        <Loading rows={3} />
      </Shell>
    );
  }
  if (ticket.isError) {
    return (
      <Shell header={header}>
        <Empty action={<Button to="/jobs">กลับไปงานของฉัน</Button>}>
          {isNotFound(ticket.error) ? NOT_FOUND_TICKET : errorMessage(ticket.error)}
        </Empty>
      </Shell>
    );
  }

  const t = ticket.data;
  const busy = act.isPending;
  const rows: [string, ReactNode][] = [['อาการ', t.description ?? '-']];
  if (t.scheduled_at) rows.push(['นัด', formatWhen(t.scheduled_at)]);
  if (t.room) rows.push(['เข้าห้อง', t.permission_to_enter ? 'เข้าได้ตอนไม่มีคนอยู่' : 'ต้องนัดผู้พักก่อน']);
  if (t.waiting_for_parts) rows.push(['อะไหล่ที่รอ', t.waiting_for_parts]);
  rows.push(['คนที่เจอปัญหานี้', <span className="num">{t.report_count} คน</span>]);

  const sendParts = () => {
    if (!parts.trim()) {
      setFieldError(NEED_PARTS);
      document.getElementById('parts-note')?.focus();
      return;
    }
    act.mutate({ kind: 'parts', note: parts.trim() });
  };
  const sendSchedule = () => {
    if (!when || isPast(thaiLocalToIso(when))) {
      setFieldError(NEED_FUTURE);
      document.getElementById('sched-at')?.focus();
      return;
    }
    act.mutate({ kind: 'schedule', at: thaiLocalToIso(when) });
  };

  return (
    <Shell header={header}>
      <Card label="งาน">
        <div className="spread">
          <Pill status={t.status} />
          <Priority priority={t.priority} />
        </div>
        <p className="title-lg">{t.asset.name}</p>
        <p className="muted">
          {placeOf(t)} · <span className="num">{t.ticket_no}</span>
        </p>
        {isReturned(t) && (
          <Notice tone="bad" icon="undo">
            <b>ถูกส่งกลับครั้งที่ {t.reopen_count}</b>
            {t.last_reopen_note && (
              <>
                <br />"{t.last_reopen_note}"
              </>
            )}
          </Notice>
        )}
        {/* ห้องพักที่ผู้พักไม่ได้อนุญาต: API ไม่ส่งปุ่มเริ่มงานจนกว่าจะมีนัด (DESIGN 6.7) — บอกเหตุผลที่ปุ่มไม่มา */}
        {t.room && !t.permission_to_enter && !t.scheduled_at && can(t, 'schedule') && (
          <Notice tone="warn">ผู้พักไม่ได้อนุญาตให้เข้าห้องตอนไม่อยู่ นัดเวลาก่อนเริ่มงาน</Notice>
        )}
        {can(t, 'start') && (
          <Button variant="primary" onClick={() => act.mutate({ kind: 'start' })} busy={busy}>
            เริ่มงาน
          </Button>
        )}
        {can(t, 'resolve') && (
          <Button variant="primary" onClick={() => open('resolve', t)}>
            ซ่อมเสร็จ
          </Button>
        )}
        {can(t, 'pending_parts') && <Button onClick={() => open('parts', t)}>รออะไหล่</Button>}
        {can(t, 'resume') && (
          <Button variant="primary" onClick={() => act.mutate({ kind: 'resume' })} busy={busy}>
            อะไหล่มาแล้ว ซ่อมต่อ
          </Button>
        )}
        {awaitsConfirmation(t) && (
          <Notice tone="info">ส่งให้{t.room ? 'ผู้พัก' : 'Staff'}ยืนยันแล้ว คุณปิดใบเองไม่ได้</Notice>
        )}
        {can(t, 'schedule') && (
          <Button variant="quiet" onClick={() => open('schedule', t)}>
            {t.scheduled_at ? 'เลื่อนนัด' : 'นัดเวลาเข้าซ่อม'}
          </Button>
        )}
      </Card>

      <Card label="ข้อมูลงาน">
        <KeyValues rows={rows} />
      </Card>

      <Card label="ประวัติ">
        <Eyebrow>ประวัติ</Eyebrow>
        {history.isPending ? (
          <Loading rows={1} />
        ) : history.isError ? (
          <p className="small muted">{errorMessage(history.error)}</p>
        ) : (
          <Timeline items={buildTimeline(history.data, t, me?.id, TECH_AUDITS)} />
        )}
      </Card>

      <CommentsCard ticket={t} />

      {sheet === 'resolve' && (
        <BottomSheet label="แจ้งว่าซ่อมเสร็จ" onClose={close}>
          <h3>แจ้งว่าซ่อมเสร็จ</h3>
          <Field id="fix-note" label="ทำอะไรไปบ้าง (ไม่บังคับ)">
            <textarea
              className="input"
              id="fix-note"
              placeholder="เช่น เปลี่ยนซีลยางและวาล์ว ทดสอบแล้วไม่รั่ว"
              value={note}
              maxLength={2000}
              onChange={(e) => setNote(e.target.value)}
            />
          </Field>
          <Notice tone="info" icon="info">
            {t.room
              ? `ระบบจะส่งอีเมลให้ผู้พักห้อง ${t.room.room_no} ตรวจผล ผู้พักเป็นคนปิดใบ`
              : 'ระบบจะส่งอีเมลให้ Staff ตรวจผล Staff เป็นคนปิดใบ'}
          </Notice>
          <Button variant="primary" onClick={() => act.mutate({ kind: 'resolve', note: note.trim() })} busy={busy}>
            ยืนยันซ่อมเสร็จ
          </Button>
          <Button onClick={close}>ยังไม่เสร็จ</Button>
        </BottomSheet>
      )}
      {sheet === 'parts' && (
        <BottomSheet label="รออะไหล่" onClose={close}>
          <h3>รออะไหล่</h3>
          <Field id="parts-note" label="รออะไหล่อะไร" error={fieldError}>
            <input
              className={`input${fieldError ? ' err' : ''}`}
              id="parts-note"
              placeholder="เช่น วาล์วก๊อก ขนาด 1/2 นิ้ว"
              value={parts}
              maxLength={500}
              onChange={(e) => {
                setParts(e.target.value);
                setFieldError(null);
              }}
              {...invalidProps('parts-note', fieldError)}
            />
          </Field>
          <p className="small muted">ช่วงรออะไหล่ไม่นับเข้าเวลาซ่อม</p>
          <Button variant="primary" onClick={sendParts} busy={busy}>
            บันทึก
          </Button>
        </BottomSheet>
      )}
      {sheet === 'schedule' && (
        <BottomSheet label="นัดเวลา" onClose={close}>
          <h3>{t.scheduled_at ? 'เลื่อนนัด' : 'นัดเวลาเข้าซ่อม'}</h3>
          <Field id="sched-at" label="วันและเวลา" error={fieldError}>
            <input
              className={`input${fieldError ? ' err' : ''}`}
              id="sched-at"
              type="datetime-local"
              value={when}
              min={isoToThaiLocal(new Date().toISOString())}
              onChange={(e) => {
                setWhen(e.target.value);
                setFieldError(null);
              }}
              {...invalidProps('sched-at', fieldError)}
            />
          </Field>
          <p className="small muted">เลือกเวลาในอนาคตเท่านั้น (เวลาไทย)</p>
          <Button variant="primary" onClick={sendSchedule} busy={busy}>
            บันทึกนัด
          </Button>
        </BottomSheet>
      )}
    </Shell>
  );
}
