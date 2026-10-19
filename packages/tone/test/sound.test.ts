import { kit, type Mix, mix, patch, sum } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { channels, drive, Tone } from './audio.js';

type Pose = { detune: number; volume: number; gain: number };

const K = kit<Pose>(channels);

/** A voice that holds these channels at a constant value. */
const hold = (d: Partial<Pose>) =>
  patch<unknown, Pose>(0, () => d, { writes: Object.keys(d) as (keyof Pose)[] });

/**
 * Runs `body` inside an offline context, handing it a mix, a driver on a clock it sets, and `play`,
 * which syncs and writes every 16 ms from `from` to `to` ms. What `body` returns comes back.
 */
async function offline<T>(
  body: (
    m: Mix<unknown, Pose>,
    d: ReturnType<typeof drive<unknown, Pose>>,
    play: (from: number, to: number) => void,
  ) => T,
  kitted = true,
): Promise<T> {
  let out: T | undefined;
  await Tone.Offline(
    () => {
      const m = mix<unknown, Pose>(K);
      let read = 0;
      const d = drive<unknown, Pose>(m, { clock: () => read / 1000, kit: kitted ? K : undefined });
      const play = (from: number, to: number) => {
        for (let f = from; f <= to; f += 16) {
          read = f;
          m.sync(f);
          d.write();
        }
      };
      out = body(m, d, play);
    },
    0.5,
    1,
    48000,
  );
  return out as T;
}

describe('wire', () => {
  it("holds a wired node's parameters at their base with nothing cued", async () => {
    const [detune, volume] = await offline((_m, d, play) => {
      const s = d.wire(new Tone.Oscillator({ detune: 50, volume: -6 }));
      play(0, 160);
      return [s.node.detune.getValueAtTime(0.15), s.node.volume.getValueAtTime(0.15)];
    });
    expect(detune).toBeCloseTo(50, 6);
    expect(volume).toBeCloseTo(-6, 6);
  });

  it('moves detune and volume from the base', async () => {
    const [detune, volume] = await offline((_m, d, play) => {
      const s = d.wire(new Tone.Oscillator({ detune: 50, volume: -6 }));
      s.cue({ patch: hold({ detune: 100, volume: -3 }) });
      play(0, 160);
      return [s.node.detune.getValueAtTime(0.15), s.node.volume.getValueAtTime(0.15)];
    });
    expect(detune).toBeCloseTo(150, 6);
    expect(volume).toBeCloseTo(-9, 6);
  });

  it('scales gain from the base', async () => {
    const gain = await offline((_m, d, play) => {
      const s = d.wire(new Tone.Gain(0.5));
      s.cue({ patch: hold({ gain: 0.5 }) });
      play(0, 160);
      return s.node.gain.getValueAtTime(0.15);
    });
    expect(gain).toBeCloseTo(0.25, 6);
  });

  it("leaves a note's frequency alone", async () => {
    const freq = await offline((_m, d, play) => {
      const s = d.wire(new Tone.Synth());
      s.node.triggerAttack('A4', 0.1);
      play(0, 300);
      return s.node.frequency.getValueAtTime(0.2);
    });
    expect(freq).toBeCloseTo(440, 3);
  });

  it('puts the base back on drop', async () => {
    const [during, after] = await offline((_m, d, play) => {
      const s = d.wire(new Tone.Oscillator({ detune: 50 }));
      s.cue({ patch: hold({ detune: 100 }) });
      play(0, 96);
      const during = s.node.detune.getValueAtTime(0.09);
      s.drop();
      play(112, 300);
      return [during, s.node.detune.getValueAtTime(0.25)];
    });
    expect(during).toBeCloseTo(150, 6);
    expect(after).toBeCloseTo(50, 6);
  });

  it('drives nothing the kit has no channel for', async () => {
    let detune = Number.NaN;
    await Tone.Offline(
      () => {
        const other = kit<{ other: number }>({ other: sum() });
        const m = mix<unknown, { other: number }>(other);
        const d = drive<unknown, { other: number }>(m, { clock: () => 0, kit: other });
        const s = d.wire(new Tone.Oscillator({ detune: 50 }));
        m.sync(0);
        d.write();
        detune = s.node.detune.getValueAtTime(0.1);
      },
      0.2,
      1,
      48000,
    );
    expect(detune).toBeCloseTo(50, 6);
  });

  it('refuses a driver with no kit, a node wired already, and something not a Tone node', async () => {
    await offline((_m, d) => {
      expect(() => d.wire(new Tone.Oscillator())).toThrow(/needs a kit/);
    }, false);
    await offline((_m, d) => {
      const o = new Tone.Oscillator();
      d.wire(o);
      expect(() => d.wire(o)).toThrow(/already wired/);
      expect(() => d.wire({} as never)).toThrow(/not a Tone node/);
    });
  });

  it('refuses a cue naming its own subjects, and a cue after drop', async () => {
    await offline((_m, d) => {
      const s = d.wire(new Tone.Oscillator());
      expect(() => s.cue({ patch: hold({ detune: 1 }), subjects: ['x'] } as never)).toThrow(
        /names its own subject/,
      );
      s.drop();
      expect(() => s.cue({ patch: hold({ detune: 1 }) })).toThrow(/dropped/);
    });
  });

  it('wires the node again once its sound is dropped', async () => {
    await offline((_m, d) => {
      const o = new Tone.Oscillator();
      d.wire(o).drop();
      expect(() => d.wire(o)).not.toThrow();
    });
  });
});

describe('shortcuts and copy', () => {
  it('makes each shortcut class, wired', async () => {
    await offline((_m, d) => {
      expect(d.synth({ oscillator: { type: 'sawtooth' } }).node).toBeInstanceOf(Tone.Synth);
      expect(d.polySynth().node).toBeInstanceOf(Tone.PolySynth);
      expect(d.oscillator({ frequency: 220 }).node).toBeInstanceOf(Tone.Oscillator);
      expect(d.noise({ type: 'pink' }).node).toBeInstanceOf(Tone.Noise);
    });
  });

  it('copies each shortcut class with equal settings', async () => {
    await offline((_m, d) => {
      for (const s of [
        d.synth({ oscillator: { type: 'sawtooth' }, envelope: { attack: 0.3 } }),
        d.polySynth(),
        d.oscillator({ frequency: 220, detune: 30, type: 'square' }),
        d.noise({ type: 'pink', volume: -12 }),
      ]) {
        const c = s.copy();
        expect(c.node).not.toBe(s.node);
        expect(c.node.get()).toEqual(s.node.get());
      }
    });
  });

  it('gives a copy no voices and no link to the original', async () => {
    const [original, copy] = await offline((_m, d, play) => {
      const s = d.oscillator({ detune: 50 });
      const c = s.copy();
      s.cue({ patch: hold({ detune: 100 }) });
      s.node.set({ type: 'square' });
      play(0, 160);
      expect(c.node.type).toBe('sine');
      return [s.node.detune.getValueAtTime(0.15), c.node.detune.getValueAtTime(0.15)];
    });
    expect(original).toBeCloseTo(150, 6);
    expect(copy).toBeCloseTo(50, 6);
  });
});
