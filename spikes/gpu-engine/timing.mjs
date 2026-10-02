// How every runner in this spike times a row and formats what it prints.
import os from 'node:os';

export const WARM = 30;

export const load = () =>
  os
    .loadavg()
    .map((x) => x.toFixed(2))
    .join(' ');
export const f3 = (x) => x.toFixed(3).padStart(9);
export const ex = (x) => x.toExponential(1).padStart(8);
export const tick = () => new Promise((r) => setTimeout(r, 0));
export const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

/** Median and p95 ms per frame of `step(t)`, 16.7 ms apart; `step` may return a promise. */
export async function time(step, frames) {
  const run = (t) => {
    const r = step(t);
    return r instanceof Promise ? r : undefined;
  };
  let t = 0;
  // A frame after the first, so first-sight setup in the mix is not what decides the warm-up.
  await run((t += 16.7));
  let t0 = performance.now();
  await run((t += 16.7));
  const one = performance.now() - t0;
  const warm = one > 50 ? 3 : WARM;
  const count = one > 20 ? Math.max(10, Math.min(frames, Math.round(4000 / one))) : frames;
  for (let f = 0; f < warm; f++) await run((t += 16.7));
  await tick();
  const ms = [];
  for (let f = 0; f < count; f++) {
    t0 = performance.now();
    const p = run((t += 16.7));
    if (p) await p;
    ms.push(performance.now() - t0);
  }
  await tick();
  return { median: quantile(ms, 0.5), p95: quantile(ms, 0.95), frames: count };
}
