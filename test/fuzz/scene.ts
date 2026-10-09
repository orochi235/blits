import { kit, last, max, mul, sum, vec } from '../../src/channels.js';
import { color } from '../../src/color.js';
import { mix } from '../../src/mixer.js';
import { spring, tween } from '../../src/motion.js';
import { keys, patch } from '../../src/patch.js';
import { level, slew } from '../../src/signals.js';
import type {
  Channel,
  Columns,
  Easing,
  Handle,
  Keyframe,
  Mix,
  Patch,
  VoiceSpec,
} from '../../src/types.js';
import { wave } from '../../src/wave.js';

export interface Pose {
  gain: number;
  crawl: number;
  dark: number;
  position: number[];
  opacity: number;
  tint?: number[];
  pick: number;
  odd: number;
}
export interface Part {
  id: number;
}

// `odd` is a custom (non-stock) channel: never laned, so a voice writing it pins its others off lanes.
const odd: Channel<number> = {
  rest: 0,
  merge: (a, b) => a + b,
  scale: (v, w) => v * w,
  lerp: (a, b, u) => a + (b - a) * u,
};
const makeKit = () =>
  kit<Pose>({
    gain: mul(),
    crawl: sum(),
    dark: max({ bounds: [0, 2] }),
    position: vec(3, sum()),
    opacity: mul({ bounds: [0, 1] }),
    tint: color(),
    pick: last(),
    odd,
  });
const CHANNELS = ['gain', 'crawl', 'dark', 'position', 'opacity', 'tint', 'pick', 'odd'] as const;
type Ch = (typeof CHANNELS)[number];
const WAVED = ['gain', 'crawl', 'dark', 'opacity', 'odd'] as const;
type WavedCh = (typeof WAVED)[number];
const MOVED = ['crawl', 'gain', 'dark', 'opacity'] as const;
type MovedCh = (typeof MOVED)[number];
type Val = number | number[];

const EASES: readonly Easing[] = [
  'linear',
  'ease',
  'ease-in-out',
  { steps: 3 },
  { steps: 2, jump: 'start' },
  { bezier: [0.3, 0.1, 0.2, 1] },
];

/** What a scene exercises. Every flag defaults to the plain scene: levels, inert, and shared timestamps on; the rest off. */
export interface SceneOptions {
  /** Weight some voices by a `level` signal, some through `slew`, and set those levels. */
  levels?: boolean;
  /** Compare `inert` each frame. */
  inert?: boolean;
  /** Let a frame repeat the last frame's timestamp. */
  sameTime?: boolean;
  /** Put some voices under owners, and drive the owners. */
  owners?: boolean;
  /** Read every probed frame through `pull` as well. */
  pull?: boolean;
  /** Keep history, and compare `project(t - 150)` for every probe. */
  history?: boolean;
  /** 10 to 39 subjects instead of 2 to 6. */
  many?: boolean;
}
type Resolved = Required<SceneOptions>;
const resolve = (o: SceneOptions): Resolved => ({
  levels: o.levels ?? true,
  inert: o.inert ?? true,
  sameTime: o.sameTime ?? true,
  owners: o.owners ?? false,
  pull: o.pull ?? false,
  history: o.history ?? false,
  many: o.many ?? false,
});

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  const f = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  return {
    f,
    i: (n: number) => Math.floor(f() * n),
    pick: <T>(a: readonly T[]): T => a[Math.floor(f() * a.length)] as T,
    p: (x: number) => f() < x,
  };
}
type Rng = ReturnType<typeof rng>;

type PatchDesc =
  | { kind: 'fn'; dur: number; writes: Ch[]; k: number; vals: Val[] }
  | { kind: 'keys'; dur: number; stops: Keyframe<Pose>[]; ease?: Easing; delay: number }
  | {
      kind: 'wave';
      dur: number;
      shape: 'sine' | 'triangle' | 'saw' | 'square';
      cycles: number;
      depth: Partial<Record<WavedCh, number>>;
      useKit: boolean;
    }
  | { kind: 'tween'; ch: MovedCh; from: number; to: number; ms: number; ease: Easing }
  | { kind: 'spring'; ch: MovedCh; from: number; to: number };

