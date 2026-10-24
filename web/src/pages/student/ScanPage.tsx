import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { isNotFound } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { scan } from '../../api/scan';
import { getTicket, sameIssue } from '../../api/tickets';
import { AppHeader } from '../../ui/AppHeader';
import { Button } from '../../ui/Button';
import { Card, Eyebrow } from '../../ui/Card';
import { categoryIcon, categoryLabel } from '../../ui/category';
import { Empty, Loading } from '../../ui/Empty';
import { Icon } from '../../ui/icons';
import { List, ListRow } from '../../ui/ListRow';
import { Notice } from '../../ui/Notice';
import { Pill } from '../../ui/Pill';
import { Shell } from '../../ui/Shell';
import { can, studentSummary } from '../../ui/status';
import { useToast } from '../../ui/Toast';
import { StudentTabs, whereOf } from './student';

// หน้าแรกหลังสแกน (UI-PLAN 5) — ปุ่มทุกปุ่มมาจาก open_ticket (+ actions) และ can_report ที่ API ส่งมาเท่านั้น
export function ScanPage() {
  const { qrToken = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ queryKey: ['scan', qrToken], queryFn: () => scan(qrToken) });
  const open = q.data?.open_ticket ?? null;
  // ประโยคสรุปต้องใช้ชื่อช่างและนัด ซึ่ง /scan ไม่ได้ส่งมา — open_ticket ผ่าน canSee แล้ว จึงเปิดใบนี้ได้เสมอ
  const ticket = useQuery({ queryKey: ['ticket', open?.id], queryFn: () => getTicket(open!.id), enabled: !!open });

  const same = useMutation({
    mutationFn: () => sameIssue(open!.id),
    onSuccess: (t) => toast(`บันทึกแล้ว ตอนนี้มีคนเจอปัญหานี้ ${t.report_count} คน`),
    onError: (e) => toast(errorMessage(e)),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['scan', qrToken] });
      void qc.invalidateQueries({ queryKey: ['ticket', open?.id] });
    },
  });

  const footer = <StudentTabs active="report" />;

  if (q.isPending) {
    return (
      <Shell header={<AppHeader title="กำลังโหลด" />} footer={footer}>
        <Loading rows={2} />
      </Shell>
    );
  }
  if (q.isError) {
    return (
      <Shell header={<AppHeader title="สแกน QR" />} footer={footer}>
        <Empty action={<Button to="/report">ไปหน้าแจ้งซ่อม</Button>}>
          {isNotFound(q.error)
            ? 'ไม่พบครุภัณฑ์จาก QR นี้ ลองสแกนใหม่ หรือแจ้ง Staff ว่าสติกเกอร์อาจชำรุด'
            : errorMessage(q.error)}
        </Empty>
      </Shell>
    );
  }

  const { asset, can_report } = q.data;
  return (
    <Shell header={<AppHeader title={asset.name} />} footer={footer}>
      <Card label="ครุภัณฑ์ที่สแกน">
        <div className="row">
          <span className="thumb">
            <Icon name={categoryIcon(asset.category)} size={22} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontWeight: 600 }}>{asset.name}</p>
            <p className="small muted">
              {whereOf(asset)} · หมวด{categoryLabel(asset.category)}
            </p>
          </div>
          <span className="small muted num">{asset.asset_code}</span>
        </div>
      </Card>

      {open ? (
        <Card label="สถานะล่าสุด">
          <Eyebrow>สถานะล่าสุด</Eyebrow>
          <div className="spread">
            <Pill status={open.status} />
            <span className="small muted num">{open.ticket_no}</span>
          </div>
          {ticket.data && <p>{studentSummary(ticket.data)}</p>}
          <Button variant="primary" to={`/tickets/${open.id}`}>
            {can(open, 'confirm') ? 'ดูและยืนยันผลซ่อม' : 'ดูสถานะ'}
          </Button>
          {open.reported_by_me ? (
            <p className="small muted" style={{ textAlign: 'center' }}>
              คุณกดว่าเจอปัญหาเดียวกันแล้ว
            </p>
          ) : (
            can(open, 'same_issue') && (
              <Button variant="quiet" onClick={() => same.mutate()} busy={same.isPending}>
                เจอปัญหาเดียวกัน
              </Button>
            )
          )}
        </Card>
      ) : can_report ? (
        <Card label="สถานะล่าสุด">
          <Eyebrow>สถานะล่าสุด</Eyebrow>
          <p>ชิ้นนี้ยังไม่มีการแจ้งซ่อมที่เปิดอยู่</p>
          <Button variant="primary" to={`/report?asset=${asset.id}`}>
            แจ้งซ่อมชิ้นนี้
          </Button>
        </Card>
      ) : (
        <Notice tone="warn">
          ชิ้นนี้แจ้งซ่อมได้เฉพาะผู้พักห้องนั้น ถ้าของในห้องคุณเสีย ให้สแกน QR ของชิ้นนั้น หรือเลือกจากหน้าแจ้งซ่อม
        </Notice>
      )}

      {(open || can_report) && (
        <List>
          <ListRow
            to={`/report?near=${asset.id}`}
            icon="wrench"
            title={asset.room ? 'แจ้งซ่อมชิ้นอื่นในห้องนี้' : 'แจ้งซ่อมชิ้นอื่นในส่วนกลางของอาคารนี้'}
            sub="เลือกได้หลายชิ้นในครั้งเดียว"
            chevron
          />
        </List>
      )}
    </Shell>
  );
}
