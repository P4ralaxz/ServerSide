import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { ApiError, isNotFound } from '../../api/client';
import { errorMessage, NOT_FOUND_TICKET } from '../../api/errors';
import {
  assignTicket,
  confirmTicket,
  getHistory,
  getTicket,
  rejectTicket,
  reopenTicket,
  setPriority,
} from '../../api/tickets';
import type { Ticket } from '../../api/types';
import { listTechnicians } from '../../api/users';
import { useMe } from '../../auth/RequireAuth';
import { Button } from '../../ui/Button';
import { Card, Eyebrow, KeyValues } from '../../ui/Card';
import { Loading } from '../../ui/Empty';
import { Field, invalidProps } from '../../ui/Field';
import { firstName, formatWhen } from '../../ui/format';
import { Notice } from '../../ui/Notice';
import { Pill } from '../../ui/Pill';
import { Priority } from '../../ui/Priority';
import {
  awaitsResident,
  buildTimeline,
  can,
  isDisputed,
  isOpenTicket,
  PRIORITIES,
  priorityLabel,
  STAFF_AUDITS,
  wasEscalated,
  type TicketPriority,
} from '../../ui/status';
import { Timeline } from '../../ui/Timeline';
import { useToast } from '../../ui/Toast';
import { MY_TICKETS_KEY, placeOf } from '../student/student';
import { COUNTS_KEY, QUEUE_KEY } from './keys';

type Act =
  | { kind: 'assign'; techId: string; techName: string; reassign: boolean }
  | { kind: 'reject'; note: string }
  | { kind: 'priority'; priority: TicketPriority }
  | { kind: 'confirm' }
  | { kind: 'reopen'; note: string };