type Act =
  | 'fade'
  | 'rise'
  | 'weight'
  | 'rate'
  | 'seek'
  | 'fadeSub'
  | 'level'
  | 'retarget'
  | 'drop'
  | 'fadeAt'
  | 'owner'
  | 'mute';
const ACTS: readonly Act[] = [
  'fade',
  'rise',
  'weight',
  'rate',
  'seek',
  'fadeSub',
  'level',
  'retarget',
  'drop',
  'fadeAt',
  'owner',
  'mute',
];

interface Cue {
  op: 'cue';
  voice: number;
  patch: PatchDesc;
  fade?: { in: number; out: number; ease?: Easing };
  weight?: number;
  /** Weighted by a level starting here; slewed when `slewed`. */
  level?: { initial: number; slewed: boolean };
  locus?: string;
  loop?: false | number;
  start?: number;
  freeze?: 'before' | 'after' | 'both';
  hold?: 'before' | 'after' | 'both';
  rate?: number;
  stagger: number;
  owner?: { rate: number; weight: number; fade?: { in: number; out: number }; start?: number };
  subjects?: number[];
  target?: number;
}
interface Do {
  op: Act;
  voice: number;
  x: number;
  part: number;
  over: number;
}
type Op = Cue | Do;
export interface Frame {
  t: number;
  ops: Op[];
  probe: number[];
}
export interface Scene {
  seed: number;
  options: Resolved;
  frames: Frame[];
}

const value = (ch: Ch, r: Rng): Val => {
  if (ch === 'position') return [r.f() * 4 - 2, r.f() * 4 - 2, r.f() * 4 - 2];
  if (ch === 'tint') return [r.f(), r.f() * 0.2 - 0.1, r.f() * 0.2 - 0.1, r.f()];
  if (ch === 'pick') return r.i(5);
  return Math.round(r.f() * 16) / 8;
};

function makePatch(r: Rng, allowOdd: boolean, allowLast: boolean): PatchDesc {
  const pool = CHANNELS.filter((c) => (allowOdd || c !== 'odd') && (allowLast || c !== 'pick'));
  const writes = [...new Set(Array.from({ length: 1 + r.i(3) }, () => r.pick(pool)))];
  const kind = r.pick(['fn', 'keys', 'keys', 'wave', 'tween', 'spring'] as const);
  const dur = r.pick([0, 100, 250, 400, 1000]);
  if (kind === 'fn') {
    const k = r.f() * 7;
    return { kind, dur, writes, k, vals: writes.map((w) => value(w, r)) };
  }
  if (kind === 'keys') {
    const ats = Array.from({ length: 1 + r.i(4) }, () =>
      r.pick([0, 0, 0.25, 0.5, 0.5, 1, 1, r.f()]),
    ).sort((a, b) => a - b);
    const stops = ats.map((at) => {
      const delta: Record<string, Val> = {};
      for (const w of writes) if (r.p(0.8)) delta[w] = value(w, r);
      const stop: Keyframe<Pose> = { at, delta: delta as Partial<Pose> };
      if (r.p(0.4)) stop.ease = r.pick(EASES);
      return stop;
    });
    const first = stops[0] as Keyframe<Pose>;
    const w0 = writes[0] as Ch;
    if (Object.keys(first.delta).length === 0)
      first.delta = { [w0]: value(w0, r) } as Partial<Pose>;
    const ease = r.p(0.5) ? r.pick(EASES) : undefined;
    const delay = r.p(0.3) ? r.pick([0, 50, 120]) : 0;
    return { kind, dur: dur || 300, stops, ease, delay };
  }
  if (kind === 'wave') {
    const nums = writes.filter((w): w is WavedCh => (WAVED as readonly Ch[]).includes(w));
    const depth: Partial<Record<WavedCh, number>> = {};
    for (const w of nums.length ? nums : (['crawl'] as const)) depth[w] = r.f();
    const shape = r.pick(['sine', 'triangle', 'saw', 'square'] as const);
    const cycles = r.pick([1, 2, 0.5]);
    return { kind, dur: dur || 500, shape, cycles, depth, useKit: r.p(0.5) };
  }
  const ch = r.pick(MOVED);
  const from = r.f() * 2;
  const to = r.f() * 2;
  const ms = r.pick([50, 100, 300]);
  const ease = r.pick(EASES);
  if (kind === 'tween') return { kind, ch, from, to, ms, ease };
  return { kind, ch, from, to };
}

