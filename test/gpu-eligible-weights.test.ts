import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import type { Eligibility } from '../src/gpu/eligible.js';
import { mixerOf } from '../src/gpu/engine.js';
import { Reads } from '../src/gpu/reads.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { SENDS, setReads } from '../src/gpu/weight.js';
import { level, type Mix, mix, slew } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
import type { Voice } from '../src/voice.js';
import { type C, cells, elig, K, type P, wave } from './gpu-fixtures.js';

/** Asserts `e` keeps `y` on the CPU for this one reason. */
function keeps(e: Eligibility<C, P>, why: string): void {
  expect(e.reasons.map((r) => r.why)).toEqual([why]);
  expect(e.channels.has('y')).toBe(false);
}

/** An input signal that `touch` never reports, as a host's hand-made one is. */
const unheard = () => Object.assign(() => 0.5, { input: true });

const recording = () => mix<C, P>(K, { history: { ms: 1e4, tape: createHistory, inputs: true } });

/** The mix's voices that are not owners. */
const held = (m: Mix<C, P>) => mixerOf(m).cued.filter((v) => v.holding === null);

describe('gpu eligibility of owners and weight signals', () => {
  it('folds a voice an owner holds, and gives the owner no reason', () => {
    const m = mix<C, P>(K);
    const owner = m.owns({});
    m.cue({ patch: wave, subjects: cells, owner, loop: true });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(true);
    expect(e.reasons).toEqual([]);
    expect(e.voices).toEqual(held(m));
    expect(e.voices.length).toBe(1);
  });

  it('folds nested owners with number and level weights', () => {
    const m = mix<C, P>(K);
    const program = m.owns({ weight: 0.5 });
    const scene = m.owns({ owner: program, weight: level(0.2), start: 100 });
    m.cue({ patch: wave, subjects: cells, owner: scene, loop: true });
    m.sync(0);
    m.sync(200);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(true);
    expect(e.reasons).toEqual([]);
    expect(e.voices).toEqual(held(m));
  });

  it('folds a voice weighted by a level', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: level(0.5) });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it('keeps a blend member on the CPU', () => {
    const m = mix<C, P>(K);
    m.blend([wave], level(0.5), { subjects: cells });
    m.sync(0);
    keeps(elig(m), 'it is a member of a blend, whose signal the CPU reads once for every member');
  });

  it("keeps a voice weighted by an input the mix's history records on the CPU", () => {
    const m = recording();
    m.cue({ patch: wave, subjects: cells, weight: level(0.5) });
    m.sync(0);
    keeps(
      elig(m),
      "its weight signal is an input the mix's history records, which a seek plays back",
    );
  });

  it('keeps a voice weighted by an input that does not report its changes on the CPU', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: unheard() });
    m.sync(0);
    keeps(elig(m), 'its weight signal reads an input that does not report its changes');
  });

  it('keeps a voice whose weight signal keeps state for each subject on the CPU', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: slew((c: C) => c.x, { riseMs: 100 }) });
    m.sync(0);
    m.probe(cells[0] as C);
    const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
    const answers = new Answers<C>(mixer);
    answers.register(cells);
    const reads = new Reads<C>();
    expect(reads.read(mixer, held(m) as Voice<C, unknown>[], cells, answers)).toBe(false);
    keeps(
      elig(m, cells, reads.refused),
      "its weight signal keeps state for each subject, which only the CPU's records hold",
    );
  });

  it('gives a voice weighted per subject whose patch keeps state the reason a number weight gets', () => {
    const keeper = shaderPatch<C, P>(1000, {
      wgsl: 'out.y = phase;',
      at: (phase, _c, setting) => {
        setting.keep(keeper, () => ({}));
        return { y: phase };
      },
      writes: ['y'],
    });
    const reasons = (weight: number | ((c: C) => number)) => {
      const m = mix<C, P>(K);
      m.cue({ patch: keeper, subjects: cells, weight, loop: true });
      m.sync(0);
      m.probe(cells[0] as C);
      expect((held(m)[0] as Voice<C, P>).keeping).toBe(true);
      return elig(m).reasons.map((r) => r.why);
    };
    expect(reasons((c: C) => c.x + 0.5)).toEqual(reasons(0.5));
    expect(reasons((c: C) => c.x + 0.5)).toEqual([]);
  });

  it('keeps a voice an owner weighs by a per-subject signal on the CPU', () => {
    const m = mix<C, P>(K);
    const owner = m.owns({ weight: (c: C) => c.x });
    m.cue({ patch: wave, subjects: cells, owner });
    m.sync(0);
    keeps(elig(m), 'an owner above it weighs it by a signal read per subject');
  });

  it("keeps a voice whose owner is weighted by an input the mix's history records on the CPU", () => {
    const m = recording();
    const owner = m.owns({ weight: level(0.5) });
    m.cue({ patch: wave, subjects: cells, owner });
    m.sync(0);
    keeps(
      elig(m),
      "an owner above it is weighted by an input the mix's history records, which a seek plays back",
    );
  });

  it('keeps a voice whose owner is weighted by an input that does not report its changes on the CPU', () => {
    const m = mix<C, P>(K);
    const owner = m.owns({ weight: unheard() });
    m.cue({ patch: wave, subjects: cells, owner });
    m.sync(0);
    keeps(elig(m), 'an owner above it is weighted by an input that does not report its changes');
  });

  it('folds a voice weighted per subject', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: (c: C) => c.x });
    m.sync(0);
    const e = elig(m);
    expect(e.channels.has('y')).toBe(true);
    expect(e.reasons).toEqual([]);
  });

  it('keeps a voice whose signal a read refused on the CPU', () => {
    const m = mix<C, P>(K);
    const signal = (c: C) => c.x;
    m.cue({ patch: wave, subjects: cells, weight: signal });
    m.sync(0);
    const refused = new WeakMap<object, string>([[signal, SENDS]]);
    keeps(
      elig(m, cells, refused),
      'its weight signal sends events, which only a probe on the CPU delivers',
    );
  });

  it('keeps a voice weighted per subject on the CPU while reads are off', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: (c: C) => c.x });
    m.sync(0);
    setReads(false);
    try {
      keeps(
        elig(m),
        'its weight signal is read per subject, which costs more on the GPU than folding it on the CPU',
      );
    } finally {
      setReads(true);
    }
  });
});
