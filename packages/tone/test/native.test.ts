import { OfflineAudioContext } from 'node-web-audio-api';
import { describe, expect, it } from 'vitest';
import { drive } from './audio.js';
import { render, worst } from './render.js';
import { DUR, frameTimes, make, reference, SR, SUBJECT, scene } from './scene.js';

/** Where the 150 ms read ahead ran out in the 200 ms stall at 3.2 s, to the frame after it. */
const HELD = [3350, 3420] as const;

describe('a native AudioParam as a target', () => {
  it('plays the mix as closely as a Tone Signal does, with no Tone node in the graph', async () => {
    const context = new OfflineAudioContext(2, (DUR / 1000) * SR, SR);
    const merge = context.createChannelMerger(2);
    merge.connect(context.destination);
    // A constant source's output is its `offset`, so each channel renders one parameter's curve.
    const freq = context.createConstantSource();
    const gain = context.createConstantSource();
    freq.offset.value = 0;
    gain.offset.value = 0;
    freq.connect(merge, 0, 0);
    gain.connect(merge, 0, 1);
    freq.start();
    gain.start();

    const m = make();
    scene(m);
    let read = 0;
    const driver = drive(m, { clock: () => read / 1000 });
    driver.attach(SUBJECT, { freq: freq.offset, gain: gain.offset });
    for (const f of frameTimes()) {
      read = f;
      m.sync(f);
      driver.write(f);
    }

    const buffer = await context.startRendering();
    const tone = await render();
    const ref = reference([], []);
    const native = worst(buffer.getChannelData(0), ref, 'freq', HELD);
    expect(native).toBeLessThan(0.75);
    expect(native).toBeLessThanOrEqual(worst(tone.freq, ref, 'freq', HELD));
    expect(worst(buffer.getChannelData(1), ref, 'gain', HELD)).toBeLessThan(1e-4);
  });
});
