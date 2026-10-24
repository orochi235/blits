import type { ReactNode } from 'react';
import type { Frame } from './scene';

export function Ledger<I, O>({
  frame,
  channels,
  focus,
  format,
}: {
  frame: Frame<I, O>;
  channels: readonly string[];
  focus: number;
  format?: Partial<Record<string, (v: unknown) => ReactNode>>;
}) {
  const show = (key: string, v: unknown): ReactNode => {
    const f = format?.[key];
    if (f) return f(v);
    return fmt(v);
  };
  const pose = (frame.poses[focus] ?? {}) as Record<string, unknown>;
  return (
    <table className="ledger">
      <thead>
        <tr>
          <th scope="col">Voice</th>
          <th scope="col" className="num">
            Weight
          </th>
          {channels.map((c) => (
            <th key={c} scope="col" className="num">
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {frame.voices.map((v, i) => {
          const h = frame.handles[i];
          const alone = (frame.alone[i] ?? {}) as Record<string, unknown>;
          return (
            <tr key={v.name} className={h?.state === 'done' ? 'gone' : undefined}>
              <th scope="row">
                <span className="swatch" data-color={v.color} />
                {v.name}
              </th>
              <td className="num">{h ? fmt(h.weightOf(frame.subjects[focus] as I)) : ''}</td>
              {channels.map((c) => (
                <td key={c} className="num">
                  {show(c, alone[c])}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Folded</th>
          <td className="num" />
          {channels.map((c) => (
            <td key={c} className="num">
              {show(c, pose[c])}
            </td>
          ))}
        </tr>
      </tfoot>
    </table>
  );
}

export function fmt(v: unknown): string {
  if (typeof v === 'number') return v.toFixed(3);
  if (Array.isArray(v)) return v.map((x) => fmt(x)).join(', ');
  if (v === undefined) return '—';
  return String(v);
}