interface Built {
  patch: Patch<Part, Pose, unknown>;
  retarget?: (part: Part, to: number) => void;
}
function build(d: PatchDesc): Built {
  switch (d.kind) {
    case 'fn': {
      const { writes, vals, k } = d;
      const at = (phase: number, part: Part): Partial<Pose> => {
        const o: Record<string, Val> = {};
        const s = Math.sin(phase * k + part.id);
        writes.forEach((w, i) => {
          const v = vals[i] as Val;
          o[w] = Array.isArray(v)
            ? v.map((x) => x * (1 + 0.3 * s))
            : w !== 'pick'
              ? v + 0.5 * s
              : v;
        });
        return o as Partial<Pose>;
      };
      return { patch: patch<Part, Pose>(d.dur, at, { writes }) };
    }
    case 'keys': {
      const delay = d.delay;
      return {
        patch: keys<Part, Pose>(d.dur, d.stops, {
          ease: d.ease,
          delayBy: delay ? () => delay : undefined,
        }),
      };
    }
    case 'wave':
      return {
        patch: wave<Part, Pose>(d.dur, {
          shape: d.shape,
          cycles: d.cycles,
          depth: d.depth,
          kit: d.useKit ? makeKit() : undefined,
        }),
      };
    case 'tween': {
      const from = d.from;
      const p = tween<Part, Pose>(d.ch, {
        from: (s) => from + s.id * 0.1,
        to: d.to,
        ms: d.ms,
        ease: d.ease,
      });
      return { patch: p, retarget: (s, v) => p.to(s, v) };
    }
    case 'spring': {
      const from = d.from;
      const p = spring<Part, Pose>(d.ch, { from: (s) => from + s.id * 0.1, to: d.to });
      return { patch: p, retarget: (s, v) => p.to(s, v) };
    }
  }
}

