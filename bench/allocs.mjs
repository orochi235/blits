// Runs rows of bench/frame.mjs under V8's sampling heap profiler, garbage included, and prints the
// functions that allocated the most, worst first, with the line each begins at. Sampled, so a share
// of the whole and not a byte count: `kB/frame` in the row's own line is the count.
//   node bench/allocs.mjs keys:10000     TOP (default 25) is how many functions to print.
import { Session } from 'node:inspector/promises';

const session = new Session();
session.connect();
await session.post('HeapProfiler.startSampling', {
  samplingInterval: 4096,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
await import('./frame.mjs');
const { profile } = await session.post('HeapProfiler.stopSampling');
const self = new Map();
let total = 0;
const walk = (node) => {
  const f = node.callFrame;
  const key = `${f.functionName || '(anon)'}  ${f.url.split('/').at(-1)}:${f.lineNumber + 1}`;
  self.set(key, (self.get(key) ?? 0) + node.selfSize);
  total += node.selfSize;
  for (const child of node.children) walk(child);
};
walk(profile.head);
const rows = Number(process.env.TOP ?? 25);
for (const [key, bytes] of [...self].sort((a, b) => b[1] - a[1]).slice(0, rows))
  console.log(`${((bytes / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
