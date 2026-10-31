import { ink, input, kit, mix, oklab, patch, spring, sum } from '@msb235/blits';
import { type Rng, rng } from '@stress/rng';
import type { Finding, Make, MakeOptions, Scenario } from '@stress/scenario';

interface Pose {
  value: number;
  heat: number[];
}
interface Cell {
  i: number;
}

const CELL = kit<Pose>({ value: sum(), heat: ink() });
const FRAME_MS = 1000 / 60;
const PER_SIZE = 1000;
const HEAT = 5;
const QUIET_FRAMES = 180;
const SETTLE = 1e-3;
const BANDS = [oklab(0x3a7bd5), oklab(0xf2c14e), oklab(0xe0303a)];
const KEEP_SNAPS = 64;

/** One instance of the workload; `Scenario` and the lanes twin both run on it. */
function engine({ seed, size, lanes }: MakeOptions) {
  const n = Math.max(1, Math.round(size * PER_SIZE));
  const rand: Rng = rng(seed);
  const cells: Cell[] = Array.from({ length: n }, (_, i) => ({ i }));
  const target = new Float64Array(n);
  const heat = new Float64Array(n);
  const m = mix<Cell, Pose>(CELL, { name: 'heatmap', lanes });
  m.sync(0);
  const move = spring<Cell, Pose>('value', { from: 0, to: (c) => target[c.i] as number });
  m.cue({ patch: move, subjects: cells });
  const weights = BANDS.map((color, b) => {
    const weight = input<Cell>((c) => Math.max(0, 1 - Math.abs(2 * (heat[c.i] as number) - b)));
    const hold = patch<Cell, Pose>(0, () => ({ heat: color }), { writes: ['heat'] });
    m.cue({ patch: hold, subjects: cells, weight });
    return weight;
  });
  const value = new Float64Array(n);
  const hue = new Float64Array(n * HEAT);
  let retargets = 0;

  function advance(f: number, ticking: boolean): void {
    if (ticking) {
      const hz = 40 + 20 * Math.sin((2 * Math.PI * f * FRAME_MS) / 10_000);
      const ticks = Math.round((n * hz * FRAME_MS) / 1000);
      for (let t = 0; t < ticks; t++) {
        const i = rand.int(n);
        const step = (rand.next() - 0.5) * 10;
        target[i] = (target[i] as number) + step;
        heat[i] = Math.min(1, (heat[i] as number) + Math.abs(step) / 5);
        move.to(cells[i] as Cell, target[i] as number);
      }
      retargets += ticks;
    }
    for (let i = 0; i < n; i++) heat[i] = (heat[i] as number) * 0.97;
    for (const w of weights) w.touch();
    m.sync(f * FRAME_MS);
  }
  function read(out: Float64Array): void {
    m.pull(cells, { value, heat: hue });
    out.set(value, 0);
    out.set(hue, n);
  }
  return {
    n,
    target,
    advance,
    read,
    voices: () => m.voices().length,
    retargets: () => retargets,
    close: () => m.close(),
  };
}

export const heatmap: Make = (opts) => {
  const live = engine(opts);
  const { n } = live;
  const snaps = new Map<number, Float64Array>();
  let stride = 30;
  let frame = -1;

  const snap = (f: number, out: Float64Array) => {
    if (f % stride !== 0) return;
    snaps.set(f, Float64Array.from(out));
    if (snaps.size <= KEEP_SNAPS) return;
    stride *= 2;
    for (const k of [...snaps.keys()]) if (k % stride !== 0) snaps.delete(k);
  };

  function settled(out: Float64Array): Finding[] {
    const found: Finding[] = [];
    for (let i = 0; i < n && found.length < 5; i++) {
      const gap = Math.abs((out[i] as number) - (live.target[i] as number));
      if (!(gap <= SETTLE)) {
        found.push({
          kind: 'fail',
          at: frame + QUIET_FRAMES,
          what: `cell ${i} read ${out[i]} ${QUIET_FRAMES} frames after its last tick; its target is ${live.target[i]}`,
        });
      }
    }
    return found;
  }

  function twinFindings(final: Float64Array): Finding[] {
    const twin = engine({ ...opts, lanes: opts.lanes === false });
    const buf = new Float64Array(n * (1 + HEAT));
    const last = frame + QUIET_FRAMES;
    const diff = (f: number, want: Float64Array): Finding | undefined => {
      for (let k = 0; k < buf.length; k++) {
        if (Object.is(buf[k], want[k])) continue;
        const cell = k < n ? k : Math.floor((k - n) / HEAT);
        const what = k < n ? 'value' : `heat[${(k - n) % HEAT}]`;
        return {
          kind: 'fail',
          at: f,
          what: `lanes ${opts.lanes === false ? 'off' : 'on'} and ${opts.lanes === false ? 'on' : 'off'} differ at cell ${cell} ${what}: ${want[k]} vs ${buf[k]}`,
        };
      }
      return undefined;
    };
    try {
      for (let f = 0; f <= last; f++) {
        twin.advance(f, f <= frame);
        twin.read(buf);
        const want = f === last ? final : snaps.get(f);
        const bad = want && diff(f, want);
        if (bad) return [bad];
      }
      return [];
    } finally {
      twin.close();
    }
  }

  const scenario: Scenario = {
    name: 'heatmap',
    frameMs: FRAME_MS,
    width: n * (1 + HEAT),
    step: (f) => {
      frame = f;
      live.advance(f, true);
    },
    read: (out) => {
      live.read(out);
      snap(frame, out);
    },
    stats: () => ({ voices: live.voices(), retargets: live.retargets() }),
    check: () => {
      const out = new Float64Array(n * (1 + HEAT));
      for (let f = frame + 1; f <= frame + QUIET_FRAMES; f++) live.advance(f, false);
      live.read(out);
      return [...settled(out), ...twinFindings(out)];
    },
    close: () => live.close(),
  };
  return scenario;
};