// แผงรายละเอียดของใบที่เลือกในคิว (UI-PLAN 5) — การกระทำแบบ inline บนเดสก์ท็อป (UI-PLAN 2 ข้อ 6)
// ปุ่มทุกปุ่มมาจาก actions · notice บอกเหตุผลที่ไม่มีปุ่ม (เช่น ใบห้องพักที่ Staff ยืนยันแทนไม่ได้)
export function StaffPanel({ id }: { id: string }) {
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id) });
  const history = useQuery({ queryKey: ['history', id], queryFn: () => getHistory(id), enabled: ticket.isSuccess });
  const techs = useQuery({ queryKey: ['technicians'], queryFn: listTechnicians, enabled: can(ticket.data, 'assign') });

  const [pick, setPick] = useState('');
  const [open, setOpen] = useState<'reject' | 'reopen' | null>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  // เปลี่ยนใบที่เลือก → ล้างฟอร์มของใบก่อน
  useEffect(() => {
    setOpen(null);
    setNote('');
    setNoteError(null);
    setPick('');
  }, [id]);

  const act = useMutation({
    mutationFn: async (a: Act): Promise<{ a: Act; t: Ticket }> => {
      switch (a.kind) {
        case 'assign':
          return { a, t: await assignTicket(id, a.techId) };
        case 'reject':
          return { a, t: await rejectTicket(id, a.note) };
        case 'priority':
          return { a, t: await setPriority(id, a.priority) };
        case 'confirm':
          return { a, t: await confirmTicket(id) };
        case 'reopen':
          return { a, t: await reopenTicket(id, a.note) };
      }
    },
    onSuccess: ({ a, t }) => {
      setOpen(null);
      setNote('');
      if (a.kind === 'assign') toast(`${a.reassign ? 'เปลี่ยนเป็นช่าง' : 'มอบหมายให้ช่าง'}${a.techName}แล้ว`);
      if (a.kind === 'reject') toast('ไม่รับเรื่องแล้ว');
      if (a.kind === 'priority') toast(`เปลี่ยนความด่วนเป็น${priorityLabel(a.priority)}แล้ว`);
      if (a.kind === 'confirm') toast('ปิดใบแล้ว');
      if (a.kind === 'reopen') toast(`ส่งกลับให้ช่าง${firstName(t.assignee?.name)}แล้ว`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.fieldErrors().note) return setNoteError('ต้องบอกเหตุผล');
      toast(errorMessage(e));
    },
    // ตัวเลขบนชิปต้องเปลี่ยนตามทันที — มอบหมายแล้ว "รอมอบหมาย" ต้องลดลง (UI-PLAN 9)
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['ticket', id] });
      void qc.invalidateQueries({ queryKey: ['history', id] });
      void qc.invalidateQueries({ queryKey: QUEUE_KEY });
      void qc.invalidateQueries({ queryKey: COUNTS_KEY });
      void qc.invalidateQueries({ queryKey: MY_TICKETS_KEY });
    },
  });

  if (ticket.isPending) return <Loading rows={2} />;
  if (ticket.isError) {
    return <p className="muted">{isNotFound(ticket.error) ? NOT_FOUND_TICKET : errorMessage(ticket.error)}</p>;
  }

  const t = ticket.data;
  const busy = act.isPending;
  const choices = (techs.data ?? []).filter((u) => u.id !== t.assigned_to);
  const chosen = choices.find((u) => u.id === pick) ?? choices[0];

  const submitNote = (kind: 'reject' | 'reopen') => {
    if (!note.trim()) {
      setNoteError(kind === 'reject' ? 'บอกเหตุผลที่ไม่รับเรื่อง' : 'บอกเหตุผลที่ส่งกลับ ช่างจะได้รู้ว่าต้องแก้ตรงไหน');
      document.getElementById('staff-note')?.focus();
      return;
    }
    act.mutate({ kind, note: note.trim() });
  };
  const noteField = (label: string, placeholder: string, submit: ReactNode) => (
    <Field id="staff-note" label={label} error={noteError}>
      <textarea
        className={`input${noteError ? ' err' : ''}`}
        id="staff-note"
        placeholder={placeholder}
        value={note}
        maxLength={2000}
        onChange={(e) => {
          setNote(e.target.value);
          setNoteError(null);
        }}
        {...invalidProps('staff-note', noteError)}
      />
      {submit}
    </Field>
  );

  const rows: [string, ReactNode][] = [
    [
      'คนเจอปัญหา',
      <span className="num">
        {t.report_count} คน{wasEscalated(history.data) ? ' (ยกเป็นด่วนมากอัตโนมัติ)' : ''}
      </span>,
    ],
    ['ช่าง', t.assignee?.name ?? 'ยังไม่มอบหมาย'],
    ['อาการ', t.description ?? '-'],
  ];
  if (t.scheduled_at) rows.push(['นัด', formatWhen(t.scheduled_at)]);
  if (t.room) rows.push(['เข้าห้อง', t.permission_to_enter ? 'เข้าได้ตอนไม่มีคนอยู่' : 'ต้องนัดผู้พักก่อน']);
  if (t.waiting_for_parts) rows.push(['อะไหล่ที่รอ', t.waiting_for_parts]);

  return (
    <>
      <Card label="ใบที่เลือก">
        <div className="spread">
          <Pill status={t.status} />
          <Priority priority={t.priority} />
        </div>
        <p className="title-lg" style={{ fontSize: 19 }}>
          {t.asset.name}
        </p>
        <p className="muted small">
          {placeOf(t)} · <span className="num">{t.ticket_no}</span>
        </p>

        {t.reopen_count > 0 && isOpenTicket(t) && t.last_reopen_note && (
          <Notice tone="bad" icon="undo">
            <b>
              {t.room ? 'ผู้พัก' : 'Staff'}ส่งกลับ {t.reopen_count} ครั้ง
            </b>
            <br />"{t.last_reopen_note}"
          </Notice>
        )}
        {isDisputed(t) && (
          <Notice tone="bad">
            <b>มีคนแย้งว่ายังไม่หาย</b> หลังช่างกดซ่อมเสร็จ ระบบจะไม่ปิดใบนี้ให้อัตโนมัติ
          </Notice>
        )}
        {awaitsResident(t) && (
          <Notice tone="info" icon="info">
            รอผู้พักห้อง {t.room?.room_no} ยืนยัน Staff ยืนยันใบห้องพักแทนไม่ได้
          </Notice>
        )}

        <div className="actions">
          {can(t, 'assign') && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <select
                className="select"
                aria-label={t.assigned_to ? 'เปลี่ยนช่าง' : 'เลือกช่าง'}
                value={chosen?.id ?? ''}
                onChange={(e) => setPick(e.target.value)}
                disabled={!choices.length}
              >
                {choices.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name ?? u.email}
                  </option>
                ))}
              </select>
              <Button
                small
                variant={t.assigned_to ? 'default' : 'primary'}
                disabled={!chosen}
                busy={busy}
                onClick={() =>
                  chosen &&
                  act.mutate({
                    kind: 'assign',
                    techId: chosen.id,
                    techName: firstName(chosen.full_name),
                    reassign: t.assigned_to !== null,
                  })
                }
              >
                {t.assigned_to ? 'เปลี่ยนช่าง' : 'มอบหมาย'}
              </Button>
              {can(t, 'reject') && (
                <Button small onClick={() => setOpen(open === 'reject' ? null : 'reject')}>
                  ไม่รับเรื่อง
                </Button>
              )}
            </div>
          )}
          {!can(t, 'assign') && can(t, 'reject') && (
            <Button small onClick={() => setOpen(open === 'reject' ? null : 'reject')}>
              ไม่รับเรื่อง
            </Button>
          )}
          {open === 'reject' &&
            noteField(
              'เหตุผลที่ไม่รับเรื่อง',
              'เช่น ไม่ใช่ครุภัณฑ์ของหอ',
              <Button small variant="danger" busy={busy} onClick={() => submitNote('reject')}>
                ยืนยันไม่รับเรื่อง
              </Button>,
            )}

          {(can(t, 'confirm') || can(t, 'reopen')) && (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {can(t, 'confirm') && (
                <Button small variant="primary" busy={busy} onClick={() => act.mutate({ kind: 'confirm' })}>
                  ยืนยันว่าหายแล้ว
                </Button>
              )}
              {can(t, 'reopen') && (
                <Button small onClick={() => setOpen(open === 'reopen' ? null : 'reopen')}>
                  ส่งกลับให้ช่าง
                </Button>
              )}
            </div>
          )}
          {open === 'reopen' &&
            noteField(
              'เหตุผลที่ส่งกลับ',
              'เช่น ประตูลิฟต์ยังค้างที่ชั้น 3',
              <Button small variant="primary" busy={busy} onClick={() => submitNote('reopen')}>
                ส่งกลับให้ช่าง{firstName(t.assignee?.name)}
              </Button>,
            )}

          {can(t, 'priority') && (
            <div className="row">
              <label className="small muted" htmlFor="prio-sel">
                ความด่วน
              </label>
              <select
                className="select"
                id="prio-sel"
                value={t.priority}
                disabled={busy}
                onChange={(e) => act.mutate({ kind: 'priority', priority: e.target.value as TicketPriority })}
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {priorityLabel(p)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </Card>

      <Card label="ข้อมูลใบ">
        <KeyValues rows={rows} />
      </Card>

      <Card label="เวลาที่ค้างในแต่ละขั้น">
        <Eyebrow>เวลาที่ค้างในแต่ละขั้น</Eyebrow>
        {history.isPending ? (
          <Loading rows={1} />
        ) : history.isError ? (
          <p className="small muted">{errorMessage(history.error)}</p>
        ) : (
          <Timeline items={buildTimeline(history.data, t, me?.id, STAFF_AUDITS)} />
        )}
      </Card>
    </>
  );
}
