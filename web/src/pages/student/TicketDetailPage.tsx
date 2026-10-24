import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, isNotFound } from '../../api/client';
import { errorMessage, NOT_FOUND_TICKET } from '../../api/errors';
import { cancelTicket, confirmTicket, getHistory, getTicket, reopenTicket } from '../../api/tickets';
import type { Ticket } from '../../api/types';
import { useMe } from '../../auth/RequireAuth';
import { AppHeader } from '../../ui/AppHeader';
import { BottomSheet } from '../../ui/BottomSheet';
import { Button } from '../../ui/Button';
import { Card, Eyebrow, KeyValues } from '../../ui/Card';
import { Empty, Loading } from '../../ui/Empty';
import { Field, invalidProps } from '../../ui/Field';
import { firstName, formatRemaining, formatWhen, isPast } from '../../ui/format';
import { Notice } from '../../ui/Notice';
import { Pill } from '../../ui/Pill';
import { Shell } from '../../ui/Shell';
import { can, pendingParts, studentSummary, studentTimeline } from '../../ui/status';
import { Timeline } from '../../ui/Timeline';
import { useToast } from '../../ui/Toast';
import { MY_TICKETS_KEY, StudentTabs, whereOf } from './student';

type Sheet = 'confirm' | 'reopen' | 'cancel' | null;

