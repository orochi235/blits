import { execFileSync } from 'node:child_process';
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { cpus, hostname, loadavg } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { scenarios } from '@stress/registry';
import type { Finding } from '@stress/scenario';

export interface RunOptions {
  name: string;
  size: number;
  frames: number;
  seed: number;
  /** Directory runs land in; default `apps/stress/runs`. */
  root?: string;
  /** Aggregate this many frames into one record (the soak). */
  window?: number;
  lanes?: boolean;
  quiet?: boolean;
}

const KEEP = 5;
const CAP_BYTES = 50 * 1024 * 1024;
const DEFAULT_ROOT = fileURLToPath(new URL('../runs', import.meta.url));

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** Sorts `xs` in place and returns the `q` quantile. */
function quantile(xs: number[], q: number): number {
  xs.sort((a, b) => a - b);
  return xs[Math.min(xs.length - 1, Math.floor(q * xs.length))] ?? 0;
}

function git(...args: string[]): string | null {
  try {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return null;
  }
}

function prune(root: string, name: string): void {
  const mine = new RegExp(`-${name}-\\d+$`);
  const dirs = readdirSync(root)
    .filter((d) => mine.test(d))
    .map((d) => ({ d, t: statSync(join(root, d)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const { d } of dirs.slice(KEEP - 1)) rmSync(join(root, d), { recursive: true, force: true });
}

function stamp(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  return `${day}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

export async function run(o: RunOptions): Promise<string> {
  const entry = scenarios[o.name];
  if (!entry) throw new Error(`no scenario "${o.name}"; have ${Object.keys(scenarios).join(', ')}`);
  const root = o.root ?? DEFAULT_ROOT;
  mkdirSync(root, { recursive: true });
  prune(root, o.name);
  const started = new Date();
  const dir = join(root, `${stamp(started)}-${o.name}-${o.seed}`);
  mkdirSync(dir, { recursive: true });

  const out = createWriteStream(join(dir, 'frames.jsonl'));
  let bytes = 0;
  let capped = false;
  const write = (rec: unknown) => {
    if (capped) return;
    const line = `${JSON.stringify(rec)}\n`;
    if (bytes + line.length > CAP_BYTES) {
      capped = true;
      if (!o.quiet) console.error('records passed 50 MB; no more written, the run goes on');
      return;
    }
    bytes += line.length;
    out.write(line);
  };

  const lanes = o.lanes ?? true;
  write({
    header: {
      name: o.name,
      size: o.size,
      frames: o.frames,
      seed: o.seed,
      lanes,
      window: o.window ?? null,
      host: hostname(),
      cpus: cpus().length,
      load: loadavg(),
      node: process.version,
      rev: git('rev-parse', 'HEAD')?.trim() ?? null,
      dirty: (git('status', '--porcelain')?.trim().length ?? 0) > 0,
      started: started.toISOString(),
    },
  });

  const s = entry.make({ seed: o.seed, size: o.size, lanes });
  const buf = new Float64Array(s.width);
  const every = Math.min(1000, Math.max(1, Math.round(o.frames * 0.02)));
  const gc = (globalThis as { gc?: () => void }).gc;
  gc?.();

  let steps: number[] = [];
  let reads: number[] = [];
  let from = 0;
  const recent: number[] = [];
  for (let f = 0; f < o.frames; f++) {
    const a = performance.now();
    s.step(f);
    const b = performance.now();
    s.read(buf);
    const c = performance.now();
    // A browser runs promise handlers between frames; so does a run.
    await null;
    const step = b - a;
    const read = c - b;
    if (o.window) {
      steps.push(step);
      reads.push(read);
      if (steps.length === o.window || f === o.frames - 1) {
        write({
          from,
          to: f,
          stepP50: round(quantile(steps, 0.5)),
          stepP99: round(quantile(steps, 0.99)),
          stepMax: round(steps[steps.length - 1] ?? 0),
          readP50: round(quantile(reads, 0.5)),
          readMax: round(reads[reads.length - 1] ?? 0),
          heap: process.memoryUsage().heapUsed,
          ...s.stats(),
        });
        steps = [];
        reads = [];
        from = f + 1;
      }
    } else {
      write({ f, step: round(step), read: round(read) });
    }
    recent.push(step);
    if (recent.length > every) recent.shift();
    if (!o.quiet && (f + 1) % every === 0) {
      const p50 = quantile([...recent], 0.5);
      console.error(`frame ${f + 1}/${o.frames}  step p50 ${p50.toFixed(2)} ms`);
    }
  }

  const findings: Finding[] = s.check();
  writeFileSync(join(dir, 'findings.json'), `${JSON.stringify(findings, null, 2)}\n`);
  if (!o.quiet) {
    for (const x of findings)
      console.error(`${x.kind}${x.at === undefined ? '' : ` @${x.at}`}: ${x.what}`);
  }
  s.close();
  await new Promise<void>((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
    out.end();
  });
  return dir;
}

const num = (v: string | undefined, d: number) => (v === undefined ? d : Number(v));

export async function main(argv: string[]): Promise<number> {
  const [name, ...rest] = argv;
  if (!name || name.startsWith('--')) {
    console.error(
      `usage: stress <name> [--size n] [--frames n] [--seed n] [--window n] [--lanes off] [--root dir]\nscenarios: ${Object.keys(scenarios).join(', ')}`,
    );
    return 2;
  }
  const entry = scenarios[name];
  if (!entry) {
    console.error(`no scenario "${name}"; have ${Object.keys(scenarios).join(', ')}`);
    return 2;
  }
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2)
    flags.set((rest[i] ?? '').replace(/^--/, ''), rest[i + 1] ?? '');
  const dir = await run({
    name,
    size: num(flags.get('size'), entry.size),
    frames: num(flags.get('frames'), entry.frames),
    seed: num(flags.get('seed'), 1),
    window: flags.has('window') ? num(flags.get('window'), 0) : undefined,
    lanes: flags.get('lanes') === 'off' ? false : undefined,
    root: flags.get('root'),
  });
  console.log(dir);
  const found = JSON.parse(
    (await import('node:fs')).readFileSync(join(dir, 'findings.json'), 'utf8'),
  ) as Finding[];
  return found.some((x) => x.kind === 'fail') ? 1 : 0;
}
