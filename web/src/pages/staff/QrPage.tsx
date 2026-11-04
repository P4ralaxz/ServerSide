import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { listAssets, listBuildings, listRooms, qrImage } from '../../api/assets';
import { errorMessage } from '../../api/errors';
import type { AssetItem } from '../../api/types';
import { Button } from '../../ui/Button';
import { Empty, Loading } from '../../ui/Empty';
import { Field } from '../../ui/Field';
import { Notice } from '../../ui/Notice';
import { DeskBar, DeskPage } from './desk';

// พิมพ์สติกเกอร์ QR ทีละห้อง (หรือส่วนกลางของอาคาร) ในแผ่นเดียว — ตัดแปะครุภัณฑ์ทีละชิ้น
// QR ยังเป็นของครุภัณฑ์ทีละชิ้นตามกฎข้อ 1 ไม่มี QR ระดับห้อง (DESIGN 6.8) · ใช้ API เดิมทั้งหมด ไม่มี endpoint ใหม่
// ที่เลือกไว้อยู่ใน URL (?place=room:<id> | common:<building_id>) เปิดซ้ำหรือส่งลิงก์ให้คนอื่นพิมพ์ต่อได้

type Place = { kind: 'room'; id: string } | { kind: 'common'; id: string };

const parsePlace = (raw: string | null): Place | null => {
  const [kind, id] = (raw ?? '').split(':');
  return (kind === 'room' || kind === 'common') && id ? { kind, id } : null;
};

export function QrPage() {
  const [params, setParams] = useSearchParams();
  const place = parsePlace(params.get('place'));
  const rooms = useQuery({ queryKey: ['rooms'], queryFn: listRooms });
  const buildings = useQuery({ queryKey: ['buildings'], queryFn: listBuildings });

  const assets = useQuery({
    queryKey: ['assets', 'qr', place],
    queryFn: () =>
      place!.kind === 'room'
        ? listAssets({ room_id: place!.id })
        : listAssets({ building_id: place!.id, common_area: true }),
    enabled: place !== null,
  });

  // ชื่อสถานที่บนสติกเกอร์ ("D1 ห้อง 304" / "D1 ส่วนกลาง") — คนติดจะได้ไม่สลับแผ่นระหว่างห้อง
  const label = useMemo(() => {
    if (!place) return '';
    const room = place.kind === 'room' ? rooms.data?.find((r) => r.id === place.id) : undefined;
    const buildingId = room?.building_id ?? (place.kind === 'common' ? place.id : undefined);
    const code = buildings.data?.find((b) => b.id === buildingId)?.code ?? '';
    return room ? `${code} ห้อง ${room.room_no}` : `${code} ส่วนกลาง`;
  }, [place, rooms.data, buildings.data]);

  const choose = (v: string) => setParams(v ? { place: v } : {}, { replace: true });

  return (
    <>
      <DeskBar active="qr" />
      <DeskPage>
        <div className="noprint spread" style={{ flexWrap: 'wrap', gap: 12, alignItems: 'flex-end' }}>
          <div>
            <h1>พิมพ์ QR ครุภัณฑ์</h1>
            <p className="small muted">เลือกห้องหรือส่วนกลาง แล้วพิมพ์ทั้งแผ่น ตัดแปะครุภัณฑ์ทีละชิ้น</p>
          </div>
          <Field id="qr-place" label="ห้อง / ส่วนกลาง" style={{ minWidth: 240 }}>
            <select
              id="qr-place"
              className="input"
              value={place ? `${place.kind}:${place.id}` : ''}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">เลือก…</option>
              {(buildings.data ?? []).map((b) => (
                <optgroup key={b.id} label={b.name}>
                  <option value={`common:${b.id}`}>{b.code} ส่วนกลาง</option>
                  {(rooms.data ?? [])
                    .filter((r) => r.building_id === b.id)
                    .map((r) => (
                      <option key={r.id} value={`room:${r.id}`}>
                        {b.code} ห้อง {r.room_no}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </Field>
          <Button variant="primary" onClick={() => window.print()} disabled={!assets.data?.length}>
            พิมพ์ {assets.data?.length ? `${assets.data.length} ชิ้น` : ''}
          </Button>
        </div>

        {(rooms.isError || buildings.isError) && (
          <Notice tone="bad">{errorMessage(rooms.error ?? buildings.error)}</Notice>
        )}
        {!place ? (
          <Empty>เลือกห้องหรือส่วนกลางก่อน</Empty>
        ) : assets.isPending ? (
          <Loading rows={2} />
        ) : assets.isError ? (
          <Notice tone="bad">{errorMessage(assets.error)}</Notice>
        ) : assets.data.length === 0 ? (
          <Empty>ที่นี่ยังไม่มีครุภัณฑ์</Empty>
        ) : (
          <ul className="stickers" aria-label={`QR ของ ${label}`}>
            {assets.data.map((a) => (
              <Sticker key={a.id} asset={a} place={label} />
            ))}
          </ul>
        )}
      </DeskPage>
    </>
  );
}

function Sticker({ asset, place }: { asset: AssetItem; place: string }) {
  const src = useQrUrl(asset.id);
  return (
    <li className="sticker">
      {src === 'error' ? (
        <div className="qr-missing small muted">โหลด QR ไม่ได้</div>
      ) : src ? (
        <img src={src} alt={`QR ของ ${asset.name} (${asset.asset_code})`} width={150} height={150} />
      ) : (
        <div className="qr-missing" aria-hidden="true" />
      )}
      <b>{asset.name}</b>
      <span className="small">{place}</span>
      <span className="small muted num">{asset.asset_code}</span>
      <span className="small muted">สแกนเพื่อแจ้งซ่อม</span>
    </li>
  );
}

// รูปต้องโหลดพร้อม token แล้วแปลงเป็น object URL — คืนหน่วยความจำเมื่อสติกเกอร์หายจากจอ
function useQrUrl(assetId: string): string | 'error' | null {
  const [url, setUrl] = useState<string | 'error' | null>(null);
  useEffect(() => {
    let alive = true;
    let made: string | null = null;
    qrImage(assetId)
      .then((blob) => {
        if (!alive) return;
        made = URL.createObjectURL(blob);
        setUrl(made);
      })
      .catch(() => alive && setUrl('error'));
    return () => {
      alive = false;
      if (made) URL.revokeObjectURL(made);
    };
  }, [assetId]);
  return url;
}