// รายละเอียดใบของนักศึกษา (UI-PLAN 5) — ปุ่มทุกปุ่มมาจาก ticket.actions เท่านั้น (UI-PLAN 2 ข้อ 1)
export function TicketDetailPage() {
  const { id = '' } = useParams();
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);

  const ticket = useQuery({ queryKey: ['ticket', id], queryFn: () => getTicket(id) });
  const history = useQuery({ queryKey: ['history', id], queryFn: () => getHistory(id), enabled: ticket.isSuccess });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['ticket', id] });
    void qc.invalidateQueries({ queryKey: ['history', id] });
    void qc.invalidateQueries({ queryKey: MY_TICKETS_KEY });
    void qc.invalidateQueries({ queryKey: ['scan'] });
    void qc.invalidateQueries({ queryKey: ['assets'] });
  };

  // ข้อความ toast ตามต้นแบบ — คำเดียวกับปุ่มที่กด (UI-PLAN 2 ข้อ 6)
  const act = useMutation({
    mutationFn: async (kind: Exclude<Sheet, null>): Promise<{ kind: string; t: Ticket }> => {
      if (kind === 'confirm') return { kind, t: await confirmTicket(id) };
      if (kind === 'reopen') return { kind, t: await reopenTicket(id, note.trim()) };
      return { kind, t: await cancelTicket(id) };
    },
    onSuccess: ({ kind, t }) => {
      setSheet(null);
      setNote('');
      if (kind === 'confirm') toast('ปิดใบแล้ว ขอบคุณที่ยืนยัน');
      if (kind === 'reopen') toast(`ส่งกลับให้ช่าง${firstName(t.assignee?.name)}แล้ว`);
      if (kind === 'cancel') toast('ยกเลิกการแจ้งแล้ว');
    },
    onError: (e) => {
      // API ตอบ 400 ที่ช่อง note → แสดงใต้ช่องนั้น ไม่ปิดแผ่น
      if (e instanceof ApiError && e.fieldErrors().note) {
        setNoteError('บอกอาการก่อนส่งกลับ ช่างจะได้รู้ว่าต้องแก้ตรงไหน');
        return;
      }
      setSheet(null);
      // INVALID_TRANSITION: ใบเปลี่ยนไปแล้วระหว่างที่เปิดดู → บอกแล้วโหลดใบใหม่ (UI-PLAN 6)
      toast(errorMessage(e));
    },
    onSettled: refresh,
  });

  const header = (title: string) => <AppHeader title={title} back="/tickets" />;
  const footer = <StudentTabs active="tickets" />;

  if (ticket.isPending) {
    return (
      <Shell header={header('ใบแจ้งซ่อม')} footer={footer}>
        <Loading rows={3} />
      </Shell>
    );
  }
  if (ticket.isError) {
    // ไม่มีใบ กับ ไม่มีสิทธิ์ดู ต้องเป็นข้อความเดียวกัน — ไม่งั้นไล่เดา id แล้วรู้ว่าใบไหนมีอยู่จริง (UI-PLAN 6)
    return (
      <Shell header={header('ใบแจ้งซ่อม')} footer={footer}>
        <Empty action={<Button to="/tickets">ดูรายการที่ส่งซ่อมแล้ว</Button>}>
          {isNotFound(ticket.error) ? NOT_FOUND_TICKET : errorMessage(ticket.error)}
        </Empty>
      </Shell>
    );
  }

  const t = ticket.data;
  const tech = firstName(t.assignee?.name);
  const sendReopen = () => {
    if (!note.trim()) {
      setNoteError('บอกอาการก่อนส่งกลับ ช่างจะได้รู้ว่าต้องแก้ตรงไหน');
      document.getElementById('reopen-note')?.focus();
      return;
    }
    act.mutate('reopen');
  };
  const close = () => {
    setSheet(null);
    setNoteError(null);
  };

  const rows: [string, ReactNode][] = [
    ['อาการที่แจ้ง', t.description ?? '-'],
    ['ช่าง', t.assignee ? (t.assignee.name ?? 'ช่าง') : 'ยังไม่มอบหมาย'],
  ];
  if (t.scheduled_at) rows.push(['นัด', formatWhen(t.scheduled_at)]);
  if (t.room) rows.push(['เข้าห้อง', t.permission_to_enter ? 'เข้าได้ตอนไม่มีคนอยู่' : 'ต้องนัดก่อน']);
  rows.push(['คนที่เจอปัญหานี้', <span className="num">{t.report_count} คน</span>]);

  return (
    <Shell header={header(t.ticket_no)} footer={footer}>
      <Card label="สถานะ">
        <div className="spread">
          <Pill status={t.status} />
          <span className="small muted num">{t.ticket_no}</span>
        </div>
        <p className="title-lg">{t.asset.name}</p>
        <p className="muted">
          {whereOf(t)} · {studentSummary(t, pendingParts(history.data))}
        </p>
        {can(t, 'confirm') && t.auto_close_at && (
          <Notice tone="info">
            {isPast(t.auto_close_at) ? (
              // job ปิดอัตโนมัติรันทุก 15 นาที — เลยกำหนดแล้วแต่ยังไม่ถึงรอบ ยังยืนยันเองได้
              'เลยกำหนดยืนยันแล้ว ระบบจะปิดใบให้ในไม่ช้า'
            ) : (
              <>
                ถ้าไม่ยืนยันภายใน <b className="num">{formatRemaining(t.auto_close_at)}</b> ระบบจะปิดใบให้
              </>
            )}
          </Notice>
        )}
        {can(t, 'confirm') && (
          <Button variant="primary" onClick={() => setSheet('confirm')}>
            หายแล้ว ปิดใบ
          </Button>
        )}
        {can(t, 'reopen') && <Button onClick={() => setSheet('reopen')}>ยังไม่หาย</Button>}
        {can(t, 'cancel') && (
          <Button variant="danger" onClick={() => setSheet('cancel')}>
            ยกเลิกการแจ้ง
          </Button>
        )}
      </Card>

      <Card label="ข้อมูลใบ">
        <KeyValues rows={rows} />
      </Card>

      <Card label="ประวัติ">
        <Eyebrow>ประวัติ</Eyebrow>
        {history.isPending ? (
          <Loading rows={1} />
        ) : history.isError ? (
          <p className="small muted">{errorMessage(history.error)}</p>
        ) : (
          <Timeline items={studentTimeline(history.data, t, me?.id)} />
        )}
      </Card>

      {sheet === 'confirm' && (
        <BottomSheet label="ยืนยันว่าหายแล้ว" onClose={close}>
          <h3>ยืนยันว่าซ่อมหายแล้ว?</h3>
          <p className="muted">ใบนี้จะถูกปิด และบันทึกว่าคุณเป็นผู้ยืนยัน</p>
          <Button variant="primary" onClick={() => act.mutate('confirm')} busy={act.isPending}>
            ยืนยัน ปิดใบ
          </Button>
          <Button onClick={close}>ยังก่อน</Button>
        </BottomSheet>
      )}
      {sheet === 'reopen' && (
        <BottomSheet label="ยังไม่หาย" onClose={close}>
          <h3>ยังไม่หาย</h3>
          <Field id="reopen-note" label="เล่าอาการที่ยังเป็นอยู่" error={noteError}>
            <textarea
              className={`input${noteError ? ' err' : ''}`}
              id="reopen-note"
              placeholder="เช่น ยังมีเสียงดังตอนเปิดเบอร์ 3"
              value={note}
              maxLength={2000}
              onChange={(e) => {
                setNote(e.target.value);
                setNoteError(null);
              }}
              {...invalidProps('reopen-note', noteError)}
            />
          </Field>
          <p className="small muted">ใบจะกลับไปหาช่าง{tech}คนเดิม และแจ้ง Staff ด้วย</p>
          <Button variant="primary" onClick={sendReopen} busy={act.isPending}>
            ส่งกลับให้ช่าง
          </Button>
        </BottomSheet>
      )}
      {sheet === 'cancel' && (
        <BottomSheet label="ยกเลิกการแจ้ง" onClose={close}>
          <h3>ยกเลิกการแจ้งซ่อม?</h3>
          <p className="muted">ใช้ได้เฉพาะตอนที่ยังไม่มีช่างรับงาน ถ้าของยังเสียอยู่ ต้องแจ้งใหม่</p>
          <Button variant="danger" onClick={() => act.mutate('cancel')} busy={act.isPending}>
            ยกเลิกการแจ้ง
          </Button>
          <Button onClick={close}>ไม่ยกเลิก</Button>
        </BottomSheet>
      )}
    </Shell>
  );
}
