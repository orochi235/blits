// The gone index's churn at scale: a voice naming N object subjects is filed, then let go, then a
// new one filed over the same subjects, as a tape trimmed under `history` does a scene at a time.
// Times each unfile and refile, with the emptied entries deleted (as before 2026-11-11) and kept
// pointed at the shared empty list. Needs `npx tsc -b` first.
//   N=1000000 ROUNDS=8 node bench/gone-churn.mjs      one JSON line per pass to $OUT
import { appendFileSync } from 'node:fs';
import { file, unfile } from '../dist/named.js';
import { Store } from '../dist/store.js';

const N = Number(process.env.N ?? 1_000_000);
const ROUNDS = Number(process.env.ROUNDS ?? 8);
const OUT = process.env.OUT ?? 'gone-churn.jsonl';
const subjects = Array.from({ length: N }, (_, i) => ({ i }));

function unfileDeleting(index, list, voice) {
  for (const s of list) {
    const l = index.get(s);
    if (l === undefined) continue;
    const i = l.indexOf(voice);
    if (i < 0) continue;
    for (let k = i + 1; k < l.length; k++) l[k - 1] = l[k];
    l.pop();
    if (l.length === 0) index.delete(s);
  }
}
const ways = { delete: unfileDeleting, kept: unfile };
for (let r = 1; r <= ROUNDS; r++)
  for (const [way, off] of Object.entries(ways)) {
    const index = new Store();
    const times = [];
    for (let k = 0; k < 4; k++) {
      const voice = { k };
      let a = performance.now();
      file(index, subjects, voice);
      const fileMs = performance.now() - a;
      a = performance.now();
      off(index, subjects, voice);
      times.push({ file: fileMs, unfile: performance.now() - a });
    }
    appendFileSync(OUT, `${JSON.stringify({ round: r, way, n: N, times })}\n`);
    const f = times.map((t) => t.file.toFixed(1)).join(' ');
    const u = times.map((t) => t.unfile.toFixed(1)).join(' ');
    console.log(`${r}/${ROUNDS} ${way.padEnd(6)} file ${f}   unfile ${u} ms`);
  }
