// Every frame of a gpu bench record over `--over` ms (10 unless given), with its parts, row by row,
// for each `.jsonl` named: where a median hides the frames a scene starts or ends in.
//   node bench/gpu-slow.mjs <file.jsonl>... [--over <ms>]
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const args = process.argv.slice(2);
const i = args.indexOf('--over');
const over = i < 0 ? 10 : Number(args[i + 1]);
const files = i < 0 ? args : args.filter((_, k) => k !== i && k !== i + 1);
const ms = (x) => x.toFixed(3).padStart(9);
for (const file of files)
  for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
    const r = JSON.parse(line);
    const slow = r.frames
      .map((t, k) => [k + r.warm + 1, t, r.parts[k]])
      .filter(([, t]) => t > over);
    const sum = slow.reduce((s, [, t]) => s + t, 0);
    console.log(
      `${basename(file)} ${r.engine} ${r.n}: ${slow.length} frames over ${over} ms, ${sum.toFixed(1)} ms in all`,
    );
    for (const [f, t, p] of slow)
      console.log(`  frame ${String(f).padStart(4)} ${ms(t)}  ${p.map(ms).join(' ')}`);
  }
