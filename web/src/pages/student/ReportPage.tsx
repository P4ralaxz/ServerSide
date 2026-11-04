import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { getAsset, getRoom, listAssets } from '../../api/assets';
import { ApiError } from '../../api/client';
import { errorMessage } from '../../api/errors';
import { createTickets, sameIssue } from '../../api/tickets';
import type { AssetItem, CreateTicketsResponse, SkippedItem } from '../../api/types';
import { LogoutButton } from '../../auth/LogoutButton';
import { useMe } from '../../auth/RequireAuth';
import { AppHeader } from '../../ui/AppHeader';
import { Button } from '../../ui/Button';
import { categoryIcon, categoryLabel } from '../../ui/category';
import { Empty, Loading } from '../../ui/Empty';
import { Field, invalidProps } from '../../ui/Field';
import { Icon } from '../../ui/icons';
import { List, ListRow } from '../../ui/ListRow';
import { Notice } from '../../ui/Notice';
import { Pill } from '../../ui/Pill';
import { Shell } from '../../ui/Shell';
import { statusLabel } from '../../ui/status';
import { Switch } from '../../ui/Switch';
import { useToast } from '../../ui/Toast';
import { MY_TICKETS_KEY, StudentTabs } from './student';

const NEED_SYMPTOM = 'บอกอาการสั้น ๆ ให้ช่างเตรียมของได้ถูก';

// ห้อง / ส่วนกลางของอาคาร ที่หน้านี้แสดงรายการ — มาจากครุภัณฑ์ที่สแกนมา หรือห้องของตัวเอง
type Place = { kind: 'room'; roomId: string } | { kind: 'common'; buildingId: string };

function usePlace(assetId: string | null) {
  const me = useMe();
  const asset = useQuery({ queryKey: ['asset', assetId], queryFn: () => getAsset(assetId!), enabled: !!assetId });
  if (assetId) {
    if (!asset.data) return { place: null, loading: asset.isPending, error: asset.error };
    const a = asset.data;
    const place: Place = a.room_id
      ? { kind: 'room', roomId: a.room_id }
      : { kind: 'common', buildingId: a.building_id };
    return { place, loading: false, error: null };
  }
  return { place: me?.room_id ? ({ kind: 'room', roomId: me.room_id } as Place) : null, loading: false, error: null };
}

