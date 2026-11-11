// The gone index's churn at scale: four voices naming one list of N object subjects are filed,
// then let go, as a tape trimmed under `history` does a scene. `each` files every voice under
// every subject, as the index did before 2026-11-11 (its emptied entries kept); `filed` is the
// index now, `Filed` with its group slot, whose sweep then takes the dead group off a share a sync.
// Needs `npx tsc -b` first.
//   N=1000000 ROUNDS=8 OUT=<file> node bench/gone-churn.mjs      one JSON line per pass to OUT
import { appendFileSync } from 'node:fs';
import { Filed } from '../dist/filed.js';
import { EMPTIED, emptied } from '../dist/named.js';
import { Store } from '../dist/store.js';

const N = Number(process.env.N ?? 1_000_000);
const ROUNDS = Number(process.env.ROUNDS ?? 8);
const OUT = process.env.OUT ?? 'gone-churn.jsonl';
const subjects = Array.from({ length: N }, (_, i) => ({ i }));
const voices = Array.from({ length: 4 }, (_, k) => ({
  id: k + 1,
  named: { list: subjects },
  group: null,
  goneGroup: null,
}));

function each() {
  const index = new Store();
  const t0 = performance.now();
  for (const v of voices)
    for (const s of subjects) {
      const l = index.get(s);
      if (l === undefined || l === EMPTIED) index.set(s, [v]);
      else l.push(v);
    }
  const t1 = performance.now();
  for (const v of voices)
    for (const s of subjects) {
      const l = index.get(s);
      const i = l.indexOf(v);
      if (i < 0) continue;
      for (let k = i + 1; k < l.length; k++) l[k - 1] = l[k];
      l.pop();
      if (l.length === 0) emptied(index, s);
    }
  return { file: t1 - t0, unfile: performance.now() - t1, syncs: [] };
}

function filed() {
  const index = new Filed('goneGroup');
  const t0 = performance.now();
  for (const v of voices) index.file(v);
  const t1 = performance.now();
  for (const v of voices) index.unfile(v);
  const t2 = performance.now();
  const syncs = [];
  for (let k = 0; k < 2000 && index.dead.length > 0; k++) {
    const a = performance.now();
    index.sweep();
    syncs.push(performance.now() - a);
  }
  return { file: t1 - t0, unfile: t2 - t1, syncs };
}

const ways = { each, filed };
for (let r = 1; r <= ROUNDS; r++)
  for (const [way, run] of Object.entries(ways)) {
    const t = run();
    appendFileSync(OUT, `${JSON.stringify({ round: r, way, n: N, ...t })}\n`);
    const worst = t.syncs.length > 0 ? Math.max(...t.syncs) : 0;
    console.log(
      `${r}/${ROUNDS} ${way.padEnd(5)} file ${t.file.toFixed(1).padStart(7)}  unfile ${t.unfile.toFixed(1).padStart(7)}  sweep ${String(t.syncs.length).padStart(4)} syncs, worst ${worst.toFixed(2)} ms`,
    );
  }
