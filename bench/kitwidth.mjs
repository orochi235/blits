// What a probe pass costs as the kit grows by channels no voice writes. Three voices over every
// subject, each writing only `shown`; the kit adds `extra` more channels of `pad`'s kind. One line
// per row as it finishes, and every pass's time as JSON with OUT=<file>.
// Run with `node bench/kitwidth.mjs` after a build; BLITS_LANES=off to take the general path.
import { writeFileSync } from 'node:fs';
import { cpus, hostname, loadavg } from 'node:os';
import * as blits from '../dist/index.js';

const { color, kit, mix, multiply, overlay, patch } = blits;
const N = Number(process.env.N ?? 16128);
const PASSES = Number(process.env.PASSES ?? 40);
const subjects = Array.from({ length: N }, (_, i) => ({ i }));
const v = [0.5, 0.1, 0.1, 1];

const pads = {
  plain: () => color(),
  multiply: () => color(multiply()),
  overlay: () => color(overlay()),
};
const rows = [];
for (const [padName, pad] of Object.entries(pads))
  for (const extra of [0, 9, 25]) rows.push({ shownKind: 'overlay', padName, pad, extra });
for (const extra of [0, 9, 25])
  rows.push({ shownKind: 'multiply', padName: 'overlay', pad: pads.overlay, extra });

const records = [];
// ROW=<n> runs only the nth row, counted from 1, as for a profile.
const only = process.env.ROW ? Number(process.env.ROW) - 1 : -1;
for (let r = 0; r < rows.length; r++) {
  if (only >= 0 && r !== only) continue;
  const { shownKind, padName, pad, extra } = rows[r];
  const channels = { shown: shownKind === 'overlay' ? color(overlay()) : color(multiply()) };
  for (let e = 0; e < extra; e++) channels[`pad${e}`] = pad();
  const m = mix(kit(channels), { name: 'kitwidth' });
  for (let k = 0; k < 3; k++)
    m.cue({
      patch: patch(1000, () => ({ shown: v }), { writes: ['shown'] }),
      subjects,
      loop: true,
    });
  const pose = m.pose();
  const times = [];
  let t = 0;
  for (let p = 0; p < PASSES + 5; p++) {
    t += 16;
    m.sync(t);
    const a = performance.now();
    for (const s of subjects) m.probe(s, pose);
    const ms = performance.now() - a;
    if (p >= 5) times.push(ms);
  }
  const sorted = [...times].sort((x, y) => x - y);
  const p50 = sorted[sorted.length >> 1];
  records.push({ shownKind, pad: padName, extra, n: N, times });
  console.log(
    `${String(r + 1).padStart(2)}/${rows.length}  shown ${shownKind.padEnd(8)} pad ${padName.padEnd(8)} +${String(extra).padStart(2)}  p50 ${p50.toFixed(2).padStart(7)} ms  min ${sorted[0].toFixed(2).padStart(7)} ms`,
  );
  m.close?.();
}
if (process.env.OUT)
  writeFileSync(
    process.env.OUT,
    JSON.stringify({
      host: hostname(),
      cpus: cpus()[0]?.model,
      load: loadavg(),
      lanes: process.env.BLITS_LANES ?? 'on',
      at: new Date().toISOString(),
      records,
    }),
  );
