// Seek-replay fuzz: plays a program straight through, then checks a seek back and playing on, a
// seek by mix time, and reads back and ahead against what each frame showed.
import type { Mix } from '../../src/types.js';
import { apply, build, type Env, vecVoices } from './replay-env.js';
import { type Mode, type Part, type Pose, type Program, SUBJ } from './replay-program.js';

export { type GenOpts, type Mode, type Program, program } from './replay-program.js';

export interface Rec {
  host: number[];
  now: number[];
  seq: number[];
  poses: number[][]; // per frame, flat numbers over mixes x subjects
  events: string[];
  errs: string[];
}

const num = (x: number | undefined) => (x === undefined ? -999 : Object.is(x, -0) ? 0 : x);
function readPoses(
  e: Env,
  into?: (m: Mix<Part, Pose>, i: number) => { probe(s: Part): Pose },
): number[] {
  const out: number[] = [];
  e.ms.forEach((m, i) => {
    const src = into ? into(m, i) : m;
    for (const s of SUBJ) {
      let p: Pose;
      try {
        p = src.probe(s);
      } catch {
        out.push(-12345);
        continue;
      }
      out.push(num(p.x), num(p.g), num(p.h), num(p.k), num(p.p?.[0]), num(p.p?.[1]));
    }
  });
  return out;
}
function drainAll(e: Env): string {
  return e.ms
    .map((m) => {
      try {
        return JSON.stringify(
          m
            .drain()
            .map((d) => [
              Math.round(d.timestamp * 1e6) / 1e6,
              (d.subject as Part).id,
              d.voice,
              d.event,
            ]),
        );
      } catch {
        return 'x';
      }
    })
    .join('|');
}
export function hostTimes(p: Program): number[] {
  const out: number[] = [];
  let t = 0;
  p.dts.forEach((d, f) => {
    t += d;
    if (p.ops.some((o) => o.k === 'rebase' && o.f === f)) t += 300;
    out.push(t);
  });
  return out;
}
const rebasedAt = (p: Program, f: number) => p.ops.some((o) => o.k === 'rebase' && o.f === f);

function sys(e: Env) {
  if (e.t) {
    const t = e.t;
    return {
      sync: (h: number) => t.sync(h),
      rebase: () => t.rebase(),
      seek: (x: number | { frame: number }) => t.seek(x),
      prepare: (x: number) => t.prepare(x),
      forward: () => {
        t.rate = 1;
      },
      get now() {
        return t.now;
      },
      get seq() {
        return t.seq;
      },
      project: (at: number | { frame: number }) => {
        const pr = t.project(at);
        return (m: Mix<Part, Pose>) => pr.of(m);
      },
    };
  }
  const m = e.ms[0] as Mix<Part, Pose>;
  return {
    sync: (h: number) => m.sync(h),
    rebase: () => m.rebase(),
    seek: (x: number | { frame: number }) => m.seek(x),
    prepare: (x: number) => m.prepare(x),
    forward: () => {
      m.rate = 1;
    },
    get now() {
      return m.now;
    },
    get seq() {
      return m.seq;
    },
    project: (at: number | { frame: number }) => {
      const pr = m.project(at);
      return (_m: Mix<Part, Pose>) => pr;
    },
  };
}

/** Plays `p` straight through, recording every frame. */
export function play(p: Program, mode: Mode, upto = p.dts.length): { e: Env; rec: Rec } {
  const e = build(mode);
  const vs = new Set<number>();
  for (const o of p.ops) {
    if (o.k === 'cue' && o.patch === 'vspring') vs.add(o.id);
    if (o.k === 'call' && o.cue.patch === 'vspring') vs.add(o.cue.id);
  }
  vecVoices.set(e, vs);
  const S = sys(e);
  const host = hostTimes(p);
  const rec: Rec = { host: [], now: [], seq: [], poses: [], events: [], errs: e.errs };
  for (let f = 0; f < upto; f++) {
    if (rebasedAt(p, f) && f > 0) S.rebase();
    S.sync(host[f] as number);
    for (const o of p.ops) if (o.f === f) apply(e, o);
    rec.host.push(host[f] as number);
    rec.now.push(S.now);
    rec.seq.push(S.seq);
    rec.poses.push(readPoses(e));
    rec.events.push(drainAll(e));
  }
  return { e, rec };
}

function differs(a: number[] | undefined, b: number[] | undefined): boolean {
  if (!a || !b || a.length !== b.length) return true;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (Number.isNaN(x) !== Number.isNaN(y)) return true;
    if (!Number.isNaN(x) && !(Math.abs(x - y) <= 1e-9)) return true;
  }
  return false;
}
function where(a: number[], b: number[]): string {
  const per = 6;
  const names = ['x', 'g', 'h', 'k', 'p0', 'p1'];
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (Number.isNaN(x) !== Number.isNaN(y) || (!Number.isNaN(x) && !(Math.abs(x - y) <= 1e-9))) {
      const mixI = Math.floor(i / (per * 4));
      const sub = Math.floor(i / per) % 4;
      out.push(`m${mixI}.s${sub}.${names[i % per]} got ${x} want ${y}`);
    }
  }
  return out.slice(0, 4).join('; ');
}

