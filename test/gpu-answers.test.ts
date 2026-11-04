import { describe, expect, it } from 'vitest';
import { part, unpart } from '../src/fade.js';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { kit, mix, sum } from '../src/index.js';
import type { Voice } from '../src/voice.js';

interface C {
  i: number;
}
interface P {
  y: number;
}
const K = kit<P>({ y: sum() });
const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;',
  at: (phase) => ({ y: phase }),
  writes: ['y'],
});
const cells = (n: number): C[] => Array.from({ length: n }, (_, i) => ({ i }));

/** A mix at time 0 with one voice cued by `spec`, the voice, and an `Answers` for it. */
function setup(spec: Record<string, unknown>) {
  const m = mix<C, P>(K, { name: 'answers' });
  m.sync(0);
  m.cue({ patch: wave, loop: true, ...spec });
  const mixer = mixerOf(m);
  const voice = mixer.cued[0] as Voice<C, unknown>;
  return { m, voice, answers: new Answers<C>(mixer as never) };
}

const bit = (reach: Uint32Array, i: number) => ((reach[i >>> 5] as number) >>> (i & 31)) & 1;

describe('Answers', () => {
  it('asks stagger once per registered subject, and the CPU takes the answer', () => {
    const n = 6;
    const list = cells(n);
    let calls = 0;
    const { m, voice, answers } = setup({
      stagger: (c: C) => {
        calls++;
        return c.i * 10;
      },
    });
    answers.register(list);
    const a = answers.of(voice);
    expect(calls).toBe(n);
    expect(answers.of(voice)).toBe(a);
    for (const c of list) m.probe(c);
    expect(calls).toBe(n);
    const delays = a.delays as Float64Array;
    list.forEach((c, i) => {
      expect(voice.subjects.get(c)?.delay).toBe(delays[i]);
      expect(delays[i]).toBe(i * 10);
    });
    expect(a.reach).toBeNull();
    expect(a.finite).toBe(true);
  });

  it('asks target once, and stagger only where it reaches', () => {
    const n = 5;
    const list = cells(n);
    let targets = 0;
    let staggers = 0;
    const { m, voice, answers } = setup({
      target: (c: C) => {
        targets++;
        return c.i % 2 === 0;
      },
      stagger: (c: C) => {
        staggers++;
        return c.i * 10;
      },
    });
    answers.register(list);
    const a = answers.of(voice);
    const reach = a.reach as Uint32Array;
    for (let i = 0; i < n; i++) expect(bit(reach, i)).toBe(i % 2 === 0 ? 1 : 0);
    expect(targets).toBe(n);
    expect(staggers).toBe(Math.ceil(n / 2));
    for (const c of list) m.probe(c);
    expect(targets).toBe(n);
    expect(staggers).toBe(Math.ceil(n / 2));
    for (const c of list) expect(voice.subjects.get(c)?.reaches ?? false).toBe(c.i % 2 === 0);
  });

  it("keeps a met subject's answers when the list is registered again", () => {
    const list = cells(6);
    let calls = 0;
    const { m, voice, answers } = setup({
      stagger: (c: C) => {
        calls++;
        return c.i * 10;
      },
    });
    const four = list.slice(0, 4);
    answers.register(four);
    answers.of(voice);
    m.probe(list[1] as C);
    m.probe(list[3] as C);
    const again = [list[5], list[3], list[0], list[4], list[1], list[2]] as C[];
    answers.register(again);
    const a = answers.of(voice);
    expect(calls).toBe(4 + 2);
    const delays = a.delays as Float64Array;
    for (const c of [list[1], list[3]] as C[]) {
      const at = answers.index(c) as number;
      expect(delays[at]).toBe(voice.subjects.get(c)?.delay);
    }
    again.forEach((c, i) => {
      expect(delays[i]).toBe(c.i * 10);
    });
    for (const c of again) m.probe(c);
    expect(calls).toBe(4 + 2);
  });

  it('gives null reach for a voice reaching every subject, and a mask for a named subset', () => {
    const list = cells(4);
    const all = setup({});
    all.answers.register(list);
    const every = all.answers.of(all.voice);
    expect(every.reach).toBeNull();
    expect(every.delays).toBeNull();
    expect(all.voice.asked).toBeNull();

    const some = setup({ subjects: [list[0], list[2]] });
    some.answers.register(list);
    const named = some.answers.of(some.voice);
    expect([...(named.reach as Uint32Array)]).toEqual([0b0101]);
    expect(some.voice.asked).toBeNull();
  });

  it("leaves a never-probed staggered finite voice's end as mixer has it", () => {
    const list = cells(10);
    const spec = { loop: 2, target: () => true, stagger: (c: C) => c.i * 100 };
    const gpu = setup(spec);
    const cpu = setup(spec);
    gpu.answers.register(list);
    const a = gpu.answers.of(gpu.voice);
    expect((a.delays as Float64Array)[9]).toBe(900);
    expect(gpu.voice.latest).toBe(cpu.voice.latest);
    expect(gpu.voice.soonest).toBe(cpu.voice.soonest);
    gpu.m.sync(2500);
    cpu.m.sync(2500);
    expect(gpu.voice.latest).toBe(cpu.voice.latest);
    expect(gpu.voice.state).toBe(cpu.voice.state);
  });

  for (const lanes of [true, false])
    it(`keeps target's answer, not a fade out's, for a subject faded out (lanes ${lanes})`, () => {
      const list = cells(2);
      const s = list[0] as C;
      const steps = (answers: boolean) => {
        const m = mix<C, P>(K, { name: 'parted', lanes });
        m.sync(0);
        m.cue({ patch: wave, loop: true, target: () => true, stagger: (c: C) => c.i });
        const mixer = mixerOf(m);
        const voice = mixer.cued[0] as Voice<C, P>;
        m.probe(s);
        part(mixer, voice, s, 0);
        m.probe(s);
        if (answers) {
          const a = new Answers<C>(mixer as never);
          a.register(list);
          a.of(voice as Voice<C, unknown>);
        }
        unpart(mixer, voice, s);
        m.probe(s);
        return voice.subjects.get(s)?.reaches;
      };
      expect(steps(false)).toBe(true);
      expect(steps(true)).toBe(true);
    });

  it("takes a laned voice's no to a subject it met rather than asking target again", () => {
    const list = cells(6);
    let calls = 0;
    const { m, voice, answers } = setup({
      target: (c: C) => {
        calls++;
        return c.i % 3 === 0;
      },
    });
    for (const c of list) m.probe(c);
    expect(voice.unreachedBits).not.toBeNull();
    expect(calls).toBe(6);
    answers.register(list);
    const reach = answers.of(voice).reach as Uint32Array;
    expect(calls).toBe(6);
    for (let i = 0; i < 6; i++) expect(bit(reach, i)).toBe(i % 3 === 0 ? 1 : 0);
  });

  it('leaves a mix with no gpu side as it was', () => {
    const list = cells(3);
    const { m } = setup({ stagger: (c: C) => c.i, target: () => true });
    m.cue({ patch: wave, subjects: list, stagger: (c: C) => c.i });
    for (const c of list) m.probe(c);
    for (const v of mixerOf(m).cued) expect(v.asked).toBeNull();
  });
});
