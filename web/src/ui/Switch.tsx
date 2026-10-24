export function Switch({
  checked,
  onChange,
  title,
  sub,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: string;
  sub?: string;
}) {
  return (
    <button className="switch" type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span className="grow" style={{ flex: 1 }}>
        <span style={{ display: 'block', fontWeight: 600 }}>{title}</span>
        {sub && <span className="small muted">{sub}</span>}
      </span>
      <span className="knob" />
    </button>
  );
}