/** The scene `seed` makes under `options`: pure data, so it can be printed and shrunk. */
export function scene(seed: number, options: SceneOptions = {}): Scene {
  const o = resolve(options);
  const r = rng(seed);
  const parts = o.many ? 10 + r.i(30) : 2 + r.i(5);
  const frames: Frame[] = [];
  let t = r.pick([0, 0, 1000]);
  let voices = 0;
  const count = 6 + r.i(14);
  for (let f = 0; f < count; f++) {
    const ops: Op[] = [];
    const k = f === 0 ? 1 + r.i(4) : r.p(0.5) ? r.i(3) : 0;
    for (let j = 0; j < k; j++) {
      const what = f === 0 ? 'cue' : r.pick(['cue', 'cue', ...ACTS] as const);
      if (what === 'cue') {
        const cue: Cue = {
          op: 'cue',
          voice: -1,
          patch: makePatch(r, r.p(0.25), r.p(0.3)),
          stagger: 0,
        };
        if (r.p(0.4))
          cue.fade = {
            in: r.pick([0, 100, 200]),
            out: r.pick([0, 100, 300]),
            ease: r.p(0.3) ? r.pick(EASES) : undefined,
          };
        const wk = r.f();
        if (wk < 0.15) cue.weight = 0;
        else if (wk < 0.4) cue.weight = Math.round(r.f() * 8) / 8;
        else if (wk < 0.55 && o.levels) cue.level = { initial: 0, slewed: r.p(0.5) };
        if (r.p(0.25)) cue.locus = r.pick(['a', 'b']);
        if (r.p(0.3)) cue.loop = r.pick([false, 2] as const);
        if (r.p(0.2)) cue.start = t + r.pick([0, 50, 200, -100]);
        if (r.p(0.2)) cue.freeze = r.pick(['before', 'after', 'both'] as const);
        if (r.p(0.15)) cue.hold = r.pick(['before', 'after', 'both'] as const);
        if (r.p(0.2)) cue.rate = r.pick([0.5, 2, 0, -1]);
        cue.stagger = r.p(0.2) ? r.pick([30, 100]) : 0;
        if (o.owners && r.p(0.4))
          cue.owner = {
            rate: r.pick([1, 0.5, 2]),
            weight: r.pick([1, 0.5, 0.25]),
            fade: r.p(0.5) ? { in: 100, out: 100 } : undefined,
            start: r.p(0.3) ? t + 50 : undefined,
          };
        if (r.p(0.25)) cue.subjects = Array.from({ length: 1 + r.i(2) }, () => r.i(parts + 2));
        if (r.p(0.15)) cue.target = r.i(2);
        cue.voice = voices++;
        const initial = r.f();
        if (cue.level) cue.level.initial = initial;
        ops.push(cue);
      } else if (voices > 0) {
        const op: Do = {
          op: what,
          voice: r.i(voices),
          x: r.f(),
          part: r.i(parts),
          over: r.pick([0, 100, 250]),
        };
        // Known divergence #6: lanes ignore a level set within a frame already synced.
        const withinFrame = frames.at(-1)?.t === t;
        if (!(what === 'level' && withinFrame)) ops.push(op);
      }
    }
    const probe = Array.from({ length: parts + (f > 3 ? r.i(3) : 0) }, (_, i) => i).filter(() =>
      r.p(0.8),
    );
    frames.push({ t, ops, probe });
    const dt = r.pick([0, 16, 16, 33, 100, 250, 1, 400]);
    t += !o.sameTime && dt === 0 ? 7 : dt;
  }
  return { seed, options: o, frames };
}

interface Env {
  m: Mix<Part, Pose>;
  parts: Part[];
  handles: (Handle<Part> | undefined)[];
  retargets: ((part: Part, to: number) => void)[];
  levels: ReturnType<typeof level<Part>>[];
  owners: Handle<Part>[];
  errs: string[];
  /** `voice:part` for every subject faded out of a voice. */
  fadedOut: Set<string>;
  /** Parts a retarget met again after a voice faded them out: known divergence #15 in `project`. */
  remet: Set<number>;
  /** Whether a motion voice sat at weight 0 at the last frame: known divergence #16 in `inert`. */
  wasZero: boolean;
}
const partOf = (e: Env, i: number): Part => {
  let p = e.parts[i];
  if (!p) {
    p = { id: i };
    e.parts[i] = p;
  }
  return p;
};

function cue(e: Env, c: Cue): void {
  const built = build(c.patch);
  const s: VoiceSpec<Part, Pose> = { patch: built.patch };
  if (c.fade) s.fade = c.fade;
  if (c.weight !== undefined) s.weight = c.weight;
  if (c.locus !== undefined) s.locus = c.locus;
  if (c.loop !== undefined) s.loop = c.loop;
  if (c.start !== undefined) s.start = c.start;
  if (c.freeze) s.freeze = c.freeze;
  if (c.hold) s.hold = c.hold;
  if (c.rate !== undefined) s.rate = c.rate;
  const stagger = c.stagger;
  if (stagger) s.stagger = (p) => p.id * stagger;
  if (c.subjects) s.subjects = c.subjects.map((i) => partOf(e, i));
  const target = c.target;
  if (target !== undefined) s.target = (p) => p.id % 2 === target;
  if (c.owner) {
    try {
      const owner = e.m.owns(c.owner);
      s.owner = owner;
      e.owners.push(owner);
    } catch (err) {
      e.errs.push(`owns: ${String(err).slice(0, 80)}`);
    }
  }
  if (c.level) {
    const l = level<Part>(c.level.initial);
    e.levels.push(l);
    s.weight = c.level.slewed ? slew(l, { riseMs: 200, fallMs: 200 }) : l;
  }
  if (built.retarget) e.retargets[c.voice] = built.retarget;
  try {
    e.handles[c.voice] = e.m.cue(s);
  } catch (err) {
    e.handles[c.voice] = undefined;
    e.errs.push(`cue: ${String(err).slice(0, 80)}`);
  }
}

