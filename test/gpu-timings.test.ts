import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { Answers } from '../src/gpu/answers.js';
import { mixerOf } from '../src/gpu/engine.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { type TimingSlot, Timings } from '../src/gpu/timings.js';
import { unreadOf } from '../src/gpu/unread.js';
import type { GpuBuffer, GpuCommandEncoder, GpuDevice } from '../src/gpu/webgpu.js';
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

interface Made extends GpuBuffer {
  readonly data: ArrayBuffer;
  destroyed: boolean;
}

/** A buffer `createBuffer` makes, mapped at creation and backed by an `ArrayBuffer`. */
function made(size: number): Made {
  const b: Made = {
    data: new ArrayBuffer(size),
    size,
    destroyed: false,
    mapAsync: () => Promise.resolve(),
    getMappedRange: () => b.data,
    unmap() {},
    destroy() {
      b.destroyed = true;
    },
  };
  return b;
}

/**
 * A device keeping every `writeBuffer` and encoder copy into the buffer it hands out, and
 * applying each to `bytes`, as a GPU buffer would.
 */
function recording(size: number) {
  const bytes = new ArrayBuffer(size * 4);
  const writes: { offset: number; length: number }[] = [];
  const copies: { offset: number; length: number }[] = [];
  const buffers: Made[] = [];
  const device = {
    queue: {
      writeBuffer(_: GpuBuffer, offset: number, data: ArrayBufferView) {
        writes.push({ offset, length: data.byteLength });
        new Uint8Array(bytes, offset, data.byteLength).set(
          new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
        );
      },
    },
    createBuffer(desc: { size: number }) {
      const b = made(desc.size);
      buffers.push(b);
      return b;
    },
  } as unknown as GpuDevice;
  const enc = {
    copyBufferToBuffer(src: GpuBuffer, at: number, _: GpuBuffer, to: number, length: number) {
      const from = src as Made;
      if (from.destroyed) throw new Error('a copy read a destroyed buffer');
      copies.push({ offset: to, length });
      new Uint8Array(bytes, to, length).set(new Uint8Array(from.data, at, length));
    },
  } as unknown as GpuCommandEncoder;
  return {
    device,
    enc,
    writes,
    copies,
    buffers,
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

/** Subject `i`'s level in the block at `slot`, as the kernel reads it. */
const levelAt = (u32: Uint32Array, slot: TimingSlot, i: number) =>
  slot.codes === NONE ? i : ((u32[slot.codes + (i >>> 1)] as number) >>> ((i & 1) * 16)) & 0xffff;
const delayAt = (u32: Uint32Array, f32: Float32Array, slot: TimingSlot, i: number) =>
  f32[slot.delays + levelAt(u32, slot, i)];
const shownAt = (u32: Uint32Array, f32: Float32Array, slot: TimingSlot, i: number) =>
  f32[slot.shown + levelAt(u32, slot, i)];

const bit = (words: Uint32Array, at: number, i: number) =>
  ((words[at + (i >>> 5)] as number) >>> (i & 31)) & 1;

/** Each subject's `shown` as the CPU's record holds it and as the block has it, less the anchor. */
function origins(
  m: { probe(c: C): unknown },
  voice: Voice<C, unknown>,
  list: readonly C[],
  slot: TimingSlot,
  { u32, f32 }: { u32: Uint32Array; f32: Float32Array },
) {
  return list.map((c, i) => {
    m.probe(c);
    return {
      cpu: Math.fround((voice.subjects.get(c)?.shown as number) - slot.anchor),
      gpu: shownAt(u32, f32, slot, i),
    };
  });
}

/** A recording device with every block written. */
function uploaded(timings: Timings) {
  const r = recording(timings.length);
  timings.upload(r.device, r.enc, r.buffer, true);
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
    // a: 4 levels (subject 2, unreached, holds delay 0), a mask word, 4 origins, 3 words of codes.
    expect([a.delays, a.mask, a.shown, a.codes]).toEqual([from, from + 4, from + 5, from + 9]);
    expect([b.delays, b.mask, b.shown, b.codes]).toEqual([NONE, from + 12, NONE, NONE]);
    expect([c.delays, c.mask, c.shown, c.codes]).toEqual([from + 13, NONE, NONE, from + 18]);
    expect(timings.length).toBe(12 + 1 + 8);

    const r = recording(from + timings.length);
    timings.upload(r.device, r.enc, r.buffer, true);
    for (let i = 0; i < n; i++) {
      if (i !== 2) expect(delayAt(r.u32, r.f32, a, i)).toBe(i * 10);
      expect(bit(r.u32, a.mask, i)).toBe(i !== 2 ? 1 : 0);
      if (i !== 2) expect(shownAt(r.u32, r.f32, a, i)).toBe(Math.fround(i * 10 - a.anchor));
      expect(bit(r.u32, b.mask, i)).toBe(i % 2 === 0 ? 1 : 0);
      expect(delayAt(r.u32, r.f32, c, i)).toBe(i);
    }
    expect([...r.f32.subarray(0, from)]).toEqual(new Array(from).fill(0));
  });

  it('writes the mask through u32 bits', () => {
    const n = 40;
    const list = cells(n);
    const { mixer, voices, answers, timings } = setup(list, { target: (c: C) => c.i % 2 === 1 });
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = recording(timings.length);
    timings.upload(r.device, r.enc, r.buffer, true);
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
    timings.upload(r.device, r.enc, r.buffer, true);
    const voice = voices[0] as Voice<C, unknown>;
    for (const [i, c] of list.entries()) {
      m.probe(c);
      const held = voice.subjects.get(c);
      expect(held).toBeDefined();
      expect(shownAt(r.u32, r.f32, slot, i)).toBe(
        Math.fround((held?.shown as number) - slot.anchor),
      );
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
    timings.upload(r.device, r.enc, r.buffer, true);
    const was = list.map((_, i) => before.anchor + (shownAt(r.u32, r.f32, before, i) as number));

    m.sync(250);
    (handles[0] as { rate: number }).rate = 2;
    const after = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    expect(after.anchor).toBe(250);
    timings.upload(r.device, r.enc, r.buffer, false);
    for (const [i, c] of list.entries()) {
      const d = i * 100;
      const shown = shownAt(r.u32, r.f32, after, i) as number;
      if (d <= 250) expect(after.anchor + shown).toBe(was[i]);
      else
        expect(shown).toBe(
          Math.fround(mixer.shownOf(voice, mixer.sinceOf(voice, d)) - after.anchor),
        );
      m.probe(c);
      expect(shown).toBe(Math.fround((voice.subjects.get(c)?.shown as number) - after.anchor));
    }
    expect(after.anchor + (shownAt(r.u32, r.f32, after, 9) as number)).toBe(250 + (900 - 250) / 2);
  });

  it('gives subjects sharing a delay one origin, through a reach mask and a rate change', () => {
    const list = cells(64);
    const { m, mixer, voices, handles, answers, timings } = setup(list, {
      stagger: (c: C) => (c.i % 4) * 100,
      target: (c: C) => c.i % 3 !== 0,
      fade: { in: 300 },
    });
    const voice = voices[0] as Voice<C, unknown>;
    m.sync(150);
    timings.place(mixer, voices, answers, 0);
    const r = recording(timings.length);
    timings.upload(r.device, r.enc, r.buffer, true);
    (handles[0] as { rate: number }).rate = 2;
    m.sync(160);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    timings.upload(r.device, r.enc, r.buffer, false);
    for (const [i, c] of list.entries()) {
      if (i % 3 === 0) continue;
      m.probe(c);
      expect(shownAt(r.u32, r.f32, slot, i)).toBe(
        Math.fround((voice.subjects.get(c)?.shown as number) - slot.anchor),
      );
    }
    expect(slot.latest).toBe(150 + (300 - 150) / 2);
  });

  it('gives each subject its own origin past 4,096 distinct delays', () => {
    const list = cells(5000);
    const { m, mixer, voices, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 0.5,
      fade: { in: 300 },
    });
    m.sync(100);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r))
      expect(o.gpu).toBe(o.cpu);
    expect(slot.latest).toBe(4999 * 0.5);
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
    expect(slot.anchor + (shownAt(r.u32, r.f32, slot, 2) as number)).toBe(255);
    for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r))
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
    const at = (i: number) => slot.anchor + (shownAt(r.u32, r.f32, slot, i) as number);
    expect([at(1), at(2), at(3), at(4)]).toEqual([130, 230, 295, 540]);
    for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r))
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
    for (const c of list) m.probe(c);
    m.cue({ patch: wave, loop: false, owner: s, faster: 4 });
    m.cue({ patch: wave, loop: false, owner: s, faster: 4 });
    m.sync(150);
    for (const c of list) m.probe(c);
    s.rate = -1;
    m.sync(250);
    for (const c of list) m.probe(c);
    s.rate = 1;
    m.sync(400);
    for (const c of list) m.probe(c);
    m.sync(420);
    for (const c of list) m.probe(c);
    expect(heard).toContain(400);
    const slot = timings.place(mixer, [voice], answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    for (const o of origins(m, voice, list, slot, r)) expect(o.gpu).toBe(o.cpu);
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
    for (const c of list) m.probe(c);
    timings.place(mixer, voices, answers, 0);
    m.sync(250);
    for (const c of list) m.probe(c);
    h.rate = 2;
    m.sync(270);
    for (const c of list) m.probe(c);
    h.rate = 3;
    m.sync(290);
    for (const c of list) m.probe(c);
    h.seek(100);
    m.sync(300);
    for (const c of list) m.probe(c);
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    const r = uploaded(timings);
    for (const o of origins(m, voice, list, slot, r)) expect(o.gpu).toBe(o.cpu);
  });

  it("follows a mix-level seek back to before a rate change, as the records' origins do", () => {
    const list = cells(10);
    const m = mix<C, P>(K, { name: 'seek', history: { ms: 1e5, tape: createHistory } });
    m.sync(0);
    const h = m.cue({ patch: wave, loop: true, stagger: (c: C) => c.i * 100, fade: { in: 300 } });
    const mixer = mixerOf(m) as unknown as Mixer<C, unknown>;
    const voices = [...mixer.cued] as Voice<C, unknown>[];
    const answers = new Answers<C>(mixer);
    answers.register(list);
    const timings = new Timings();
    const frame = (t: number) => {
      m.sync(t);
      for (const c of list) m.probe(c);
      const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
      const r = uploaded(timings);
      for (const o of origins(m, voices[0] as Voice<C, unknown>, list, slot, r))
        expect(o.gpu).toBe(o.cpu);
    };
    for (let t = 0; t <= 300; t += 50) frame(t);
    h.rate = 0.5;
    for (let t = 350; t <= 1000; t += 50) frame(t);
    m.seek(200);
    for (let t = 1050; t <= 2500; t += 50) frame(t);
  });

  it("reads a voice's block once per unreadOf, not once per subject", () => {
    const list = cells(50);
    const { m, mixer, voices, answers, timings } = setup(list, {
      stagger: (c: C) => c.i * 10,
      fade: { in: 300 },
    });
    m.sync(100);
    let asked = 0;
    const of = answers.of.bind(answers);
    answers.of = (v) => {
      asked++;
      return of(v);
    };
    const unread = unreadOf(mixer, voices[0] as Voice<C, unknown>, answers, timings);
    const silent = list.map((_, i) => unread(i));
    expect(silent.filter(Boolean).length).toBe(40);
    expect(asked).toBeLessThanOrEqual(2);
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
    timings.upload(r.device, r.enc, r.buffer, false);
    expect(r.writes.length).toBeGreaterThan(0);
    m.sync(120);
    timings.place(mixer, voices, answers, 3);
    r.writes.length = 0;
    timings.upload(r.device, r.enc, r.buffer, false);
    expect(r.writes).toEqual([]);
  });
  it('sends codes past 64 KB up once at cue, copied on the GPU wherever the block is laid', () => {
    const list = cells(40_000);
    const { m, mixer, voices, answers, timings } = setup(
      list,
      { subjects: list, stagger: (c: C) => (c.i % 256) * 4, loop: false },
      { subjects: list, stagger: (c: C) => (c.i % 300) * 3 },
    );
    const [a, b] = voices as [Voice<C, unknown>, Voice<C, unknown>];
    const staging = recording(0);
    for (const v of voices) timings.stage(staging.device, v);
    expect(staging.buffers.map((x) => x.size)).toEqual([80_000, 80_000]);
    const check = (slot: TimingSlot, r: ReturnType<typeof recording>, step: number, k: number) => {
      for (const i of [0, 1, 255, 256, 299, 300, 39_999])
        expect(delayAt(r.u32, r.f32, slot, i)).toBe((i % k) * step);
    };
    const [sa, sb] = timings.place(mixer, voices, answers, 0) as [TimingSlot, TimingSlot];
    let r = recording(timings.length);
    timings.upload(r.device, r.enc, r.buffer, true);
    check(sa, r, 4, 256);
    check(sb, r, 3, 300);
    // Copied from the buffers sent at cue, none made since.
    expect(r.copies.map((c) => c.length)).toEqual([80_000, 80_000]);
    expect([staging.buffers.length, r.buffers.length]).toEqual([2, 0]);

    m.sync(3000);
    expect(a.state).toBe('done');
    const [moved] = timings.place(mixer, [b], answers, 0) as [TimingSlot];
    expect(moved.delays).not.toBe(sb.delays);
    expect(staging.buffers[0]?.destroyed).toBe(true);
    r = recording(timings.length);
    timings.upload(r.device, r.enc, r.buffer, false);
    check(moved, r, 3, 300);
    expect(r.writes.every((w) => w.length < 80_000)).toBe(true);
    expect(r.copies).toEqual([{ offset: moved.codes * 4, length: 80_000 }]);
  });

  it("lets go of a voice's codes buffer once its block lays other levels", () => {
    const list = cells(40_000);
    const { mixer, voices, answers, timings } = setup(list, { stagger: (c: C) => (c.i % 256) * 4 });
    const lay = () => {
      const [slot] = timings.place(mixer, voices, answers, 0) as [TimingSlot];
      const r = recording(timings.length);
      timings.upload(r.device, r.enc, r.buffer, true);
      expect(delayAt(r.u32, r.f32, slot, 39_999)).toBe((39_999 % 256) * 4);
      return r.buffers;
    };
    const [first] = lay();
    // Registered again, the voice's delays are a new array, laid as new levels.
    answers.register(list);
    timings.clear();
    const [second] = lay();
    expect([first?.destroyed, second?.destroyed]).toEqual([true, false]);
  });

  it("lays a level's delay and origin once, and re-sends only the levels' origins after a rate change", () => {
    const list = cells(1000);
    const { m, mixer, voices, handles, answers, timings } = setup(list, {
      stagger: (c: C) => (c.i % 4) * 100,
      fade: { in: 300 },
    });
    const slot = timings.place(mixer, voices, answers, 0)[0] as TimingSlot;
    expect(timings.length).toBe(4 + 4 + 500);
    const r = uploaded(timings);
    expect([0, 1, 2, 3, 4, 999].map((i) => delayAt(r.u32, r.f32, slot, i))).toEqual([
      0, 100, 200, 300, 0, 300,
    ]);
    m.sync(50);
    (handles[0] as { rate: number }).rate = 2;
    timings.place(mixer, voices, answers, 0);
    r.writes.length = 0;
    timings.upload(r.device, r.enc, r.buffer, false);
    expect(r.writes).toEqual([{ offset: slot.shown * 4, length: 4 * 4 }]);
  });
});
