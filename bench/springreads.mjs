// Tables bench/springreads.sh runs: median ms a frame and kB a frame per mode and size.
//   node bench/springreads.mjs <run.txt>...
import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0 || files.includes('-h') || files.includes('--help')) {
  console.log('usage: node bench/springreads.mjs <run.txt>...');
  process.exit(files.length === 0 ? 2 : 0);
}
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
for (const file of files) {
  const rows = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/reads=(\w+).*N=\s*(\d+).*?([\d.]+) ms\/frame.*?([\d.]+) kB\/frame/);
    if (m === null) continue;
    const key = `${m[1].padEnd(7)} ${m[2].padStart(6)}`;
    const row = rows.get(key) ?? { ms: [], kb: [] };
    row.ms.push(Number(m[3]));
    row.kb.push(Number(m[4]));
    rows.set(key, row);
  }
  console.log(file);
  console.log('reads        N   ms/frame   kB/frame  rounds');
  for (const [key, { ms, kb }] of [...rows].sort())
    console.log(
      `${key}  ${median(ms).toFixed(3).padStart(8)}  ${median(kb).toFixed(1).padStart(9)}  ${String(ms.length).padStart(6)}`,
    );
}
