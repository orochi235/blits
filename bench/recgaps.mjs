// Reduces bench/recaddr.sh's output: per revision and lane, the commonest gap between successive
// records and how often it occurs (one record apart where they sit contiguous), and how many gaps
// jump more than 4 KB.
//   node bench/recgaps.mjs <recaddr output>
import { readFileSync } from 'node:fs';

const text = readFileSync(process.argv[2], 'utf8');
let rev = '?';
let lane = null;
let prev = null;
const stats = new Map();
for (const line of text.split('\n')) {
  if (line.startsWith('######## ')) rev = line.slice(9).trim();
  else if (line.startsWith('LANE')) {
    lane = `${rev} lane ${line.split(' ')[1]}`;
    prev = null;
    stats.set(lane, { pairs: 0, gaps: new Map(), far: 0 });
  } else if (line.startsWith('DebugPrint: 0x') && lane) {
    const a = BigInt(line.split(' ')[1].replace(':', ''));
    if (prev !== null) {
      const s = stats.get(lane);
      const g = Number(a - prev);
      s.pairs++;
      s.gaps.set(g, (s.gaps.get(g) ?? 0) + 1);
      if (Math.abs(g) > 4096) s.far++;
    }
    prev = a;
  }
}
for (const [k, s] of stats) {
  const [g, c] = [...s.gaps].sort((x, y) => y[1] - x[1])[0] ?? [0, 0];
  console.log(
    `${k.padEnd(22)} pairs ${String(s.pairs).padStart(5)}  modal gap ${String(g).padStart(5)} B x${String(c).padStart(5)}  jumps >4KB ${String(s.far).padStart(5)}`,
  );
}
