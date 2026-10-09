import type { Kit, WaveShape } from '@msb235/blits';
import type { PatchSource } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { type Mixed, SWINGS, type SwingName } from '@pg/blits/kit';
import s from './App.module.css';

type Wave = Extract<PatchSource, { kind: 'wave' }>;

const SHAPES: readonly WaveShape[] = ['sine', 'triangle', 'saw', 'square'];

/** A depth a channel starts at when ticked: a visible swing on its own scale. */
const START: Record<SwingName, number> = { turn: 15, scale: 0.25, opacity: 0.5, glow: 1 };

function NumberField(p: {
  label: string;
  value: number;
  step: number;
  min?: number;
  onChange(n: number): void;
}) {
  return (
    <label className={s.row}>
      {p.label}
      <input
        type="number"
        step={p.step}
        min={p.min}
        value={p.value}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          if (Number.isFinite(n) && (p.min === undefined || n >= p.min)) p.onChange(n);
        }}
      />
    </label>
  );
}

export function WaveFields({
  patch: p,
  kit,
  onChange,
}: {
  patch: Wave;
  kit: Kit<Mixed>;
  onChange(p: Wave): void;
}) {
  const setDepth = (ch: SwingName, d: number | undefined) => {
    onChange({ ...p, depth: withKey(p.depth, ch, d) });
  };
  return (
    <>
      <div className={s.row}>
        <label className={s.row}>
          shape
          <select
            value={p.shape}
            onChange={(e) => onChange({ ...p, shape: e.target.value as WaveShape })}
          >
            {SHAPES.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </label>
        <NumberField
          label="cycles"
          value={p.cycles}
          step={0.5}
          min={0}
          onChange={(cycles) => onChange({ ...p, cycles })}
        />
        <NumberField
          label="phase"
          value={p.phase}
          step={0.05}
          onChange={(phase) => onChange({ ...p, phase })}
        />
      </div>
      <fieldset className={s.row}>
        <legend>depth, either side of each channel's rest</legend>
        {SWINGS.map((ch) => {
          const d = p.depth[ch];
          return (
            <span key={ch} className={s.row}>
              <label className={s.row}>
                <input
                  type="checkbox"
                  checked={d !== undefined}
                  onChange={(e) => setDepth(ch, e.target.checked ? START[ch] : undefined)}
                />
                {ch} (rest {String(kit[ch].rest ?? 0)})
              </label>
              {d !== undefined && (
                <input
                  type="number"
                  step="any"
                  aria-label={`${ch} depth`}
                  value={d}
                  onChange={(e) => {
                    if (Number.isFinite(e.target.valueAsNumber))
                      setDepth(ch, e.target.valueAsNumber);
                  }}
                />
              )}
            </span>
          );
        })}
      </fieldset>
    </>
  );
}
