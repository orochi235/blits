import { createHistory as tape } from '@weasel-js/history';
import { kit, last, max, mul, sum, vec } from '../../src/channels.js';
import { mix } from '../../src/mixer.js';
import { glide, spring, tween } from '../../src/motion.js';
import { keys, patch } from '../../src/patch.js';
import { angle } from '../../src/rotation.js';
import { level } from '../../src/signals.js';
import type { Handle, Mix, Patch, Signal, VoiceSpec } from '../../src/types.js';

/**
 * A random program of cues and host calls, played with lanes on and off: every op a handle, a
 * motion, a level, an `around` ball, an owner or the subject list takes, made between frames or,
 * with `mid`, between two probes of one frame.
 */

interface Pose {
  a: number;
  b: number;
  c: number;
  p: number[];
  h: number;
  k: number;
}
interface Part {
  id: number;
}
const K = () =>
  kit<Pose>({
    a: sum(),
    b: mul(),
    c: max({ bounds: [0, 3] }),
    p: vec(2, sum()),
    h: angle(),
    k: last(),
  });
const MOVED = ['a', 'b', 'c', 'h'] as const;

export interface OpsOptions {
  /** Ops between two probes of one frame, not only between frames. */
  mid?: boolean;
  /** A mix with history, read back by `project` after each probe. */
  hist?: boolean;
}

/** What a motion patch offers the ops: `to`, `push` and `set` by subject. */
interface Moving {
  to(subject: Part, value: number): void;
  push(subject: Part, velocity: number): void;
  set(subject: Part, value: number): void;
}

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

/**
 * Plays program `seed` and returns every reading it made, one line each. `skip` leaves out ops
 * (`o<n>`), probes (`p<frame>.<id>`) and pulls (`pull<frame>`) by name, for `shrink`; `log`
 * collects each op as it is made.
 */
