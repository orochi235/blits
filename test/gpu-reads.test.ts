import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Reads } from '../src/gpu/reads.js';
import { KEEPS, SENDS } from '../src/gpu/weight.js';
import { mix, slew, type VoiceSpec } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import { reading } from '../src/reading.js';
import type { Signal } from '../src/types.js';
import type { Voice } from '../src/voice.js';
import { type C, K, type P, wave } from './gpu-fixtures.js';

const FOUR: C[] = [{ x: 0 }, { x: 1 }, { x: 2 }, { x: 3 }];

/**
 * A mix playing one looping voice with `spec`, over `FOUR` named unless it targets, synced to `t`,
 * and a fresh `Reads`.
 */
function made(spec: Partial<VoiceSpec<C, P>>, t: number) {
  const m = mix<C, P>(K);
  m.sync(0);
  const whom = spec.target === undefined ? { subjects: FOUR } : {};
  m.cue({ patch: wave, loop: true, ...whom, ...spec } as VoiceSpec<C, P>);
  m.sync(t);
  const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
  const answers = new Answers<C>(mixer);
  answers.register(FOUR);
  const voice = mixer.cued.find((v) => v.holding === null) as Voice<C, unknown>;
  const reads = new Reads<C>();
  const read = () => reads.read(mixer, [voice], FOUR, answers);
  return { m, mixer, voice, reads, read };
}

const f32 = (xs: number[]) => Array.from(Float32Array.from(xs));

describe('gpu reads', () => {
  it('reads each subject once, by registration order', () => {
    const { voice, reads, read } = made({ weight: (c, s) => c.x + s.elapsed / 1000 }, 250);
    expect(read()).toBe(true);
    expect(Array.from(reads.of(voice) as Float32Array)).toEqual(f32([0.25, 1.25, 2.25, 3.25]));
  });

  it('reads a staggered subject at its own time, and nothing where it does not show', () => {
    const { voice, reads, read } = made(
      { stagger: (c: C) => c.x * 100, weight: (_c, s) => s.elapsed },
      150,
    );
    expect(read()).toBe(true);
    expect(Array.from(reads.of(voice) as Float32Array)).toEqual([150, 50, 0, 0]);
  });

  it('reads nothing for a subject the voice does not reach', () => {
    let calls = 0;
    const { voice, reads, read } = made(
      {
        target: (c: C) => c.x !== 1,
        weight: (c) => {
          calls++;
          return c.x + 1;
        },
      },
      100,
    );
    expect(read()).toBe(true);
    expect(calls).toBe(3);
    expect(Array.from(reads.of(voice) as Float32Array)).toEqual([1, 0, 3, 4]);
  });

  it('stores NaN as 0 and an infinity as the largest f32', () => {
    const { voice, reads, read } = made(
      {
        weight: (c) =>
          [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0.5][c.x] as number,
      },
      100,
    );
    read();
    expect(Array.from(reads.of(voice) as Float32Array)).toEqual([
      0, 3.4028234663852886e38, -3.4028234663852886e38, 0.5,
    ]);
  });

  it('refuses a signal that keeps state, and keeps nothing', () => {
    const signal = slew((c: C) => c.x, { riseMs: 100 });
    const { voice, reads, read } = made({ weight: signal }, 100);
    const kept = reading.kept;
    const met = () => FOUR.map((c) => voice.subjects.has(c));
    const subjects = met();
    const own = voice.ownKept;
    expect(read()).toBe(false);
    expect(reads.refused.get(signal)).toBe(KEEPS);
    expect(reading.kept).toBe(kept);
    expect(met()).toEqual(subjects);
    expect(voice.ownKept).toBe(own);
  });

  it('refuses a signal that sends', () => {
    const signal: Signal<C> = (_c, s) => {
      s.send('x');
      return 1;
    };
    const { m, reads, read } = made({ weight: signal }, 100);
    expect(read()).toBe(false);
    expect(reads.refused.get(signal)).toBe(SENDS);
    expect(m.drain()).toEqual([]);
  });

  it('gives dt as the gap since its last read', () => {
    const { m, voice, reads, read } = made({ weight: (_c, s) => s.dt }, 100);
    read();
    m.sync(116);
    read();
    expect((reads.of(voice) as Float32Array)[0]).toBe(16);
  });

  it("gives every read in one frame that frame's dt, as a probe again in the frame does", () => {
    const { m, voice, reads, read } = made({ weight: (_c, s) => s.dt }, 100);
    const cpu = mix<C, P>(K);
    cpu.sync(0);
    const dts: number[] = [];
    cpu.cue({
      patch: wave,
      loop: true,
      subjects: FOUR,
      weight: (_c, s) => {
        dts.push(s.dt);
        return s.dt;
      },
    });
    cpu.sync(100);
    cpu.probe(FOUR[0] as C);
    read();
    m.sync(116);
    cpu.sync(116);
    read();
    cpu.probe(FOUR[0] as C);
    read();
    cpu.probe(FOUR[0] as C);
    expect((reads.of(voice) as Float32Array)[0]).toBe(16);
    expect(dts.at(-1)).toBe(16);
  });
});
