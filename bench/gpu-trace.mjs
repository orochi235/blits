// Where a gpu bench's slow frames went, from a trace the harness wrote with TRACE=1: for each frame
// over `--over` ms (16.7 unless given), its time, the garbage collection on the page's main thread
// inside it, and the events on that thread and the GPU process's main thread that overlap it most.
//   node bench/gpu-trace.mjs <file.trace.json> [--over <ms>]
import { readFileSync } from 'node:fs';

const file = process.argv[2];
const i = process.argv.indexOf('--over');
const over = i < 0 ? 16.7 : Number(process.argv[i + 1]);
const raw = JSON.parse(readFileSync(file, 'utf8'));
const events = raw.traceEvents ?? raw;

const threads = new Map();
for (const e of events)
  if (e.ph === 'M' && e.name === 'thread_name') threads.set(`${e.pid}:${e.tid}`, e.args.name);
const on = (name) => [...threads].filter(([, n]) => n === name).map(([k]) => k);
const marks = events.filter((e) => e.cat === 'blink.user_timing' && /^frame \d+$/.test(e.name));
const renderer = marks[0] ? `${marks[0].pid}:` : '';
const main = on('CrRendererMain').find((k) => k.startsWith(renderer));
const gpuMain = on('CrGpuMain')[0];

/** Complete spans on a thread, from X events and B/E pairs. */
function spans(key) {
  const out = [];
  const open = [];
  for (const e of events) {
    if (`${e.pid}:${e.tid}` !== key) continue;
    if (e.ph === 'X' && e.dur > 0) out.push({ name: e.name, a: e.ts, b: e.ts + e.dur });
    else if (e.ph === 'B') open.push(e);
    else if (e.ph === 'E') {
      const s = open.pop();
      if (s) out.push({ name: s.name, a: s.ts, b: e.ts });
    }
  }
  return out;
}

const frames = [];
const begun = new Map();
for (const m of marks) {
  if (m.ph === 'b') begun.set(`${m.name}:${m.id2?.local ?? m.id}`, m.ts);
  else if (m.ph === 'e') {
    const a = begun.get(`${m.name}:${m.id2?.local ?? m.id}`);
    if (a !== undefined) frames.push({ f: Number(m.name.slice(6)), a, b: m.ts });
  } else if (m.ph === 'X') frames.push({ f: Number(m.name.slice(6)), a: m.ts, b: m.ts + m.dur });
}
frames.sort((x, y) => x.f - y.f);

const isGc = (n) => /GC|Scavenge|MarkCompact|Mark-Compact|Sweep/i.test(n);
const mainSpans = main ? spans(main) : [];
const gpuSpans = gpuMain ? spans(gpuMain) : [];
const overlap = (s, fr) => Math.max(0, Math.min(s.b, fr.b) - Math.max(s.a, fr.a)) / 1000;

/** Total ms inside `fr` covered by the union of `list`. */
function covered(list, fr) {
  const xs = list
    .map((s) => [Math.max(s.a, fr.a), Math.min(s.b, fr.b)])
    .filter(([a, b]) => b > a)
    .sort((p, q) => p[0] - q[0]);
  let total = 0;
  let end = -Infinity;
  for (const [a, b] of xs) {
    if (a > end) total += b - a;
    else if (b > end) total += b - end;
    end = Math.max(end, b);
  }
  return total / 1000;
}

function top(list, fr, k) {
  const by = new Map();
  for (const s of list) {
    const o = overlap(s, fr);
    if (o > 0) by.set(s.name, (by.get(s.name) ?? 0) + o);
  }
  return [...by]
    .sort((p, q) => q[1] - p[1])
    .slice(0, k)
    .map(([n, ms]) => `${n} ${ms.toFixed(1)}`)
    .join('; ');
}

const gcMain = mainSpans.filter((s) => isGc(s.name));
let gcAll = 0;
for (const fr of frames) gcAll += covered(gcMain, fr);
const slow = frames.filter((fr) => (fr.b - fr.a) / 1000 > over);
console.log(
  `${file}: ${frames.length} frames, ${slow.length} over ${over} ms; main-thread GC in frames ${gcAll.toFixed(1)} ms`,
);
for (const fr of slow) {
  console.log(
    `frame ${String(fr.f).padStart(4)}  ${((fr.b - fr.a) / 1000).toFixed(3).padStart(9)} ms  gc ${covered(gcMain, fr).toFixed(3).padStart(8)} ms`,
  );
  console.log(`    main: ${top(mainSpans, fr, 6)}`);
  console.log(`    gpu:  ${top(gpuSpans, fr, 6)}`);
}