export function play(
  seed: number,
  lanes: boolean,
  opt: OpsOptions = {},
  skip: ReadonlySet<string> = new Set(),
  log?: string[],
): string[] {
  let opn = 0;
  const r = rng(seed);
  const m: Mix<Part, Pose> = mix<Part, Pose>(K(), {
    lanes,
    ...(opt.hist ? { history: { ms: 3000, every: 100, tape } } : {}),
  });
  const n = 8 + r.i(40);
  let parts: Part[] = Array.from({ length: n }, (_, id) => ({ id }));
  let nextId = n;
  const xy = new Float64Array(200 * 2);
  const useAround = r.p(0.4);
  if (useAround) {
    for (let j = 0; j < n; j++) {
      xy[2 * j] = j % 7;
      xy[2 * j + 1] = Math.floor(j / 7);
    }
    m.plot(parts, xy);
  }
  const ball = { x: 3, y: 3, r: 2.5 };
  const sparse = r.pick([1, 0.8, 0.3, 0.1, 0.03]);
  const handles: (Handle<Part> | undefined)[] = [];
  const movers: { h: Handle<Part>; p: Moving }[] = [];
  const owners: Handle<Part>[] = [];
  const levels: ReturnType<typeof level<Part>>[] = [];
  const out: string[] = [];
  const errs: string[] = [];
  let t = r.pick([0, 1000]);
  let curF = 0;
  const mkPatch = (): { patch: Patch<Part, Pose, unknown>; moving?: Moving } => {
    const kind = r.pick(['tween', 'spring', 'glide', 'keys', 'fn', 'fn2', 'vspring', 'vtween']);
    if (kind === 'vspring' || kind === 'vtween') {
      const fx = r.f();
      const tx = r.f() * 2;
      const from = (s: Part) => [fx, s.id * 0.1];
      const p =
        kind === 'vspring'
          ? spring<Part, Pose, number[]>('p', { from, to: [tx, 1] })
          : tween<Part, Pose, number[]>('p', { from, to: [tx, 1], ms: 300 });
      return { patch: p as Patch<Part, Pose, unknown>, moving: p as unknown as Moving };
    }
    const ch = r.pick(MOVED);
    const from = r.f() * 2;
    const to = r.f() * 2;
    if (kind === 'tween') {
      const ms = r.pick([50, 200, 400]);
      const ease = r.pick(['linear', 'ease'] as const);
      const p = tween<Part, Pose>(ch, { from: (s) => from + s.id * 0.01, to, ms, ease });
      return { patch: p as Patch<Part, Pose, unknown>, moving: p as unknown as Moving };
    }
    if (kind === 'spring') {
      const p = spring<Part, Pose>(ch, { from: (s) => from + s.id * 0.01, to });
      return { patch: p as Patch<Part, Pose, unknown>, moving: p as unknown as Moving };
    }
    if (kind === 'glide') {
      const p = glide<Part, Pose>(ch, { from, velocity: r.f() * 4 - 2 });
      return { patch: p as Patch<Part, Pose, unknown>, moving: p as unknown as Moving };
    }
    if (kind === 'keys') {
      const d1: Record<string, number | number[]> = {};
      const d2: Record<string, number | number[]> = {};
      for (const w of ['a', 'b', 'p', 'k'] as const)
        if (r.p(0.5)) {
          d1[w] = w === 'p' ? [r.f(), r.f()] : w === 'k' ? r.i(4) : r.f() * 2;
          d2[w] = w === 'p' ? [r.f(), r.f()] : w === 'k' ? r.i(4) : r.f() * 2;
        }
      if (Object.keys(d1).length === 0) {
        d1.a = 1;
        d2.a = 2;
      }
      const p = keys<Part, Pose>(r.pick([100, 300, 600]), [
        { at: 0, delta: d1 as Partial<Pose> },
        { at: 1, delta: d2 as Partial<Pose> },
      ]);
      return { patch: p as Patch<Part, Pose, unknown> };
    }
    const k = r.f() * 5;
    const p =
      kind === 'fn'
        ? patch<Part, Pose>(
            r.pick([0, 200, 500]),
            (ph, s) => ({ a: Math.sin(ph * k + s.id), c: 1 + Math.cos(ph * k) }),
            { writes: ['a', 'c'] },
          )
        : patch<Part, Pose>(
            r.pick([0, 200, 500]),
            (ph, s) => ({ b: 1 + 0.3 * Math.sin(ph * k + s.id), p: [ph, s.id * 0.1] }),
            { writes: ['b', 'p'] },
          );
    return { patch: p as Patch<Part, Pose, unknown> };
  };
  const cue = () => {
    const { patch: p, moving } = mkPatch();
    const spec: VoiceSpec<Part, Pose> = { patch: p };
    const crowd = r.p(0.5);
    if (crowd) spec.subjects = [r.pick(parts)];
    else if (r.p(0.15)) spec.subjects = [r.pick(parts), r.pick(parts), r.pick(parts)];
    if (r.p(0.3)) spec.fade = { in: r.pick([0, 100, 200]), out: r.pick([0, 100, 300]) };
    const w = r.f();
    if (w < 0.1) spec.weight = 0;
    else if (w < 0.3) spec.weight = Math.round(r.f() * 8) / 8;
    else if (w < 0.45) {
      const l = level<Part>(r.f());
      levels.push(l);
      spec.weight = l as Signal<Part>;
    } else if (w < 0.6 && useAround) spec.weight = m.around(ball);
    if (!crowd && r.p(0.25)) spec.role = r.pick(['x', 'y']);
    if (r.p(0.25)) spec.loop = r.pick([true, 2]);
    if (r.p(0.15)) spec.start = t + r.pick([0, 50, 200]);
    if (r.p(0.15)) spec.rate = r.pick([0.5, 2, 0]);
    if (r.p(0.2)) {
      const st = r.pick([20, 60]);
      spec.stagger = (s: Part) => (s.id % 5) * st;
    }
    if (owners.length && r.p(0.3)) spec.owner = r.pick(owners);
    const id = `o${opn++}`;
    if (skip.has(id)) {
      handles.push(undefined);
      return;
    }
    log?.push(`${id} f${curF} cue subjects ${spec.subjects?.map((x) => x.id)}`);
    try {
      const h = m.cue(spec);
      handles.push(h);
      if (moving) movers.push({ h, p: moving });
    } catch (e) {
      handles.push(undefined);
      errs.push(`cue ${String(e).slice(0, 60)}`);
    }
  };
  const runOps = (k: number, f: number) => {
    for (let j = 0; j < k; j++) {
      const what =
        f === 0
          ? 'cue'
          : r.pick([
              'cue',
              'cue',
              'fade',
              'fadeSub',
              'weight',
              'rate',
              'seek',
              'to',
              'push',
              'set',
              'drop',
              'level',
              'ball',
              'owner',
              'ownerAct',
              'rise',
              'mseek',
              'put',
              'rest',
              'mute',
              'cue',
              'cue',
            ] as const);
      const part = r.pick(parts);
      const h = handles.length ? r.pick(handles) : undefined;
      const X = [r.f(), r.f(), r.f(), r.f()];
      let xi = 0;
      const rr = {
        f: () => X[xi++ % 4] as number,
        pick: <T>(a: readonly T[]): T => a[Math.floor((X[xi++ % 4] as number) * a.length)] as T,
        p: (q: number) => (X[xi++ % 4] as number) < q,
      };
      if (what !== 'cue') {
        const id = `o${opn++}`;
        if (skip.has(id)) continue;
        log?.push(`${id} f${f} t=${t} ${what} part ${part.id} X ${X.map((x) => x.toFixed(3))}`);
      }
      try {
        switch (what) {
          case 'cue':
            cue();
            break;
          case 'fade':
            h?.fade({ over: rr.pick([0, 100, 250]) });
            break;
          case 'rise':
            h?.rise({ over: rr.pick([0, 100]) });
            break;
          case 'fadeSub':
            h?.fade({ subject: part, over: rr.pick([0, 100]) });
            break;
          case 'weight':
            if (h) h.weight = Math.round(rr.f() * 4) / 4;
            break;
          case 'rate':
            if (h) h.rate = rr.pick([0, 0.5, 1, 2]);
            break;
          case 'seek':
            h?.seek(rr.f() * 500);
            break;
          case 'to': {
            if (!movers.length) break;
            const mv = rr.pick(movers);
            if (rr.p(0.5)) mv.h.to(part, rr.f() * 3);
            else mv.p.to(part, rr.f() * 3);
            break;
          }
          case 'push':
            if (movers.length) rr.pick(movers).p.push(part, rr.f() * 4 - 2);
            break;
          case 'set':
            if (movers.length) rr.pick(movers).p.set(part, rr.f() * 2);
            break;
          case 'drop': {
            m.drop(part);
            const idx = parts.indexOf(part);
            parts = parts.slice();
            parts[idx] = { id: nextId++ };
            if (useAround) m.plot(parts, xy);
            break;
          }
          case 'mseek':
            if (opt.hist) {
              const now = m.now;
              m.seek(now - rr.pick([30, 120, 300, 700]));
              if (rr.p(0.7)) m.seek(now);
            }
            break;
          case 'put':
            if (useAround && rr.p(0.99) && parts.includes(part))
              m.put(part, rr.f() * 7, rr.f() * 7);
            break;
          case 'mute':
            if (rr.p(0.3)) m.mute({ over: rr.pick([0, 100]) });
            break;
          case 'rest':
            h?.fade({ at: 'rest', deadline: 400 });
            break;
          case 'level':
            if (levels.length) rr.pick(levels).set(Math.round(rr.f() * 4) / 4);
            break;
          case 'ball':
            ball.x = rr.f() * 7;
            ball.y = rr.f() * 7;
            ball.r = rr.pick([1, 2.5, 4]);
            break;
          case 'owner':
            owners.push(
              m.owns({
                rate: rr.pick([1, 0.5, 2]),
                weight: rr.pick([1, 0.5]),
                ...(rr.p(0.5) ? { fade: { in: 100, out: 100 } } : {}),
                ...(owners.length > 0 && rr.p(0.4) ? { owner: rr.pick(owners) } : {}),
              }),
            );
            break;
          case 'ownerAct':
            if (owners.length) {
              const o = rr.pick(owners);
              const x = rr.f();
              if (x < 0.3) o.fade({ over: 100 });
              else if (x < 0.6) o.rate = rr.pick([0, 0.5, 2]);
              else o.weight = rr.pick([0, 0.5, 1]);
            }
            break;
        }
      } catch (e) {
        errs.push(`${what} ${String(e).slice(0, 60)}`);
      }
    }
  };
  const frames = 8 + r.i(20);
  for (let f = 0; f < frames; f++) {
    curF = f;
    runOps(f === 0 ? 2 + r.i(6) : r.i(4), f);
    m.sync(t);
    const probe = parts.filter((pp) => r.p(sparse) && !skip.has(`p${f}.${pp.id}`));
    log?.push(`f${f} sync ${t} probe ${probe.map((x) => x.id)}`);
    const mid = opt.mid ? r.i(probe.length + 1) : -1;
    const midK = opt.mid ? 1 + r.i(2) : 0;
    probe.forEach((part, pi) => {
      if (pi === mid) runOps(midK, f);
      const v = m.probe(part);
      out.push(`t=${t} ${part.id} ${JSON.stringify(v)} rest ${m.atRest(part)}`);
      if (opt.hist) {
        let past: string;
        try {
          past = JSON.stringify(m.project(m.now - 150).probe(part));
        } catch (e) {
          past = String(e).slice(0, 60);
        }
        out.push(`proj ${past}`);
      }
    });
    if (r.p(0.2) && probe.length && !skip.has(`pull${f}`)) {
      const len = probe.length;
      const cols = {
        a: new Float64Array(len),
        b: new Float64Array(len),
        c: new Float64Array(len),
        p: new Float64Array(2 * len),
        h: new Float64Array(len),
        k: new Float64Array(len),
      };
      m.pull(probe, cols);
      out.push(
        `pull ${Object.values(cols)
          .map((c) => Array.from(c).join(','))
          .join(' ')}`,
      );
    }
    const ws = handles.map((h) => (h ? probe.map((p) => h.weightOf(p)).join(',') : '-'));
    out.push(`t=${t} w ${ws.join('|')} inert ${m.inert}`);
    t += r.pick([0, 16, 16, 33, 100, 250, 400]);
  }
  out.push(`errs ${JSON.stringify(errs)}`);
  return out;
}

