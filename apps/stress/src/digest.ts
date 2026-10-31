import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type Rec = Record<string, number>;

function quantile(xs: number[], q: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
}

function most(xs: readonly number[]): number {
  let m = Number.NEGATIVE_INFINITY;
  for (const x of xs) if (x > m) m = x;
  return xs.length === 0 ? 0 : m;
}

const col = (label: string, v: number) => `${label.padEnd(28)}${v.toFixed(3).padStart(10)}`;

export function digest(dir: string): string {
  const lines = readFileSync(join(dir, 'frames.jsonl'), 'utf8').trim().split('\n');
  const all = lines.slice(1).map((l) => JSON.parse(l) as Rec);
  const recs = all.filter((r) => !('capped' in r));
  const out: string[] = [`${'records'.padEnd(28)}${String(recs.length).padStart(10)}`];
  const cap = all.find((r) => 'capped' in r);
  if (cap) out.push(`${'capped at frame'.padEnd(28)}${String(cap.capped).padStart(10)}`);
  const first = recs[0];
  const of = (k: string) => recs.map((r) => r[k] as number);
  if (first && 'f' in first) {
    const step = of('step');
    const read = of('read');
    out.push(col('step p50', quantile(step, 0.5)), col('step p90', quantile(step, 0.9)));
    out.push(col('step p99', quantile(step, 0.99)), col('step max', most(step)));
    out.push(col('read p50', quantile(read, 0.5)), col('read max', most(read)));
  } else if (first) {
    out.push(col('step p50, median of windows', quantile(of('stepP50'), 0.5)));
    out.push(col('step p99, p99 of windows', quantile(of('stepP99'), 0.99)));
    out.push(col('step max, max of windows', most(of('stepMax'))));
    out.push(col('read p50, median of windows', quantile(of('readP50'), 0.5)));
    out.push(col('read max, max of windows', most(of('readMax'))));
    out.push(col('heap first (MB)', (first.heap as number) / 1048576));
    out.push(col('heap last (MB)', ((recs[recs.length - 1] as Rec).heap as number) / 1048576));
  }
  return out.join('\n');
}
