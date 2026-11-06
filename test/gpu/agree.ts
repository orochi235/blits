import { createHistory } from '@weasel-js/history';
import { gpu, gpuOf, mixerOf } from '../../src/gpu/engine.js';
import type { GpuDevice } from '../../src/gpu/webgpu.js';
import {
  type Easing,
  type Kit,
  type Mix,
  mix,
  mixer,
  type Signal,
  type Handle as VoiceHandle,
} from '../../src/index.js';
import type { Voice } from '../../src/voice.js';
import { close, closeNear, nudge, readBack } from './harness.js';

/** The staggered agreement tests' subjects, and the voices and scripts played over them. */
export interface C {
  id: number;
}
export const N = 257;
export const CELLS: C[] = Array.from({ length: N }, (_, id) => ({ id }));
export const fieldsOf = (s: C) => ({ id: s.id, x: s.id / (N - 1) });

/** A seeded shuffle of 0..N-1, the order a host such as blinken's gives its subjects. */
const RANK: number[] = (() => {
  let seed = 7;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const r = Array.from({ length: N }, (_, i) => i);
  for (let i = N - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [r[i], r[j]] = [r[j] as number, r[i] as number];
  }
  return r;
})();
export const rank = (c: C) => RANK[c.id] as number;
export const STAGGER = (c: C) => rank(c) * 7;
/** Delays from -900 to 892. */
export const NEGATIVE = (c: C) => rank(c) * 7 - 900;

/** A runner kind, and the channel its voices write. */
export interface Kind {
  name: string;
  kit: () => Kit<never>;
  channel: string;
  /** Its pass length, where a subject's time near a multiple may round across an edge; 0 for none. */
  period: number;
  /** Whether its voices take a `loop`; a motion's take none. */
  loops: boolean;
  /** Compares every sample with `closeNear`, for a patch with branches inside a pass. */
  near?: boolean;
  tolerance?: number;
  patch: (k: number, kit: Kit<never>) => object;
}

/** A voice: its delays, which subjects it reaches, and how it plays. */
export interface Cue {
  stagger?: (c: C) => number;
  reach?: (i: number) => boolean;
  /** Its loop where its subjects are named; one asked as met loops for good. */
  loop?: number | boolean;
  rate?: number;
  role?: string;
  weight?: number | Signal<C>;
  fade?: { in?: number; out?: number; ease?: Easing };
  freeze?: 'before' | 'after';
  /** The owner it plays under, as an index into the script's `owners`. */
  owner?: number;
  /** When it starts, on its owner's clock where it has one. */
  start?: number;
}

/** An owner the cues play under; `span` cues it as a span with that budget. */
export interface OwnerCue {
  start?: number;
  rate?: number;
  seek?: number;
  weight?: number | Signal<C>;
  fade?: { in?: number; out?: number };
  /** The owner it plays under, as an index into the owners before it. */
  owner?: number;
  span?: { duration: number };
}

export type Handle = {
  rate: number;
  weight: number;
  ramp(r: number, over: number): void;
  seek(elapsed: number): unknown;
  fade(): void;
  rise(): void;
};

/** What the scripts call on a motion patch. */
export type Moving = {
  to?(subject: C, goal: number, at?: number): void;
  push?(subject: C, v: number, at?: number): void;
};

export interface Script {
  cues: Cue[];
  owners?: OwnerCue[];
  times: number[];
  /**
   * Done to both mixes, their handles, patches and owners' handles right after the sync at `at`,
   * before that time is compared. One `after` runs once the GPU has folded that frame and the CPU
   * has probed every subject, as a host's change between syncs does, and the GPU folds again.
   */
  acts?: {
    at: number;
    act: (h: Handle[], p: Moving[], m: Mix<C, never>, o: Handle[]) => void;
    after?: boolean;
  }[];
  /** Gives both mixes a history, so a mix-level `seek` can move them. */
  history?: boolean;
  /** From this time on the voices stay on the CPU, so the GPU folds no channel. */
  cpuFrom?: number;
  /** After the reading at this time, the subjects are registered again in another order. */
  reorder?: number;
}

/**
 * The kind's voices cued by `cues` on a mix made by `engine`, named or asked as met, under the
 * owners cued first.
 */
export function make(
  kind: Kind,
  cues: Cue[],
  named: boolean,
  engine: typeof mixer,
  history = false,
  owners: OwnerCue[] = [],
) {
  const kt = kind.kit();
  const m = mix<C, never>(kt, {
    engine,
    name: 'agree',
    ...(history ? { history: { ms: 1e5, tape: createHistory } } : {}),
  });
  m.sync(0);
  const held: VoiceHandle<C>[] = [];
  for (const { owner, span, ...rest } of owners) {
    const spec = { ...rest, ...(owner === undefined ? {} : { owner: held[owner] }) };
    held.push(span === undefined ? m.owns(spec) : m.span({ ...spec, ...span }));
  }
  const patches: Moving[] = [];
  const handles = cues.map((c, k) => {
    const reached = c.reach === undefined ? CELLS : CELLS.filter((_, i) => c.reach?.(i));
    const whom = named
      ? { subjects: reached }
      : c.reach === undefined
        ? {}
        : { target: (s: C) => reached.includes(s) };
    const patch = kind.patch(k, kt);
    patches.push(patch as Moving);
    return m.cue({
      patch: patch as never,
      ...whom,
      ...(kind.loops ? { loop: named ? (c.loop ?? true) : true } : {}),
      ...(c.stagger === undefined ? {} : { stagger: c.stagger }),
      ...(c.rate === undefined ? {} : { rate: c.rate }),
      ...(c.role === undefined ? {} : { role: c.role }),
      ...(c.weight === undefined ? {} : { weight: c.weight }),
      ...(c.fade === undefined ? {} : { fade: c.fade }),
      ...(c.freeze === undefined ? {} : { freeze: c.freeze }),
      ...(c.owner === undefined ? {} : { owner: held[c.owner] }),
      ...(c.start === undefined ? {} : { start: c.start }),
    }) as unknown as Handle;
  });
  return { m, handles, patches, owners: held as unknown as Handle[] };
}

