import type { ReactNode } from 'react';
import type { Frame } from './scene';

export function Ledger<I, O>({
  frame,
  channels,
  focus,
  format,
  toggles,
}: {
  frame: Frame<I, O>;
  channels: readonly string[];
  focus: number;
  format?: Partial<Record<string, (v: unknown) => ReactNode>>;
  toggles?: readonly Switch[];
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
        {rows(frame, toggles).map(({ i, name, color, toggle }) => {
          const v = i < 0 ? undefined : frame.voices[i];
          const h = i < 0 ? undefined : frame.handles[i];
          const alone = (i < 0 ? {} : (frame.alone[i] ?? {})) as Record<string, unknown>;
          const off = toggle !== undefined && !toggle.on;
          return (
            <tr key={name} className={off || h?.state === 'done' ? 'gone' : undefined}>
              <th scope="row">
                {toggle ? (
                  <label className="ledger-toggle">
                    <input
                      type="checkbox"
                      checked={toggle.on}
                      onChange={(e) => toggle.set(e.target.checked)}
                    />
                    <span className="swatch" data-color={color} />
                    {name}
                  </label>
                ) : (
                  <>
                    <span className="swatch" data-color={color} />
                    {name}
                  </>
                )}
              </th>
              <td className="num">{h ? fmt(h.weightOf(frame.subjects[focus] as I)) : ''}</td>
              {channels.map((c) => (
                <td key={c} className="num">
                  {v ? show(c, alone[c]) : ''}
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

type Switch = { name: string; color: string; on: boolean; set(on: boolean): void };

/** Each switchable voice in its own order, playing or not, then every other voice playing. */
function rows<I, O>(frame: Frame<I, O>, toggles: readonly Switch[] | undefined) {
  const at = (name: string) => frame.voices.findIndex((v) => v.name === name);
  const switched = (toggles ?? []).map((t) => ({
    i: t.on ? at(t.name) : -1,
    name: t.name,
    color: t.color,
    toggle: t,
  }));
  const named = new Set(switched.map((r) => r.name));
  const rest = frame.voices.flatMap((v, i) =>
    named.has(v.name)
      ? []
      : [{ i, name: v.name, color: v.color, toggle: undefined as Switch | undefined }],
  );
  return [...switched, ...rest];
}

export function fmt(v: unknown): string {
  if (typeof v === 'number') return v.toFixed(3);
  if (Array.isArray(v)) return v.map((x) => fmt(x)).join(', ');
  if (v === undefined) return '—';
  return String(v);
}