// หน้าแจ้งซ่อม (UI-PLAN 5) — ชิ้นที่มี open_ticket เลือกไม่ได้ กดแล้วไปดูใบนั้นแทน
export function ReportPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const preselect = params.get('asset');
  const fromAsset = preselect ?? params.get('near');
  const { place, loading, error } = usePlace(fromAsset);

  const assets = useQuery({
    queryKey: ['assets', place],
    queryFn: () =>
      place!.kind === 'room'
        ? listAssets({ room_id: place!.roomId })
        : listAssets({ building_id: place!.buildingId, common_area: true }),
    enabled: !!place,
  });
  const room = useQuery({
    queryKey: ['room', place?.kind === 'room' ? place.roomId : null],
    queryFn: () => getRoom((place as { roomId: string }).roomId),
    enabled: place?.kind === 'room',
  });

  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [desc, setDesc] = useState<Record<string, string>>({});
  const [err, setErr] = useState<Record<string, string>>({});
  const [perm, setPerm] = useState(true);
  const [result, setResult] = useState<CreateTicketsResponse | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  // มาจาก "แจ้งซ่อมชิ้นนี้" ของหน้าสแกน → เลือกชิ้นนั้นไว้ให้ (ถ้ายังเลือกได้)
  useEffect(() => {
    const a = assets.data?.find((x) => x.id === preselect);
    if (a && !a.open_ticket) setSel((s) => (Object.keys(s).length ? s : { [a.id]: true }));
  }, [assets.data, preselect]);

  const chosen = useMemo(() => (assets.data ?? []).filter((a) => sel[a.id] && !a.open_ticket), [assets.data, sel]);

  const submit = useMutation({
    mutationFn: () =>
      createTickets(
        chosen.map((a) => ({
          asset_id: a.id,
          // หน้าจอมีช่อง "อาการ" ช่องเดียว — ชื่อครุภัณฑ์เป็น title และอาการเป็น description (DESIGN 7.7)
          title: a.name,
          description: (desc[a.id] ?? '').trim(),
          ...(place?.kind === 'room' ? { permission_to_enter: perm } : {}),
        })),
      ),
    onSuccess: (res) => setResult(res),
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'DUPLICATE_OPEN_TICKET') {
        // ทุกชิ้นมีคนแจ้งตัดหน้า — ไม่ใช่ error ทั้งหน้า แสดงเป็นกลุ่ม "ข้าม" (UI-PLAN 6)
        const skipped = (e.details as { skipped?: SkippedItem[] } | undefined)?.skipped ?? [];
        setResult({ batch_id: '', created: [], skipped });
        return;
      }
      // 400 ของ API ที่ช่องอาการ → แสดงใต้ช่องนั้น (items.<ลำดับ>.description)
      const fields = e instanceof ApiError ? e.fieldErrors() : {};
      const byAsset: Record<string, string> = {};
      chosen.forEach((a, i) => {
        if (fields[`items.${i}.description`]) byAsset[a.id] = NEED_SYMPTOM;
      });
      if (Object.keys(byAsset).length) setErr(byAsset);
      else setFormError(errorMessage(e));
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: MY_TICKETS_KEY });
      void qc.invalidateQueries({ queryKey: ['assets'] });
      void qc.invalidateQueries({ queryKey: ['scan'] });
    },
  });

  const send = () => {
    setFormError(null);
    // ฟอร์มบล็อกก่อนให้เห็นทันทีว่าช่องไหนขาด — แต่ API ยังเป็นด่านจริง (description บังคับที่ DTO)
    const missing: Record<string, string> = {};
    for (const a of chosen) if (!(desc[a.id] ?? '').trim()) missing[a.id] = NEED_SYMPTOM;
    setErr(missing);
    const first = Object.keys(missing)[0];
    if (first) {
      document.getElementById(`d-${first}`)?.focus();
      return;
    }
    submit.mutate();
  };

  const reset = () => {
    setResult(null);
    setSel({});
    setDesc({});
    setErr({});
    navigate('/report', { replace: true });
  };

  const title =
    place?.kind === 'common' ? 'แจ้งซ่อม ส่วนกลาง' : room.data ? `แจ้งซ่อม ห้อง ${room.data.room_no}` : 'แจ้งซ่อม';
  // ปุ่มออกจากระบบอยู่เฉพาะหน้าแรกของแท็บ — หน้าที่มีปุ่มย้อนกลับคือขั้นย่อย ไม่ใช่ที่ที่คนมองหาปุ่มนี้
  const sub = fromAsset && !result;
  const header = (
    <AppHeader
      title={result ? 'แจ้งซ่อม' : title}
      back={sub ? '/report' : undefined}
      right={sub ? undefined : <LogoutButton />}
    />
  );
  const footer = <StudentTabs active="report" />;

  if (result) {
    return (
      <Shell header={header} footer={footer}>
        <ResultView result={result} assets={assets.data ?? []} onHome={reset} />
      </Shell>
    );
  }

  let body;
  if (loading || (place && assets.isPending)) body = <Loading rows={3} />;
  else if (error || assets.isError) {
    const e = error ?? assets.error;
    body = (
      <Empty action={<Button to="/tickets">ดูรายการที่ส่งซ่อมแล้ว</Button>}>
        {e instanceof ApiError && e.code === 'FORBIDDEN'
          ? 'แจ้งซ่อมได้เฉพาะของในห้องที่คุณพัก และของส่วนกลาง'
          : errorMessage(e)}
      </Empty>
    );
  } else if (!place) {
    body = (
      <Empty>
        บัญชีของคุณยังไม่ได้ผูกกับห้องพัก ของในห้องแจ้งได้หลังจาก Staff ผูกห้องให้ ส่วนของส่วนกลางให้สแกน QR
        ที่ติดอยู่บนชิ้นนั้น
      </Empty>
    );
  } else if (!assets.data?.length) {
    body = <Empty>ยังไม่มีรายการครุภัณฑ์ที่นี่ ติดต่อ Staff ของหอพัก</Empty>;
  } else {
    const n = chosen.length;
    body = (
      <>
        <p className="muted">เลือกชิ้นที่มีปัญหา เลือกได้หลายชิ้น</p>
        <List label="ครุภัณฑ์">
          {assets.data.map((a) => (
            <AssetChoice
              key={a.id}
              asset={a}
              selected={!!sel[a.id]}
              desc={desc[a.id] ?? ''}
              error={err[a.id]}
              onToggle={() => {
                setSel((s) => ({ ...s, [a.id]: !s[a.id] }));
                setErr((e) => {
                  const rest = { ...e };
                  delete rest[a.id];
                  return rest;
                });
              }}
              onDesc={(v) => setDesc((d) => ({ ...d, [a.id]: v }))}
            />
          ))}
        </List>
        {place.kind === 'room' && (
          <Switch
            checked={perm}
            onChange={setPerm}
            title="ช่างเข้าห้องได้ตอนไม่มีคนอยู่"
            sub="ถ้าปิดไว้ ช่างจะนัดเวลาก่อนเข้า"
          />
        )}
        {formError && <Notice tone="bad">{formError}</Notice>}
        <Button variant="primary" onClick={send} disabled={n === 0} busy={submit.isPending}>
          {n ? `ส่งแจ้งซ่อม ${n} รายการ` : 'เลือกอย่างน้อย 1 ชิ้น'}
        </Button>
      </>
    );
  }

  return (
    <Shell header={header} footer={footer}>
      {body}
    </Shell>
  );
}

