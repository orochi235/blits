// Whether two builds give the same bits: random scenes (voices of every form, loci, fades, holds,
// subject fades, drops, retargets, seeks, projections) run through both, every read compared.
//   node bench/same.mjs <dist-a> <dist-b> [scenes] [first-seed]   SAME_LANES=off runs dist-a without lanes
// `bench/same.sh <rev>` builds a revision and compares it with this tree's dist.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [distA, distB] = process.argv.slice(2, 4);
if (distA === undefined || distB === undefined)
  throw new Error('usage: node bench/same.mjs <dist-a> <dist-b> [scenes] [first-seed]');
const scenes = Number(process.argv[4] ?? 300);
const first = Number(process.argv[5] ?? 1);
const load = (dir) => import(pathToFileURL(resolve(dir, 'index.js')).href);
const [A, B] = await Promise.all([load(distA), load(distB)]);

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NUMERIC = ['gain', 'dark', 'off', 'pos'];

function run(lib, seed, general = false) {
  const r = rng(seed);
  const pick = (xs) => xs[Math.floor(r() * xs.length)];
  const chance = (p) => r() < p;
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const trace = [];
  // A pose's keys in name order: which path filled a channel decides the order they were written.
  const sorted = (_k, v) =>
    v !== null && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v;
  const note = (label, v) => trace.push(`${label} ${JSON.stringify(v, sorted)}`);
  const attempt = (label, f) => {
    try {
      return f();
    } catch (e) {
      note(`${label} threw`, String(e?.message ?? e));
      return undefined;
    }
  };

  const K = lib.kit({
    gain: lib.mul(chance(0.3) ? { bounds: [0, 2] } : undefined),
    dark: lib.max(),
    off: lib.sum(),
    pos: lib.vec(3, lib.sum()),
    color: lib.hex(),
    tag: lib.last(),
  });
  const opts = { lanes: chance(0.7) && !general };
  if (chance(0.15)) opts.history = { ms: 2000 };
  if (chance(0.15)) opts.stepMs = pick([4, 8, 16]);
  const m = lib.mix(K, opts);
  const subjects = Array.from({ length: int(1, 40) }, (_, i) => ({ i, seed: r() * 10 }));
  const ease = () => pick(['linear', 'ease', 'ease-in', 'ease-out', (u) => u * u, undefined]);

  const motions = [];
  const patchOf = () => {
    const kind = pick(['fn', 'fn', 'stateful', 'keys', 'keys', 'spring', 'tween', 'glide']);
    const writes = NUMERIC.filter(() => chance(0.5));
    if (writes.length === 0) writes.push(pick(NUMERIC));
    const period = pick([0, 200, 500, 1000, 3000]);
    const k = r() * 3;
    if (kind === 'fn') {
      const extra = chance(0.2) ? ['color'] : chance(0.1) ? ['tag'] : [];
      return lib.patch(
        period,
        (ph, s) => {
          const d = {};
          for (const w of writes)
            d[w] =
              w === 'pos'
                ? [Math.sin(ph * 6 + s.seed) * k, ph * k, s.seed]
                : w === 'gain'
                  ? 0.5 + 0.5 * Math.sin(ph * 4 + s.seed + k)
                  : (ph + s.seed * 0.1) * k;
          if (extra[0] === 'color') d.color = ph < 0.5 ? '#ff0000' : '#0044cc';
          if (extra[0] === 'tag') d.tag = ph < 0.5 ? 'a' : 'b';
          return d;
        },
        { writes: [...writes, ...extra] },
      );
    }
    if (kind === 'stateful')
      return lib.patch(
        period,
        (_ph, s, st) => {
          const d = {};
          for (const w of writes) d[w] = w === 'pos' ? [st.state.x, s.seed, 0] : st.state.x * k;
          return d;
        },
        {
          writes,
          state: () => ({ x: 0 }),
          step: (st, dt) => {
            st.x += (1 - st.x) * Math.min(1, dt / 300);
          },
        },
      );
    if (kind === 'keys') {
      const stops = [];
      const n = int(2, 4);
      for (let j = 0; j < n; j++) {
        const delta = {};
        for (const w of writes) delta[w] = w === 'pos' ? [r() * 5, r() * 5, r() * 5] : r() * 2;
        const stop = { at: n === 1 ? 0 : j / (n - 1), delta };
        const e = ease();
        if (e !== undefined && chance(0.5)) stop.ease = e;
        stops.push(stop);
      }
      return lib.keys(period || 400, stops, chance(0.5) ? { ease: ease() ?? 'linear' } : {});
    }
    const channel = pick(['pos', 'off']);
    const v = (s, d) => (channel === 'pos' ? [s.seed + d, d, -d] : s.seed + d);
    let p;
    if (kind === 'spring')
      p = lib.spring(channel, {
        from: (s) => v(s, 0),
        to: (s) => v(s, 3),
        stiffness: pick([120, 170, 300]),
        damping: pick([10, 26, 40]),
      });
    else if (kind === 'tween')
      p = lib.tween(channel, {
        from: (s) => v(s, 0),
        to: (s) => v(s, 2),
        ms: chance(0.3) ? (s) => 200 + s.i * 10 : pick([150, 400, 900]),
        ease: ease() ?? 'ease',
      });
    else p = lib.glide(channel, { from: (s) => v(s, 1), velocity: (s) => v(s, 4), ms: 300 });
    motions.push({ p, kind, channel, v });
    return p;
  };

  const handles = [];
  const cue = () => {
    const spec = { patch: patchOf() };
    const reach = pick(['all', 'one', 'some', 'target']);
    if (reach === 'one') spec.subjects = [pick(subjects)];
    if (reach === 'some') spec.subjects = subjects.filter(() => chance(0.3));
    if (reach === 'target') {
      const mod = int(2, 4);
      spec.target = (s) => s.i % mod === 0;
    }
    if (chance(0.25)) spec.locus = pick(['a', 'b']);
    if (chance(0.3)) spec.weight = chance(0.5) ? r() * 1.8 : (s) => 0.5 + 0.5 * Math.sin(s.seed);
    if (chance(0.4)) spec.fade = { in: pick([0, 50, 200]), out: pick([0, 100, 300]) };
    if (chance(0.3)) spec.loop = chance(0.5) ? true : int(1, 3);
    if (chance(0.2)) spec.rate = pick([0.5, 2]);
    if (chance(0.2)) spec.stagger = (s) => s.i * 7;
    if (chance(0.15)) spec.hold = pick(['before', 'after', 'both']);
    if (chance(0.1)) spec.start = t + pick([50, 200]);
    const h = attempt('cue', () => m.cue(spec));
    if (h !== undefined) handles.push(h);
  };

  let t = 0;
  for (let v = int(1, 10); v > 0; v--) cue();
  const out = {};
  const columns = {
    gain: new Float64Array(subjects.length),
    dark: new Float64Array(subjects.length),
    off: new Float64Array(subjects.length),
    pos: new Float64Array(subjects.length * 3),
  };
  const frames = int(20, 80);
  for (let f = 0; f < frames; f++) {
    t += pick([1, 8, 16.7, 16.7, 33, 120]);
    if (chance(0.15)) cue();
    if (chance(0.06) && handles.length > 0) {
      const h = pick(handles);
      attempt('fade', () => h.fade(chance(0.5) ? { over: pick([0, 100]) } : undefined));
    }
    if (chance(0.06) && handles.length > 0)
      attempt('fade subject', () =>
        pick(handles).fade({ subject: pick(subjects), over: pick([0, 80]) }),
      );
    if (chance(0.05) && handles.length > 0) pick(handles).weight = r() * 1.8;
    if (chance(0.03) && handles.length > 0) pick(handles).rate = pick([0.5, 1, 3]);
    if (chance(0.03) && handles.length > 0) attempt('seek', () => pick(handles).seek(r() * 500));
    if (chance(0.04)) attempt('drop', () => m.drop(pick(subjects)));
    if (chance(0.08) && motions.length > 0) {
      const mo = pick(motions);
      const s = pick(subjects);
      if (mo.kind !== 'glide') attempt('to', () => mo.p.to(s, mo.v(s, r() * 6)));
      else attempt('push', () => mo.p.push(s, mo.v(s, r() * 3)));
    }
    if (chance(0.01)) attempt('mute', () => m.mute({ over: 100 }));
    attempt('sync', () => m.sync(t));

    const how = pick(['probe', 'probe', 'out', 'pull', 'pull', 'project']);
    const order = chance(0.3) ? subjects.filter(() => chance(0.6)) : subjects;
    if (how === 'pull') {
      attempt('pull', () => m.pull(order, columns));
      note(`f${f} pull`, [...columns.gain, ...columns.dark, ...columns.off, ...columns.pos]);
    } else if (how === 'project') {
      const p = attempt('project', () => m.project(t + pick([-200, -20, 0, 40, 300])));
      if (p !== undefined) for (const s of order) note(`f${f} proj ${s.i}`, p.probe(s));
    } else
      for (const s of order) {
        const pose = attempt('probe', () => (how === 'out' ? m.probe(s, out) : m.probe(s)));
        note(`f${f} ${s.i}`, pose);
      }
    if (chance(0.2))
      note(
        `f${f} rest`,
        subjects.map((s) => m.atRest(s)),
      );
    if (chance(0.2) && handles.length > 0) {
      const h = pick(handles);
      note(
        `f${f} weightOf`,
        subjects.map((s) => h.weightOf(s)),
      );
    }
    note(`f${f} state`, [m.live, m.inert, ...handles.map((h) => h.state)]);
  }
  return trace;
}

let bad = 0;
for (let seed = first; seed < first + scenes; seed++) {
  const a = run(A, seed, process.env.SAME_LANES === 'off');
  const b = run(B, seed);
  const n = Math.max(a.length, b.length);
  let at = -1;
  for (let i = 0; i < n; i++)
    if (a[i] !== b[i]) {
      at = i;
      break;
    }
  if (at >= 0) {
    bad++;
    console.log(`seed ${seed}: differs at line ${at}\n  a: ${a[at]}\n  b: ${b[at]}`);
  }
  if ((seed - first + 1) % 50 === 0) console.log(`${seed - first + 1}/${scenes}  ${bad} differ`);
}
console.log(bad === 0 ? `same: ${scenes} scenes` : `${bad} of ${scenes} scenes differ`);
process.exit(bad === 0 ? 0 : 1);
