import { mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { drive, Tone } from '../../../packages/tone/test/audio.js';
import type { Pose, Shell, Sound } from '../src/show.js';

// After the harness, so Tone finds Web Audio as it loads.
const { createSounds } = await import('../src/sound.js');
const { cue, KIT } = await import('../src/show.js');

const SR = 48000;
const DUR = 4600;
/** A small shell bursting at the left, and a big one later at the right. */
const left: Shell = { x: -6, apex: 5, color: [1, 1, 1], stars: 90 };
const right: Shell = { x: 6, apex: 5, color: [1, 1, 1], stars: 200 };
const LATER = 2400;

/**
 * The show's two shells through the Tone driver, as `main.ts` plays them, rendered offline. The
 * noise is seeded, so two renders differ only where their shells do.
 */
async function show(late: Shell = right): Promise<{ l: Float32Array; r: Float32Array }> {
  const random = Math.random;
  let seed = 1;
  Math.random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const buffer = await Tone.Offline(
    () => {
      const m = mix<Shell, Pose>(KIT, { name: 'show' });
      const sounds = createSounds();
      let read = 0;
      const sound = drive<Shell, Pose, Sound>(m, {
        clock: () => read / 1000,
        take: (item, time) => {
          if (!('hit' in item)) return undefined;
          const fired = item.subjects?.[0];
          if (fired !== undefined) sounds.play(item.event, fired, time);
          return undefined;
        },
      });
      const launch = (s: Shell) => {
        const whistle = sounds.borrow();
        if (whistle) sound.attach(s, whistle);
        cue(m, s);
      };
      for (let f = 0; f < DUR; f += 1000 / 60) {
        read = f;
        m.sync(f);
        if (f === 0) launch(left);
        if (f >= LATER && f - 1000 / 60 < LATER) launch(late);
        sound.write();
      }
    },
    DUR / 1000,
    2,
    SR,
  ).finally(() => {
    Math.random = random;
  });
  // Copies: node-web-audio-api's arrays read freed memory once their AudioBuffer is collected.
  return { l: buffer.getChannelData(0).slice(), r: buffer.getChannelData(1).slice() };
}

/** Root mean square of `x` from `a` to `b` ms. */
function rms(x: Float32Array, a: number, b: number): number {
  let sum = 0;
  const i0 = Math.round((a * SR) / 1000);
  const i1 = Math.round((b * SR) / 1000);
  for (let i = i0; i < i1; i++) sum += (x[i] as number) ** 2;
  return Math.sqrt(sum / (i1 - i0));
}

describe('the fireworks show, rendered', () => {
  it('pans each bang to its shell and sizes it by its stars, whistles centered, never clipping', async () => {
    const { l, r } = await show();
    // Each shell rises for 1.1 s, then bangs.
    const bangL = [rms(l, 1100, 1500), rms(r, 1100, 1500)] as const;
    const bangR = [rms(l, LATER + 1100, LATER + 1500), rms(r, LATER + 1100, LATER + 1500)] as const;
    expect(bangL[0] / bangL[1]).toBeGreaterThan(3);
    expect(bangR[1] / bangR[0]).toBeGreaterThan(3);
    // Rendered after the first, which made Tone's noise buffers, so each of these draws the same noise.
    const big = await show();
    const small = await show({ ...right, stars: left.stars });
    const at = [LATER + 1100, LATER + 1500] as const;
    expect(rms(big.r, ...at)).toBeGreaterThan(rms(small.r, ...at));
    const whistle = [rms(l, 300, 900), rms(r, 300, 900)] as const;
    expect(whistle[0]).toBeGreaterThan(0.01);
    expect(whistle[0] / whistle[1]).toBeCloseTo(1, 2);
    let peak = 0;
    for (let i = 0; i < l.length; i++)
      peak = Math.max(peak, Math.abs(l[i] as number), Math.abs(r[i] as number));
    expect(peak).toBeLessThan(1);
  });
});
