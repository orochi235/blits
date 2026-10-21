import type { Kit, WaveShape } from '@msb235/blits';
import type { PatchSource } from '@pg/blits/composition';
import { withKey } from '@pg/blits/keyed';
import { type Mixed, SWINGS, type SwingName } from '@pg/blits/kit';
import { type ControlRenderer, f } from '@weasel-js/labkit';
import { PropertyControl, PropertyRow } from '@weasel-js/ui';
import { docOf } from './docs';
import m from './PatchLive.module.css';

type Wave = Extract<PatchSource, { kind: 'wave' }>;

const SHAPES: readonly WaveShape[] = ['sine', 'triangle', 'saw', 'square'];

/** A depth a channel starts at when ticked: a visible swing on its own scale. */
const START: Record<SwingName, number> = { turn: 15, scale: 0.25, opacity: 0.5, glow: 1 };

const doc = (key: string) => docOf(`WaveOptions.${key}`) ?? '';

/** A wave patch's rows, under `wave` in the patch panel's schema; each swing channel's row is drawn by `depthRenderers`. */
export function waveNodes() {
  return f
    .group({
      shape: f.enum<WaveShape>('sine', SHAPES).label('shape').describe(doc('shape')),
      cycles: f.number(1).label('cycles').describe(doc('cycles')).range(0, 1000).input().step(1),
      phase: f.number(0).label('phase').describe(doc('phase')).step(0.05),
      depth: f
        .group(Object.fromEntries(SWINGS.map((ch) => [ch, f.custom<null>('depth', null)])))
        .label("depth, either side of each channel's rest")
        .describe(doc('depth')),
    })
    .as('fragment');
}

/** The rows' values for `p`. */
export const waveConfig = (p: Wave) => ({ shape: p.shape, cycles: p.cycles, phase: p.phase });

/** One edited row, at its path under `wave`, written back into `p`. */
export function writtenWave(p: Wave, path: string, value: unknown): Wave {
  const n = Number.isFinite(value) ? (value as number) : undefined;
  if (path === 'shape') return { ...p, shape: value as WaveShape };
  if (path === 'cycles') return n === undefined || n < 0 ? p : { ...p, cycles: n };
  if (path === 'phase') return n === undefined ? p : { ...p, phase: n };
  return p;
}

/** Each swing channel's row: whether it swings, and how far either side of the kit's rest. */
export function depthRenderers(
  p: Wave,
  kit: Kit<Mixed>,
  onChange: (p: Wave) => void,
): Record<string, ControlRenderer> {
  const setDepth = (ch: SwingName, d: number | undefined) =>
    onChange({ ...p, depth: withKey(p.depth, ch, d) });
  return Object.fromEntries(
    SWINGS.map((ch) => {
      const d = p.depth[ch];
      const row: ControlRenderer = () => (
        <PropertyRow group label={`${ch} · rest ${String(kit[ch].rest ?? 0)}`}>
          <div className={m.values}>
            <PropertyControl
              kind="boolean"
              name={`${ch} swings`}
              value={d !== undefined}
              onChange={(on) => setDepth(ch, on ? START[ch] : undefined)}
            />
            <PropertyControl
              kind="number"
              name={`${ch} depth`}
              disabled={d === undefined}
              value={d ?? START[ch]}
              onChange={(n) => {
                if (Number.isFinite(n)) setDepth(ch, n);
              }}
            />
          </div>
        </PropertyRow>
      );
      return [`wave.depth.${ch}`, row];
    }),
  );
}