function AssetChoice({
  asset,
  selected,
  desc,
  error,
  onToggle,
  onDesc,
}: {
  asset: AssetItem;
  selected: boolean;
  desc: string;
  error?: string;
  onToggle: () => void;
  onDesc: (v: string) => void;
}) {
  if (asset.open_ticket) {
    return (
      <ListRow
        dim
        to={`/tickets/${asset.open_ticket.id}`}
        icon={categoryIcon(asset.category)}
        title={asset.name}
        sub={`แจ้งไว้แล้ว · ${statusLabel(asset.open_ticket.status)}`}
        chevron
      />
    );
  }
  const id = `d-${asset.id}`;
  return (
    <div>
      <ListRow checked={selected} onClick={onToggle} title={asset.name} sub={`หมวด${categoryLabel(asset.category)}`} />
      {selected && (
        <Field id={id} label="อาการ" error={error} style={{ padding: '0 14px 14px' }}>
          <textarea
            className={`input${error ? ' err' : ''}`}
            id={id}
            placeholder="เช่น เปิดแล้วกะพริบ บางครั้งไม่ติด"
            value={desc}
            maxLength={2000}
            onChange={(e) => onDesc(e.target.value)}
            {...invalidProps(id, error)}
          />
        </Field>
      )}
    </div>
  );
}

function ResultView({
  result,
  assets,
  onHome,
}: {
  result: CreateTicketsResponse;
  assets: AssetItem[];
  onHome: () => void;
}) {
  const nameOf = (id: string) => assets.find((a) => a.id === id)?.name ?? 'ครุภัณฑ์';
  const iconOf = (id: string) => categoryIcon(assets.find((a) => a.id === id)?.category ?? '');
  const created = result.created;
  return (
    <>
      <div className="success">
        <span className="bubble">
          <Icon name={created.length ? 'check' : 'info'} size={30} />
        </span>
        <p className="title-lg">{created.length ? 'ส่งแจ้งซ่อมแล้ว' : 'ชิ้นที่เลือกมีคนแจ้งไว้แล้ว'}</p>
        <p className="muted">
          {created.length
            ? 'เราจะส่งอีเมลเมื่อช่างซ่อมเสร็จ ให้คุณมายืนยันผล'
            : 'ระหว่างที่คุณกรอก มีคนแจ้งไปก่อน กดเจอปัญหาเดียวกันเพื่อให้ใบเดิมได้รับความสำคัญขึ้น'}
        </p>
      </div>
      {created.length > 0 && (
        <List label="ใบที่สร้าง">
          {created.map((t) => (
            <ListRow
              key={t.id}
              to={`/tickets/${t.id}`}
              icon={categoryIcon(t.asset.category)}
              title={t.asset.name}
              sub={<span className="num">{t.ticket_no}</span>}
              trailing={<Pill status={t.status} />}
            />
          ))}
        </List>
      )}
      {result.skipped.length > 0 && (
        <div className="stack">
          <p className="sectionh">
            <span>มีคนแจ้งไว้ก่อนแล้ว</span>
            <span className="num">{result.skipped.length}</span>
          </p>
          <List label="รายการที่ข้าม">
            {result.skipped.map((s) => (
              <SkippedRow key={s.ticket_id} item={s} name={nameOf(s.asset_id)} icon={iconOf(s.asset_id)} />
            ))}
          </List>
        </div>
      )}
      <Button variant="primary" to="/tickets">
        ดูรายการที่ส่งซ่อมแล้ว
      </Button>
      <Button onClick={onHome}>กลับหน้าแรก</Button>
    </>
  );
}

function SkippedRow({ item, name, icon }: { item: SkippedItem; name: string; icon: ReturnType<typeof categoryIcon> }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const same = useMutation({
    mutationFn: () => sameIssue(item.ticket_id),
    onSuccess: (t) => {
      setDone(true);
      toast(`บันทึกแล้ว ตอนนี้มีคนเจอปัญหานี้ ${t.report_count} คน`);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'ALREADY_REPORTED') setDone(true);
      toast(errorMessage(e));
    },
  });
  return (
    <div className="li">
      <span className="thumb">
        <Icon name={icon} />
      </span>
      <span className="grow">
        <span className="t">{name}</span>
        <span className="s num">{item.ticket_no}</span>
      </span>
      {done ? (
        <span className="small muted">กดแล้ว</span>
      ) : (
        <Button small onClick={() => same.mutate()} busy={same.isPending}>
          เจอปัญหาเดียวกัน
        </Button>
      )}
    </div>
  );
}