function act(e: Env, d: Do): void {
  const h = e.handles[d.voice];
  if (!h) return;
  const { x, over } = d;
  const part = partOf(e, d.part);
  try {
    switch (d.op) {
      case 'fade':
        h.fade(x < 0.7 ? { over } : { at: 'rest', deadline: 400 });
        break;
      case 'fadeAt':
        h.fade({ at: e.m.now + over - 50, over });
        break;
      case 'rise':
        h.rise({ over });
        break;
      case 'weight':
        h.weight = Math.round(x * 4) / 4;
        break;
      case 'rate':
        h.rate = [0, 0.5, 1, 3][Math.floor(x * 4)] as number;
        break;
      case 'seek':
        h.seek(x * 800);
        break;
      case 'fadeSub':
        h.fade({ subject: part, over });
        e.fadedOut.add(`${d.voice}:${d.part}`);
        break;
      case 'level':
        e.levels[Math.floor(x * e.levels.length)]?.set(Math.round(x * 4) / 4);
        break;
      case 'retarget':
        e.retargets[d.voice]?.(part, x * 3);
        if (e.fadedOut.has(`${d.voice}:${d.part}`)) e.remet.add(d.part);
        break;
      case 'owner': {
        const o = e.owners[Math.floor(x * e.owners.length)];
        if (!o) break;
        if (d.part % 3 === 0) o.fade({ over });
        else if (d.part % 3 === 1) o.rate = x * 2;
        else o.weight = x;
        break;
      }
      case 'mute':
        if (x < 0.3) e.m.mute({ over });
        break;
      case 'drop':
        e.m.drop(part);
        break;
    }
  } catch (err) {
    e.errs.push(`${d.op}: ${String(err).slice(0, 80)}`);
  }
}

const shown = (v: unknown): unknown =>
  Object.is(v, -0) ? '-0' : Number.isNaN(v) ? 'NaN' : v === undefined ? 'undef' : v;
function snap(p: Pose): string {
  const o: Record<string, unknown> = {};
  for (const c of CHANNELS) {
    const v: unknown = p[c];
    o[c] = Array.isArray(v) ? v.map(shown) : shown(v);
  }
  return JSON.stringify(o);
}

// Known divergence #16: lanes and the general path disagree on `inert` while a motion voice
// (one with a retarget) sits at weight 0, and for the first frame after it leaves 0.
const motionAtZero = (e: Env): boolean =>
  e.handles.some((h, v) => h && e.retargets[v] && h.state !== 'done' && h.weight === 0);

/** Item keys the shrinker drops: `f.j` for op j of frame f, `fpi` for the probe of part i in frame f. */
type Dropped = ReadonlySet<string>;

