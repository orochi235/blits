import { kit, mix } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, Tone } from './audio.js';

type Pose = { detune: number; volume: number; gain: number };
const K = kit<Pose>(channels);

describe('cancel', () => {
  it('a node wired by a cancelled driver can be wired by the driver that replaces it', async () => {
    let error: unknown;
    await Tone.Offline(
      () => {
        const m = mix<unknown, Pose>(K);
        const node = new Tone.Oscillator();
        const first = drive<unknown, Pose>(m, { kit: K, clock: () => 0 });
        first.wire(node);
        first.cancel();
        // README: "The driver is done after it; drive the mix again to play on."
        const second = drive<unknown, Pose>(m, { kit: K, clock: () => 0 });
        try {
          second.wire(node);
        } catch (e) {
          error = e;
        }
      },
      0.1,
      1,
      48000,
    );
    expect(error).toBeUndefined();
  });
});
