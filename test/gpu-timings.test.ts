import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { type TimingSlot, Timings } from '../src/gpu/timings.js';
import type { GpuBuffer, GpuDevice } from '../src/gpu/webgpu.js';
import { NONE } from '../src/gpu/wgsl/timing.js';
import { kit, mix, spring, sum } from '../src/index.js';
import type { Mixer } from '../src/mixer.js';
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

/** A device keeping every `writeBuffer` and applying it to `bytes`, as a GPU buffer would. */
function recording(size: number) {
  const bytes = new ArrayBuffer(size * 4);
  const writes: { offset: number; length: number }[] = [];
  const device = {
    queue: {
      writeBuffer(_: GpuBuffer, offset: number, data: ArrayBufferView) {
        writes.push({ offset, length: data.byteLength });
        new Uint8Array(bytes, offset, data.byteLength).set(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
      },
    },
  } as unknown as GpuDevice;
  return {
    device,
    writes,
    f32: new Float32Array(bytes),
    u32: new Uint32Array(bytes),
    buffer: {} as GpuBuffer,
  };
}

/** A mix at time 0 with one voice per spec, its voices, and an `Answers` registered on `list`. */
function setup(list: readonly C[], ...specs: Record<string, unknown>[]) {
  const m = mix<C, P>(K, { name: 'timings' });
  m.sync(0);
  const handles = specs.map((spec) => m.cue({ patch: wave, loop: true, ...spec }));
  const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
  const voices = [...mixerOf(m).cued] as unknown as Voice<C, unknown>[];
  const answers = new Answers<C>(mixer);
  answers.register(list);
  return { m, mixer, voices, handles, answers, timings: new Timings() };
}

const bit = (words: Uint32Array, at: number, i: number) =>
  ((words[at + (i >>> 5)] as number) >>> (i & 31)) & 1;

/** Each subject's `shown` as the CPU's record holds it and as the block has it, less the anchor. */
function origins(
  m: { probe(c: C): unknown },
  voice: Voice<C, unknown>,
  list: readonly C[],
  slot: TimingSlot,
  f32: Float32Array,
) {
  return list.map((c, i) => {
    m.probe(c);
    return {
      cpu: Math.fround((voice.subjects.get(c)?.shown as number) - slot.anchor),
      gpu: f32[slot.shown + i],
    };
  });
}

/** A recording device with every block written. */
function uploaded(timings: Timings) {
  const r = recording(timings.length);
  timings.upload(r.device, r.buffer, true);
  return r;
}

describe('Timings', () => {
  it('lays delays, mask and origins in order, from the offset given', () => {
    const n = 5;
    const list = cells(n);
    const { mixer, voices, answers, timings } = setup(
      list,
      { stagger: (c: C) => c.i * 10, target: (c: C) => c.i !== 2, fade: { in: 300 } },
      {},
      { target: (c: C) => c.i % 2 === 0 },
      { stagger: (c: C) => c.i },
    );
    const from = 7;
    const slots = timings.place(mixer, voices, answers, from);
    const [a, none, b, c] = slots as [TimingSlot, undefined, TimingSlot, TimingSlot];
    expect(none).toBeUndefined();
    expect([a.delays, a.mask, a.shown]).toEqual([from, from + n, from + n + 1]);
    expect([b.delays, b.mask, b.shown]).toEqual([NONE, from + 2 * n + 1, NONE]);
    expect([c.delays, c.mask, c.shown]).toEqual([from + 2 * n + 2, NONE, NONE]);
    expect(timings.length).toBe(2 * n + 1 + 1 + n);

    const r = recording(from + timings.length);
    timings.upload(r.device, r.buffer, true);
    for (let i = 0; i < n; i++) {
      if (i !== 2) expect(r.f32[a.delays + i]).toBe(i * 10);
      expect(bit(r.u32, a.mask, i)).toBe(i !== 2 ? 1 : 0);
      if (i !== 2) expect(r.f32[a.shown + i]).toBe(Math.fround(i * 10 - a.anchor));
      expect(bit(r.u32, b.mask, i)).toBe(i % 2 === 0 ? 1 : 0);
      expect(r.f32[c.delays + i]).toBe(i);
    }
    expect([...r.f32.subarray(0, from)]).toEqual(new Array(from).fill(0));
  });

  it('writes the mask through u32 bits', () => {
    const n = 40;
    const list = cells(n);
    const { mixer, voices, answers, timings } = setup(list, { target: (c: C) => c.i % 2 === 1 });
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = recording(timings.length);
    timings.upload(r.device, r.buffer, true);
    expect(r.u32[slot.mask]).toBe(0xaaaaaaaa);
    expect(r.u32[slot.mask + 1]).toBe(0xaa);
  });

  it('gives each subject the origin a record would hold', () => {
    const n = 8;
    const list = cells(n);
    const { m, mixer, voices, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 100,
      fade: { in: 300 },
    });
    m.sync(150);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = recording(timings.length);
    timings.upload(r.device, r.buffer, true);
    const voice = voices[0] as Voice<C, unknown>;
    for (const [i, c] of list.entries()) {
      m.probe(c);
      const held = voice.subjects.get(c);
      expect(held).toBeDefined();
      expect(r.f32[slot.shown + i]).toBe(Math.fround((held?.shown as number) - slot.anchor));
    }
    expect(slot.latest).toBe(700);
  });

  it('moves only the origins still ahead after a rate change', () => {
    const n = 10;
    const list = cells(n);
    const { m, mixer, voices, handles, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 100,
      fade: { in: 300 },
    });
    const voice = voices[0] as Voice<C, unknown>;
    const before = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = recording(timings.length);
    timings.upload(r.device, r.buffer, true);
    const was = list.map((_, i) => before.anchor + (r.f32[before.shown + i] as number));

    m.sync(250);
    (handles[0] as { rate: number }).rate = 2;
    const after = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    expect(after.anchor).toBe(250);
    timings.upload(r.device, r.buffer, false);
    for (const [i, c] of list.entries()) {
      const d = i * 100;
      const shown = r.f32[after.shown + i] as number;
      if (d <= 250) expect(after.anchor + shown).toBe(was[i]);
      else
        expect(shown).toBe(
          Math.fround(mixer.shownOf(voice, mixer.sinceOf(voice, d)) - after.anchor),
        );
      m.probe(c);
      expect(shown).toBe(Math.fround((voice.subjects.get(c)?.shown as number) - after.anchor));
    }
    expect(after.anchor + (r.f32[after.shown + 9] as number)).toBe(250 + (900 - 250) / 2);
  });

  it('moves an origin the clock reached between the change and the fold', () => {
    const list = cells(8);
    const { m, mixer, voices, handles, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 130,
      fade: { in: 300 },
    });
    for (const c of list) m.probe(c);
    timings.place(mixer, voices, answers, 0);
    m.sync(250);
    (handles[0] as { rate: number }).rate = 2;
    m.sync(266);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    expect(slot.anchor + (r.f32[slot.shown + 2] as number)).toBe(255);
    for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r.f32))
      expect(o.gpu).toBe(o.cpu);
  });

  it('follows two clock changes between folds, each at its own time', () => {
    const list = cells(8);
    const { m, mixer, voices, handles, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 130,
      fade: { in: 300 },
    });
    for (const c of list) m.probe(c);
    timings.place(mixer, voices, answers, 0);
    const h = handles[0] as { rate: number };
    m.sync(200);
    h.rate = 2;
    m.sync(300);
    h.rate = 0.5;
    m.sync(320);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    const at = (i: number) => slot.anchor + (r.f32[slot.shown + i] as number);
    expect([at(1), at(2), at(3), at(4)]).toEqual([130, 230, 295, 540]);
    for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r.f32))
      expect(o.gpu).toBe(o.cpu);
  });

  it("follows a span's change to a child's clock, taken again as its clock comes back to it", () => {
    const list = cells(8);
    const m = mix<C, P>(K, { name: 'span' });
    m.sync(0);
    const s = m.span({ name: 'seq', duration: 2000 });
    m.cue({
      patch: wave,
      loop: false,
      owner: s,
      faster: 4,
      target: () => true,
      stagger: (c: C) => c.i * 130,
      fade: { in: 300 },
    });
    const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
    const voice = mixer.cued.find((v) => v.owner !== null) as Voice<C, unknown>;
    const answers = new Answers<C>(mixer);
    answers.register(list);
    const timings = new Timings();
    for (const c of list) m.probe(c);
    timings.place(mixer, [voice], answers, 0);
    const heard: number[] = [];
    const hook = mixer.reorigined as (v: Voice<C, unknown>, t: number) => void;
    mixer.reorigined = (v, t) => {
      if (v === voice) heard.push(t);
      hook(v, t);
    };
    m.sync(100);
    m.cue({ patch: wave, loop: false, owner: s, faster: 4 });
    m.cue({ patch: wave, loop: false, owner: s, faster: 4 });
    m.sync(150);
    s.rate = -1;
    m.sync(250);
    s.rate = 1;
    m.sync(400);
    m.sync(420);
    expect(heard).toContain(400);
    const slot = timings.place(mixer, [voice], answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    for (const o of origins(m, voice, list, slot, r.f32)) expect(o.gpu).toBe(o.cpu);
  });

  it("keeps a motion voice's origins as its records hold them through rate changes and a seek", () => {
    const list = cells(8);
    const KX = kit<{ x: number }>({ x: sum() });
    const m = mix<C, { x: number }>(KX, { name: 'motion' });
    m.sync(0);
    const h = m.cue({
      patch: spring<C, { x: number }>('x', { to: (c) => c.i }),
      target: () => true,
      stagger: (c: C) => c.i * 130,
      fade: { in: 300 },
    });
    const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
    const voices = [...mixer.cued] as Voice<C, unknown>[];
    const voice = voices[0] as Voice<C, unknown>;
    expect(voice.motion).toBeDefined();
    const answers = new Answers<C>(mixer);
    answers.register(list);
    const timings = new Timings();
    for (const c of list.slice(0, 4)) m.probe(c);
    timings.place(mixer, voices, answers, 0);
    m.sync(250);
    h.rate = 2;
    m.sync(270);
    h.rate = 3;
    m.sync(290);
    h.seek(100);
    m.sync(300);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    for (const o of origins(m, voice, list, slot, r.f32)) expect(o.gpu).toBe(o.cpu);
  });

  it('writes nothing when nothing moved', () => {
    const list = cells(6);
    const { m, mixer, voices, answers, timings } = setup(
      list,
      { stagger: (c: C) => c.i * 100, fade: { in: 300 } },
      { target: (c: C) => c.i > 2 },
    );
    timings.place(mixer, voices, answers, 3);
    const r = recording(3 + timings.length);
    timings.upload(r.device, r.buffer, false);
    expect(r.writes.length).toBeGreaterThan(0);
    m.sync(120);
    timings.place(mixer, voices, answers, 3);
    r.writes.length = 0;
    timings.upload(r.device, r.buffer, false);
    expect(r.writes).toEqual([]);
  });
});