/** The first reading program `seed` makes differently with lanes on and off, if any. */
export function diverge(seed: number, opt: OpsOptions = {}, skip: ReadonlySet<string> = new Set()) {
  let a: string[];
  let b: string[];
  try {
    a = play(seed, false, opt, skip);
  } catch (e) {
    a = [`threw ${e}`];
  }
  try {
    b = play(seed, true, opt, skip);
  } catch (e) {
    b = [`threw ${e}`];
  }
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) return { line: i, off: a[i], on: b[i] };
  return undefined;
}

/**
 * Program `seed` cut down to the ops, probes and pulls it still diverges with: the log of what is
 * left, and the first reading that differs.
 */
export function shrink(seed: number, opt: OpsOptions = {}): string {
  const items: string[] = [];
  const log: string[] = [];
  play(seed, false, opt, new Set(), log);
  for (const l of log) {
    const op = /^(o\d+)/.exec(l);
    if (op) items.push(op[1] as string);
    const pm = /^f(\d+) sync \S+ probe (.*)$/.exec(l);
    if (pm) {
      for (const id of (pm[2] as string).split(',').filter(Boolean)) items.push(`p${pm[1]}.${id}`);
      items.push(`pull${pm[1]}`);
    }
  }
  const skip = new Set<string>();
  for (let pass = 0; pass < 3; pass++)
    for (const it of items) {
      if (skip.has(it)) continue;
      skip.add(it);
      if (!diverge(seed, opt, skip)) skip.delete(it);
    }
  const kept: string[] = [];
  play(seed, false, opt, skip, kept);
  const d = diverge(seed, opt, skip);
  return `${kept.filter((l) => !/probe $/.test(l)).join('\n')}\n${JSON.stringify(d, null, 1)}`;
}
