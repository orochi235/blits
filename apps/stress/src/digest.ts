import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rec = Record<string, number>;

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

const col = (label: string, v: number) => `${label.padEnd(12)}${v.toFixed(3).padStart(10)}`;

export function digest(dir: string): string {
  const lines = readFileSync(join(dir, 'frames.jsonl'), 'utf8').trim().split('\n');
  const recs = lines.slice(1).map((l) => JSON.parse(l) as Rec);
  const out: string[] = [`${'records'.padEnd(12)}${String(recs.length).padStart(10)}`];
  const first = recs[0];
  if (first && 'f' in first) {
    const step = recs.map((r) => r.step as number);
    const read = recs.map((r) => r.read as number);
    out.push(col('step p50', quantile(step, 0.5)), col('step p90', quantile(step, 0.9)));
    out.push(col('step p99', quantile(step, 0.99)), col('step max', Math.max(...step)));
    out.push(col('read p50', quantile(read, 0.5)), col('read max', Math.max(...read)));
  } else if (first) {
    const med = (k: string) =>
      quantile(
        recs.map((r) => r[k] as number),
        0.5,
      );
    out.push(col('step p50', med('stepP50')), col('step p99', med('stepP99')));
    out.push(col('step max', med('stepMax')), col('read p50', med('readP50')));
    out.push(col('read max', med('readMax')));
    out.push(col('heap first', (first.heap as number) / 1048576));
    out.push(col('heap last', ((recs[recs.length - 1] as Rec).heap as number) / 1048576));
  }
  return out.join('\n');
}
