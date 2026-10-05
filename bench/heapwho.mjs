// What holds each voice's bytes: for objects a mix of N one-subject voices made, self bytes per
// voice grouped by class and by the retainer class and edge that keeps them, worst first.
//   node --expose-gc bench/heapwho.mjs [N] [form]   form: weasel (default) tweens
// `weasel` is weasel's codec: numeric ids, one `vec(1)` channel, a tween cued resting at its start
// and retargeted at time 0.
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHeapSnapshot } from 'node:v8';
import { kit, mix, sum, tween, vec } from '../dist/index.js';

const N = Number(process.argv[2] ?? 5000);
const form = process.argv[3] ?? 'weasel';
const TOP = Number(process.env.TOP ?? 30);

function snapshot() {
  globalThis.gc();
  const file = join(tmpdir(), `blits-heapwho-${process.pid}-${Date.now()}.heapsnapshot`);
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

const m = mix(kit({ v: vec(1, sum()) }));
const ease = (u) => 1 - (1 - u) ** 3;
const ids = Array.from({ length: N }, (_, j) => (form === 'weasel' ? j : { seed: j }));
for (const id of ids) {
  if (form === 'weasel') {
    const glide = tween('v', { from: [0], to: [0], ms: 1e9, ease });
    m.cue({ patch: glide, subjects: [id] });
    glide.to(id, [1], 0);
  } else m.cue({ patch: tween('v', { from: [0], to: [1], ms: 1e9, ease }), subjects: [id] });
}
const out = { v: new Float64Array(N) };
for (let f = 1; f <= 3; f++) {
  m.sync(16 * f);
  m.pull(ids, out);
}
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

// The first strong retainer of each new node: which class, through which edge.
const holder = new Map();
const holderNode = new Map();
for (let i = 0, e = 0; i < nodes.length; i += W) {
  for (let k = 0; k < nodes[i + iEdges]; k++, e += EW) {
    const kind = etypes[edges[e + eType]];
    if (kind === 'weak' || kind === 'shortcut') continue;
    const to = edges[e + eTo];
    if (nodes[to + iId] <= floor || holder.has(to)) continue;
    const edge =
      kind === 'element' || kind === 'hidden' ? `[${kind}]` : String(strings[edges[e + eName]]);
    holder.set(to, `${label(i)}.${edge}`);
    holderNode.set(to, i);
  }
}

const rows = new Map();
let total = 0;
for (let i = 0; i < nodes.length; i += W) {
  if (nodes[i + iId] <= floor) continue;
  // DEPTH=n follows the holders n levels up: which object's array an element store backs.
  let via = holder.get(i) ?? '(root)';
  for (
    let d = 1, up = holderNode.get(i);
    d < Number(process.env.DEPTH ?? 1) && up !== undefined;
    d++
  ) {
    via += ` ← ${holder.get(up) ?? '(root)'}`;
    up = holderNode.get(up);
  }
  const key = `${label(i).padEnd(34)} ← ${via}`;
  const r = rows.get(key) ?? { bytes: 0, n: 0 };
  r.bytes += nodes[i + iSize];
  r.n++;
  rows.set(key, r);
  total += nodes[i + iSize];
}
console.log(`${form} N=${N}: ${(total / N).toFixed(0)} B per voice, all new objects`);
for (const [key, r] of [...rows].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, TOP))
  console.log(
    `${(r.bytes / N).toFixed(0).padStart(6)} B  ${(r.n / N).toFixed(2).padStart(6)}×  ${key.slice(0, 110)}`,
  );
