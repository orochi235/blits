// Samples what a bench script allocates, garbage included, and prints the allocating functions
// worst first, with the stacks under the worst few, when the script exits. Preload it:
//   node --import ./bench/allocprof.mjs bench/frame.mjs swap
// TOP (default 25) functions; STACKS (default 6) of them get their callers.
import { Session } from 'node:inspector';

const TOP = Number(process.env.TOP ?? 25);
const STACKS = Number(process.env.STACKS ?? 6);
const session = new Session();
session.connect();
session.post('HeapProfiler.enable');
session.post('HeapProfiler.startSampling', {
  samplingInterval: 1024,
  includeObjectsCollectedByMajorGC: true,
  includeObjectsCollectedByMinorGC: true,
});
process.on('exit', () => {
  session.post('HeapProfiler.stopSampling', (err, res) => {
    if (err) throw err;
    const by = new Map();
    const stacks = new Map();
    let total = 0;
    const walk = (node, stack) => {
      const f = node.callFrame;
      const at = `${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      if (node.selfSize > 0) {
        by.set(at, (by.get(at) ?? 0) + node.selfSize);
        total += node.selfSize;
        const key = `${at}\t${stack.slice(-4).reverse().join(' < ')}`;
        stacks.set(key, (stacks.get(key) ?? 0) + node.selfSize);
      }
      const short = `${f.functionName || '(anon)'}@${f.url.split('/').pop()}:${f.lineNumber + 1}`;
      for (const c of node.children) walk(c, [...stack, short]);
    };
    walk(res.profile.head, []);
    const mb = (b) => (b / 1e6).toFixed(1).padStart(7);
    console.log(`allocated ${mb(total)} MB in all`);
    const worst = [...by].sort((a, b) => b[1] - a[1]).slice(0, TOP);
    for (const [at, b] of worst)
      console.log(`${mb(b)} MB  ${((100 * b) / total).toFixed(1).padStart(5)}%  ${at}`);
    for (const [at] of worst.slice(0, STACKS)) {
      console.log(`under ${at}:`);
      const mine = [...stacks].filter(([k]) => k.startsWith(`${at}\t`));
      for (const [k, b] of mine.sort((a, b) => b[1] - a[1]).slice(0, 4))
        console.log(`  ${mb(b)} MB  ${k.split('\t')[1]}`);
    }
  });
});
