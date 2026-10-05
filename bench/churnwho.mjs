// What steady churn leaves alive: N one-subject tween voices in weasel's turnover shape, each
// frame one retired (its subject dropped) and one cued on a fresh subject, until every voice has
// been replaced once. Reports, per churned voice, the bytes allocated during the churn beyond what
// the same frames allocate without it, and the objects made during the churn that are still alive
// after it, by class and the edge that holds them.
//   node --expose-gc bench/churnwho.mjs [N]
// SHARED=1 cues every voice on one shared tween patch, retargeted per subject with `patch.to`, so
// the host makes no patch per voice.
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getHeapStatistics, writeHeapSnapshot } from 'node:v8';
import { kit, mix, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 5000);
const TOP = Number(process.env.TOP ?? 30);
const SHARED = process.env.SHARED === '1';
const smooth = (u) => u * u * (3 - 2 * u);
const LONG = 1e9;

const m = mix(kit({ position: vec(3, sum()) }));
const shared = SHARED
  ? tween('position', { from: [0, 0, 0], to: [0, 0, 0], ms: LONG, ease: smooth })
  : null;
const cueOn = (id) => {
  const glide =
    shared ?? tween('position', { from: [id, 0, 0], to: [id, 0, 0], ms: LONG, ease: smooth });
  const h = m.cue({ patch: glide, subjects: [id] });
  glide.to(id, [id, 1, 0], 0);
  return h;
};
let probed = Array.from({ length: N }, (_, j) => j);
const handles = probed.map(cueOn);
const columns = { position: new Float64Array(N * 3) };
let t = 0;
let turn = 0;
const frame = (churn) => {
  t += 16.7;
  if (churn) {
    const k = (turn++ * 7919) % N;
    handles[k].fade({ over: 0 });
    m.drop(probed[k]);
    const fresh = N + turn;
    probed = probed.slice();
    probed[k] = probed[N - 1];
    handles[k] = handles[N - 1];
    probed[N - 1] = fresh;
    handles[N - 1] = cueOn(fresh);
  }
  m.sync(t);
  m.pull(probed, columns);
};
// Warm, and churn once through so the pools (if any) and the lanes' tables are at size.
for (let f = 0; f < 60; f++) frame(false);
for (let f = 0; f < N; f++) frame(true);

const allocated = () => getHeapStatistics().total_allocated_bytes;
let a0 = allocated();
for (let f = 0; f < N; f++) frame(false);
const steady = allocated() - a0;

function snapshot() {
  globalThis.gc();
  const file = join(tmpdir(), `blits-churnwho-${process.pid}-${Date.now()}.heapsnapshot`);
  writeHeapSnapshot(file);
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  rmSync(file);
  return snap;
}
const maxId = (snap) => {
  const f = snap.snapshot.meta.node_fields;
  const iId = f.indexOf('id');
  let most = 0;
  for (let i = iId; i < snap.nodes.length; i += f.length) most = Math.max(most, snap.nodes[i]);
  return most;
};
await new Promise((r) => setTimeout(r, 0));
const floor = maxId(snapshot());

a0 = allocated();
for (let f = 0; f < N; f++) frame(true);
const churned = allocated() - a0;
for (let f = 0; f < 30; f++) frame(false);
await new Promise((r) => setTimeout(r, 0));

const snap = snapshot();
const { node_fields: nf, edge_fields: ef, node_types: nt, edge_types: et } = snap.snapshot.meta;
const W = nf.length;
const EW = ef.length;
const [iType, iName, iId, iSize, iEdges] = ['type', 'name', 'id', 'self_size', 'edge_count'].map(
  (k) => nf.indexOf(k),
);
const [eType, eName, eTo] = ['type', 'name_or_index', 'to_node'].map((k) => ef.indexOf(k));
const types = nt[0];
const etypes = et[0];
const { nodes, edges, strings } = snap;
const label = (i) => {
  const type = types[nodes[i + iType]];
  const name = strings[nodes[i + iName]];
  if (type === 'object' || type === 'closure') return type === 'closure' ? `closure ${name}` : name;
  return `(${type}) ${String(name).slice(0, 30)}`;
};
const holder = new Map();
for (let i = 0, e = 0; i < nodes.length; i += W) {
  for (let k = 0; k < nodes[i + iEdges]; k++, e += EW) {
    const kind = etypes[edges[e + eType]];
    if (kind === 'weak' || kind === 'shortcut') continue;
    const to = edges[e + eTo];
    if (nodes[to + iId] <= floor || holder.has(to)) continue;
    const edge =
      kind === 'element' || kind === 'hidden' ? `[${kind}]` : String(strings[edges[e + eName]]);
    holder.set(to, `${label(i)}.${edge}`);
  }
}
const rows = new Map();
let total = 0;
for (let i = 0; i < nodes.length; i += W) {
  if (nodes[i + iId] <= floor) continue;
  const key = `${label(i).padEnd(30)} ← ${holder.get(i) ?? '(root)'}`;
  const r = rows.get(key) ?? { bytes: 0, n: 0 };
  r.bytes += nodes[i + iSize];
  r.n++;
  rows.set(key, r);
  total += nodes[i + iSize];
}
console.log(
  `${SHARED ? 'shared patch' : 'patch per voice'} N=${N}: allocated ${((churned - steady) / N).toFixed(0)} B per churned voice beyond steady frames (${(steady / N).toFixed(0)} B a frame steady); ${(total / N).toFixed(0)} B per churned voice still alive`,
);
for (const [key, r] of [...rows].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, TOP))
  console.log(
    `${(r.bytes / N).toFixed(0).padStart(6)} B  ${(r.n / N).toFixed(2).padStart(6)}×  ${key.slice(0, 110)}`,
  );