function dispose(e: Env): void {
  for (const m of e.ms)
    try {
      m.close();
    } catch {}
}
export type Check = { kind: 'seek' | 'seekTime' | 'behind' | 'ahead'; k: number };

/** How check `c` fails on `p`, or null. Throws from a seek or projection count as refusals, not failures. */
export async function run(p: Program, mode: Mode, c: Check, ref?: Rec): Promise<string | null> {
  const made: Env[] = [];
  try {
    return await runIn(p, mode, c, ref, made);
  } finally {
    for (const e of made) dispose(e);
    await new Promise((r) => setTimeout(r, 0));
  }
}
async function runIn(
  p: Program,
  mode: Mode,
  c: Check,
  ref: Rec | undefined,
  made: Env[],
): Promise<string | null> {
  const r = ref ?? play(p, mode).rec;
  const F = r.now.length;
  const k = c.k;
  if (k >= F) return null;
  if (c.kind === 'behind') {
    const { e } = play(p, mode);
    made.push(e);
    const S = sys(e);
    try {
      if (mode.store) await S.prepare(r.now[k] as number);
      const proj = S.project({ frame: r.seq[k] as number });
      const got = readPoses(e, (m) => proj(m));
      if (differs(got, r.poses[k]))
        return `behind frame ${k}: ${where(got, r.poses[k] as number[])}`;
    } catch {
      return null;
    }
    return null;
  }
  const { e } = play(p, mode);
  made.push(e);
  const S = sys(e);
  // A seek made while the mix runs back keeps it running back (reverse.test, by design), so turn it
  // forward in one extra frame past the program first.
  let host = r.host[F - 1] as number;
  const target = c.kind === 'seekTime' ? (r.now[k] as number) : { frame: r.seq[k] as number };
  if (c.kind === 'seekTime') {
    // only where that mix time names one frame
    if (r.now.filter((x) => x === r.now[k]).length !== 1) return null;
  }
  try {
    if (mode.store) await S.prepare(r.now[k] as number);
    S.seek(target);
  } catch (err) {
    return `refused:${String(err).slice(0, 60)}`;
  }
  const at = readPoses(e);
  if (differs(at, r.poses[k])) return `seek to frame ${k}: ${where(at, r.poses[k] as number[])}`;
  drainAll(e);
  if (c.kind === 'ahead') {
    // read ahead to later frames whose mix time is unique and reached by a forward run
    for (let f = k + 1; f < F; f++) {
      let mono = true;
      for (let g = k + 1; g <= f; g++)
        if (!((r.now[g] as number) > (r.now[g - 1] as number))) mono = false;
      if (!mono) break;
      // A read ahead makes none of the driver's calls (schema, Drivers).
      if (p.ops.some((o) => o.k === 'call' && o.f > k && o.f <= f)) break;
      if (r.now.filter((x) => x === r.now[f]).length !== 1) continue;
      let got: number[];
      try {
        if (mode.store) await S.prepare(r.now[f] as number);
        const proj = S.project(r.now[f] as number);
        got = readPoses(e, (m) => proj(m));
      } catch {
        continue;
      }
      if (differs(got, r.poses[f]))
        return `seek ${k}, project frame ${f}: ${where(got, r.poses[f] as number[])}`;
    }
  }
  for (let f = k + 1; f < F; f++) {
    if (rebasedAt(p, f)) S.rebase();
    host += (r.host[f] as number) - (r.host[f - 1] as number);
    try {
      S.sync(host);
    } catch (err) {
      return `replay sync ${f} threw ${String(err).slice(0, 80)}`;
    }
    const got = readPoses(e);
    if (differs(got, r.poses[f]))
      return `seek ${k} then frame ${f}: ${where(got, r.poses[f] as number[])}`;
    // Every event the frame sent, those stamped before the moment sought included.
    const ev = drainAll(e);
    if (ev !== r.events[f])
      return `seek ${k} then frame ${f} events: got ${ev.slice(0, 200)} want ${r.events[f]?.slice(0, 200)}`;
  }
  return null;
}

export function describeOps(p: Program, ops = p.ops): string {
  const host = hostTimes(p);
  return ops.map((o) => `f${o.f}@${host[o.f]} ${JSON.stringify(o)}`).join('\n');
}

/** Drops ops while check `c` still fails (any non-refusal failure), and trims trailing frames. */
export async function shrink(
  p: Program,
  mode: Mode,
  c: Check,
): Promise<{ p: Program; failure: string | null }> {
  const fails = async (q: Program) => {
    try {
      const f = await run(q, mode, c);
      return f !== null && !f.startsWith('refused') ? f : null;
    } catch (err) {
      return `threw ${String(err).slice(0, 80)}`;
    }
  };
  let cur = p;
  let failure = await fails(cur);
  if (!failure) return { p, failure: null };
  // trim frames
  for (let n = c.k + 2; n < cur.dts.length; n++) {
    const q = { ...cur, dts: cur.dts.slice(0, n), ops: cur.ops.filter((o) => o.f < n) };
    const fl = await fails(q);
    if (fl) {
      cur = q;
      failure = fl;
      break;
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < cur.ops.length; i++) {
      const q = { ...cur, ops: cur.ops.filter((_, j) => j !== i) };
      const fl = await fails(q);
      if (fl) {
        cur = q;
        failure = fl;
        changed = true;
        break;
      }
    }
  }
  return { p: cur, failure };
}
