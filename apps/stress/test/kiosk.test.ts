import { scenarios } from '@stress/registry';
import { expect, test } from 'vitest';

test('three simulated minutes with a nap show no drift, no growth, and a return to rest', () => {
  const entry = scenarios.kiosk;
  if (!entry) throw new Error('kiosk');
  const s = entry.make({ seed: 1, size: 0.05 });
  const buf = new Float64Array(s.width);
  const frames = entry.framesFor?.(0.05) ?? 0;
  expect(frames).toBe(10_800);
  for (let f = 0; f < frames; f++) {
    s.step(f);
    s.read(buf);
  }
  expect(s.check().filter((x) => x.kind === 'fail')).toEqual([]);
  expect(s.stats().live).toBe(0);
  s.close();
}, 60_000);
