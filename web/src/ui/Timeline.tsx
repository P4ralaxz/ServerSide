import type { TimelineItem } from './status';

export function Timeline({ items }: { items: TimelineItem[] }) {
  return (
    <ol className="tl">
      {items.map((e) => (
        <li key={e.key}>
          <span className={`dot ${e.dot}`} />
          <span className="what">
            <b>{e.label}</b>
            {e.detail ? ` · ${e.detail}` : ''}
            <span className="when num">{e.at}</span>
          </span>
          <span className={`dur num${e.skip ? ' skip' : ''}`} title={e.skip ? 'ไม่นับเข้าเวลาซ่อม' : undefined}>
            {e.duration ?? ''}
          </span>
        </li>
      ))}
    </ol>
  );
}