/** Plays `s` on one mix and lists everything a host can read from it, one line per reading. */
export function play(s: Scene, lanes: boolean, drop: Dropped = new Set()): string[] {
  const o = s.options;
  const e: Env = {
    m: mix<Part, Pose>(makeKit(), {
      lanes,
      ...(o.history ? { history: { ms: 3000, every: 100 } } : {}),
    }),
    parts: Array.from({ length: 10 }, (_, id) => ({ id })),
    handles: [],
    retargets: [],
    levels: [],
    owners: [],
    errs: [],
    fadedOut: new Set(),
    remet: new Set(),
    wasZero: false,
  };
  const out: string[] = [];
  const reuse = {} as Pose;
  try {
    s.frames.forEach((fr, f) => {
      fr.ops.forEach((op, j) => {
        if (drop.has(`${f}.${j}`)) return;
        if (op.op === 'cue') cue(e, op);
        else act(e, op);
      });
      const probe = fr.probe.filter((i) => !drop.has(`${f}p${i}`));
      e.m.sync(fr.t);
      if (o.pull && probe.length) {
        const ps = probe.map((i) => partOf(e, i));
        const n = ps.length;
        const cols = {
          gain: new Float64Array(n),
          crawl: new Float64Array(n),
          dark: new Float64Array(n),
          position: new Float64Array(3 * n),
          opacity: new Float64Array(n),
          tint: new Float64Array(4 * n),
          pick: new Float64Array(n),
          odd: new Float64Array(n),
        } satisfies Columns<Pose>;
        e.m.pull(ps, cols);
        const read = Object.entries(cols).map(([c, a]) => `${c}:${Array.from(a).join(',')}`);
        out.push(`t=${fr.t} pull ${read.join(' ')}`);
      }
      for (const i of probe) {
        const part = partOf(e, i);
        const a = snap(e.m.probe(part));
        const b = snap(e.m.probe(part, reuse));
        if (o.history) {
          const past = e.remet.has(i) ? '(#15)' : snap(e.m.project(fr.t - 150).probe(part));
          out.push(`t=${fr.t} p${i} proj ${past}`);
        }
        out.push(`t=${fr.t} p${i} ${a}`);
        out.push(`t=${fr.t} p${i} reuse ${b}`);
        out.push(`t=${fr.t} p${i} rest ${e.m.atRest(part)}`);
      }
      const w = e.handles.map((h) =>
        h ? probe.map((i) => h.weightOf(partOf(e, i))).join(',') : '-',
      );
      const zero = motionAtZero(e);
      const known = zero || e.wasZero;
      e.wasZero = zero;
      const inert = !o.inert ? '' : known ? ' inert (#16)' : ` inert ${e.m.inert}`;
      out.push(`t=${fr.t} w ${w.join('|')}${inert}`);
    });
  } catch (err) {
    out.push(`threw ${String(err).slice(0, 120)}`);
  }
  out.push(`errs ${JSON.stringify(e.errs)}`);
  return out;
}

export interface Divergence {
  /** Index of the first differing reading. */
  line: number;
  off: string;
  on: string;
}
/** The first reading where lanes on and lanes off disagree; undefined where they agree throughout. */
export function diverge(s: Scene, drop: Dropped = new Set()): Divergence | undefined {
  const a = play(s, false, drop);
  const b = play(s, true, drop);
  const n = Math.max(a.length, b.length);
  for (let line = 0; line < n; line++)
    if (a[line] !== b[line]) return { line, off: a[line] ?? '(end)', on: b[line] ?? '(end)' };
  return undefined;
}

/** One line per frame that still holds something: its time, its probes, and its ops as data. */
export function describe(s: Scene, drop: Dropped = new Set()): string {
  const lines: string[] = [];
  s.frames.forEach((fr, f) => {
    const ops = fr.ops.filter((_, j) => !drop.has(`${f}.${j}`));
    const probe = fr.probe.filter((i) => !drop.has(`${f}p${i}`));
    if (ops.length || probe.length)
      lines.push(`t=${fr.t} probe=${probe} ${ops.map((op) => JSON.stringify(op)).join(' ; ')}`);
  });
  return lines.join('\n');
}

/**
 * Drops every op and probe of a diverging seed that the divergence survives without, and prints
 * what is left. From a scratch script: `console.log(shrink(42, { history: true }))`.
 */
export function shrink(seed: number, options: SceneOptions = {}): string {
  const s = scene(seed, options);
  if (!diverge(s)) return `seed ${seed}: lanes on and off agree`;
  const items: string[] = [];
  s.frames.forEach((fr, f) => {
    fr.ops.forEach((_, j) => {
      items.push(`${f}.${j}`);
    });
    for (const i of fr.probe) items.push(`${f}p${i}`);
  });
  const drop = new Set<string>();
  for (let pass = 0; pass < 3; pass++)
    for (const it of items) {
      if (drop.has(it)) continue;
      drop.add(it);
      if (!diverge(s, drop)) drop.delete(it);
    }
  const d = diverge(s, drop) as Divergence;
  return `${describe(s, drop)}\noff: ${d.off}\non:  ${d.on}`;
}
