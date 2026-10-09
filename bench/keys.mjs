// A keys read in weasel's timeline shape: 10k tracks, each one numeric channel over four stops,
// read once a frame at its own phase through `at`. `node bench/keys.mjs`.
import * as blits from '../dist/index.js';

const N = 10_000;
const FRAMES = Number(process.env.FRAMES ?? 3000);
const WARM = 500;
const tracks = Array.from({ length: N }, (_, i) =>
  blits.keys(1000, [
    { at: 0, delta: { x: i } },
    { at: 0.3, delta: { x: i + 40 }, ease: 'ease-out' },
    { at: 0.7, delta: { x: i - 10 } },
    { at: 1, delta: { x: i + 5 } },
  ]),
);
const subject = {};
const rows = {
  at: (p, phase) => p.at(phase, subject, undefined).x,
};
const only = process.argv.slice(2);
const names = (only.length ? only : Object.keys(rows)).filter((n) => rows[n]);
for (const [k, name] of names.entries()) {
  const read = rows[name];
  let sink = 0;
  let total = 0;
  for (let f = 0; f < WARM + FRAMES; f++) {
    const t0 = performance.now();
    for (let i = 0; i < N; i++) sink += read(tracks[i], ((f * 7 + i) % 1000) / 1000);
    if (f >= WARM) total += performance.now() - t0;
  }
  const ms = total / FRAMES;
  console.log(
    ` ${k + 1}/${names.length}  ${name.padEnd(8)} N= ${N}  ${ms.toFixed(3).padStart(8)} ms/frame  sink ${sink % 7}`,
  );
}