/** The distance from `x` to the next f32 out from 0, as `nudge` steps. */
const stepAt = (x: number) => Math.abs(nudge(Math.abs(x), 1) - Math.fround(Math.abs(x)));

/**
 * Whether a voice's time for `s` at `t` is within one f32 step of its start or a pass edge, where
 * the GPU's f32 may round across. The step is the voice's raw time's, the larger of the times the
 * GPU subtracts the delay from and gets.
 */
export function nearEdge(
  voices: readonly Voice<C, never>[],
  cues: Cue[],
  s: C,
  t: number,
  period: number,
): boolean {
  return voices.some((v, k) => {
    const raw = v.rawAt(t, cues[k]?.stagger?.(s) ?? 0);
    if (!Number.isFinite(raw)) return false;
    const off = period > 0 ? raw - Math.round(raw / period) * period : raw;
    return Math.abs(off) <= Math.max(stepAt(raw), stepAt(v.rawAt(t, 0)));
  });
}

/** Axis `a` of `channel` as `m` probes it for `s`. */
export function probed(m: { probe(s: C): unknown }, s: C, channel: string, a: number): number {
  const v = (m.probe(s) as Record<string, number | number[]>)[channel];
  return (Array.isArray(v) ? (v[a] ?? 0) : v) as number;
}

/**
 * Plays the same voices on a gpu mix and a CPU mix and compares every subject at the script's
 * times, with `closeNear` only where a subject's time is on a pass edge or its start.
 */
export async function agree(device: GpuDevice, kind: Kind, script: Script, named: boolean) {
  const g = make(kind, script.cues, named, gpu({ device }), script.history, script.owners);
  const c = make(kind, script.cues, named, mixer, script.history, script.owners);
  // The voices the cues made, in cue order, so `nearEdge` pairs each with its cue.
  const cpuVoices = ([...mixerOf(c.m).cued] as unknown as Voice<C, never>[]).filter(
    (v) => v.holding === null,
  );
  const side = gpuOf(g.m);
  let list = CELLS;
  side.subjects(list, fieldsOf);
  side.channel(kind.channel);
  await side.ready;
  const acts = script.acts ?? [];
  const all = [...new Set([...script.times, ...acts.map((a) => a.at)])].sort((a, b) => a - b);
  for (const t of all) {
    g.m.sync(t);
    c.m.sync(t);
    const run = (after: boolean) => {
      for (const a of acts)
        if (a.at === t && !!a.after === after) {
          a.act(g.handles, g.patches, g.m, g.owners);
          a.act(c.handles, c.patches, c.m, c.owners);
        }
    };
    run(false);
    const compiled = side.ready;
    // Every frame as a host drawing every subject sees it: the GPU folds, the CPU probes each.
    let ch = side.channel(kind.channel);
    if (acts.some((a) => a.at === t && a.after)) {
      for (const s of list) c.m.probe(s);
      run(true);
      ch = side.channel(kind.channel);
    }
    if (!script.times.includes(t)) {
      for (const s of list) c.m.probe(s);
      continue;
    }
    if (script.cpuFrom !== undefined && t >= script.cpuFrom) {
      if (ch !== null) throw new Error(`the channel is on the GPU at ${t}, past ${script.cpuFrom}`);
      continue;
    }
    if (ch === null && side.ready !== compiled) {
      // A voice starting late brings a runner the first kernel lacked; it folds once that compiles.
      await side.ready;
      ch = side.channel(kind.channel);
    }
    if (ch === null) throw new Error(`the channel is not on the GPU at ${t}`);
    const axes = ch.axes;
    const got = await readBack(device, ch.buffer, ch.offset, N * axes * 4);
    const tol = kind.tolerance;
    list.forEach((s, i) => {
      const near = kind.near || nearEdge(cpuVoices, script.cues, s, t, kind.period);
      for (let a = 0; a < axes; a++) {
        const what = `t ${t} subject ${s.id} axis ${a}`;
        const x = got[i * axes + a] as number;
        // Probed live first either way: a motion's sample commits what a projection only reads.
        const live = probed(c.m, s, kind.channel, a);
        const at = (tt: number) => (tt === t ? live : probed(c.m.project(tt), s, kind.channel, a));
        if (near) closeNear(x, at, t, what, tol);
        else close(x, live, what, tol);
      }
    });
    if (t === script.reorder) {
      list = CELLS.slice().sort((p, q) => rank(q) - rank(p));
      side.subjects(list, fieldsOf);
    }
  }
}
