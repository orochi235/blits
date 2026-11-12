import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Reads } from '../src/gpu/reads.js';
import { type MixOptions, mix, type VoiceSpec } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Signal } from '../src/types.js';
import type { Voice } from '../src/voice.js';
import { type C, K, type P, wave } from './gpu-fixtures.js';

const FOUR: C[] = [{ x: 0 }, { x: 1 }, { x: 2 }, { x: 3 }];

/**
 * One mix, cued at `at` with a voice whose weight signal notes the `dt` it was handed, read each
 * frame both ways: every subject probed on the CPU, and every subject read by a `Reads`, as the gpu
 * engine's fold reads them. `frame` answers the dt each subject got from each, in `FOUR` order.
 */
function both(opts: MixOptions, spec: Partial<VoiceSpec<C, P>> = {}, at = 0) {
  const m = mix<C, P>(K, opts);
  m.sync(0);
  if (at > 0) m.sync(at);
  let side: 'cpu' | 'gpu' = 'cpu';
  const seen = { cpu: new Map<number, number>(), gpu: new Map<number, number>() };
  const weight: Signal<C> = (c, s) => {
    seen[side].set(c.x, s.dt);
    return 1;
  };
  const h = m.cue({ patch: wave, loop: true, subjects: FOUR, weight, ...spec } as VoiceSpec<C, P>);
  const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
  const answers = new Answers<C>(mixer);
  answers.register(FOUR);
  const voice = mixer.cued.find((v) => v.holding === null) as Voice<C, unknown>;
  const reads = new Reads<C>();
  reads.follow(mixer, () => answers);
  let list = FOUR;
  const frame = (read = true) => {
    seen.cpu.clear();
    seen.gpu.clear();
    if (!read) {
      reads.read(mixer, [], list, answers);
      return null;
    }
    side = 'cpu';
    for (const c of FOUR) m.probe(c);
    side = 'gpu';
    reads.read(mixer, mixer.cued.includes(voice) ? [voice] : [], list, answers);
    return {
      cpu: FOUR.map((c) => seen.cpu.get(c.x) ?? null),
      gpu: FOUR.map((c) => seen.gpu.get(c.x) ?? null),
    };
  };
  /** Registers `next` in place of the subjects registered, as `GpuSide.subjects` does. */
  const relist = (next: C[]) => {
    reads.relist(list, next);
    list = next;
    answers.register(next);
  };
  return { m, h, frame, relist };
}

/** Each frame's dt on both engines, each subject's the same. */
function agree(frames: ({ cpu: (number | null)[]; gpu: (number | null)[] } | null)[]) {
  const shown = frames.filter((f) => f !== null);
  expect(shown.map((f) => f.gpu)).toEqual(shown.map((f) => f.cpu));
}

describe.each([true, false])('a gpu read hands its signal the CPU dt, lanes %s', (lanes) => {
  it('per subject, each counting from its own last read', () => {
    const { m, frame } = both({ lanes }, { stagger: (c: C) => c.x * 20 });
    const frames = [10, 26, 42, 58, 74, 90].map((t) => {
      m.sync(t);
      return frame();
    });
    agree(frames);
    // Staggered, the subjects first show in different frames, so their dts part.
    expect(new Set(frames[2]?.cpu).size).toBeGreaterThan(1);
  });

  it("first counting from a subject's since, where its delay runs out", () => {
    const { m, frame } = both({ lanes }, { stagger: (c: C) => c.x * 20 });
    const frames = [10, 26, 42, 58, 74].map((t) => {
      m.sync(t);
      return frame();
    });
    agree(frames);
    expect(frames.map((f) => f?.cpu)).toEqual([
      [10, null, null, null],
      [16, 6, null, null],
      [16, 16, 2, null],
      [16, 16, 16, null],
      [16, 16, 16, 14],
    ]);
  });

  it("first counting from a voice's start ahead", () => {
    const { m, frame } = both({ lanes }, { start: 40 });
    const frames = [10, 26, 42, 58].map((t) => {
      m.sync(t);
      return frame();
    });
    agree(frames);
    expect(frames[2]?.cpu).toEqual([2, 2, 2, 2]);
  });

  it("first counting from a subject's since after a seek back before it", () => {
    const { m, frame } = both(
      { lanes, history: { ms: 5000, tape } },
      { stagger: (c: C) => c.x * 20 },
    );
    const frames = [10, 26, 42].map((t) => {
      m.sync(t);
      return frame();
    });
    m.seek(15);
    frames.push(frame());
    for (const host of [58, 74]) {
      m.sync(host);
      frames.push(frame());
    }
    agree(frames);
    expect(frames.at(-1)?.cpu).toEqual([16, 16, 7, null]);
  });

  it('from its first read for a subject frozen before its since, across a seek back', () => {
    const { m, frame } = both(
      { lanes, history: { ms: 5000, tape } },
      { stagger: (c: C) => c.x * 20, freeze: 'before' },
    );
    const frames = [10, 26, 42].map((t) => {
      m.sync(t);
      return frame();
    });
    m.seek(15);
    frames.push(frame());
    for (const host of [58, 74]) {
      m.sync(host);
      frames.push(frame());
    }
    agree(frames);
    expect(frames[0]?.cpu).toEqual([10, 0, 0, 0]);
  });

  it('across a frame where the voice was not read', () => {
    const { m, frame } = both({ lanes });
    const frames = [16, 32, 48, 64].map((t) => {
      m.sync(t);
      return frame(t !== 32);
    });
    agree(frames);
    expect(frames[2]?.cpu[0]).toBe(32);
  });

  it('across a touch and a voice seek, which keep its last read', () => {
    const { m, h, frame } = both({ lanes });
    m.sync(16);
    const frames = [frame()];
    m.sync(32);
    m.touch();
    frames.push(frame());
    m.sync(48);
    h.seek(500);
    frames.push(frame());
    agree(frames);
    expect(frames[2]?.cpu[0]).toBe(16);
  });

  it.each([
    ['staggered', { stagger: (c: C) => c.x * 20 }],
    ['not staggered', {}],
  ])('across its subjects registered again in another order, %s', (_, spec) => {
    const { m, frame, relist } = both({ lanes }, spec);
    m.sync(16);
    const frames = [frame()];
    relist([...FOUR].reverse());
    for (const t of [32, 48]) {
      m.sync(t);
      frames.push(frame());
    }
    agree(frames);
  });

  it('across a mix seek back and forward', () => {
    const { m, frame } = both({ lanes, history: { ms: 5000, tape } });
    const frames = [16, 32, 48, 64].map((t) => {
      m.sync(t);
      return frame();
    });
    // The host's clock runs on: each sync after a seek plays on from where it landed.
    let host = 64;
    for (const to of [40, 20, 56, 8, 200]) {
      m.seek(to);
      frames.push(frame());
      host += 16;
      m.sync(host);
      frames.push(frame());
    }
    agree(frames);
  });

  it('across a seek back to before its cue', () => {
    const { m, frame } = both({ lanes, history: { ms: 5000, tape } }, {}, 20);
    const frames = [36, 52].map((t) => {
      m.sync(t);
      return frame();
    });
    m.seek(10);
    frames.push(frame());
    for (const host of [100, 116]) {
      m.sync(host);
      frames.push(frame());
    }
    agree(frames);
  });
});
