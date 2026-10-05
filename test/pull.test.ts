import { describe, expect, it } from 'vitest';
import { hex, kit, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys } from '../src/patch.js';

interface Pose {
  gain: number;
  position: number[];
  color?: number;
}
const K = kit<Pose>({ gain: mul(), position: vec(2, sum()), color: hex() });
const parts = [{ id: 0 }, { id: 1 }, { id: 2 }];

describe('pull', () => {
  it('writes rests before the first sync, and NaN for a channel with no rest', () => {
    const m = mix<{ id: number }, Pose>(K);
    const gain = new Float64Array(3);
    const position = new Float64Array(6);
    const color = new Float64Array(3);
    m.pull(parts, { gain, position, color });
    expect([...gain]).toEqual([1, 1, 1]);
    expect([...position]).toEqual([0, 0, 0, 0, 0, 0]);
    expect([...color]).toEqual([Number.NaN, Number.NaN, Number.NaN]);
  });

  it('writes a vec channel side by side, in the order given, from any iterable', () => {
    const m = mix<{ id: number }, Pose>(K);
    m.cue({
      patch: keys(100, [
        { at: 0, delta: { position: [0, 0], color: 0xff0000 } },
        { at: 1, delta: { position: [10, -10], color: 0x0000ff } },
      ]),
    });
    m.sync(0);
    m.sync(50);
    function* reversed() {
      for (let i = parts.length - 1; i >= 0; i--) yield parts[i] as { id: number };
    }
    const position = new Float64Array(6);
    const color = new Float64Array(3);
    m.pull(reversed(), { position, color });
    expect([...position]).toEqual([5, -5, 5, -5, 5, -5]);
    expect(color[0]).toBe(m.probe(parts[0] as { id: number }).color);
  });

  it('reads only the channels it is handed', () => {
    const m = mix<{ id: number }, Pose>(K);
    m.sync(0);
    const gain = new Float64Array(3);
    m.pull(parts, { gain });
    expect([...gain]).toEqual([1, 1, 1]);
  });

  it('throws when an array is too short for the subjects', () => {
    const m = mix<{ id: number }, Pose>(K);
    m.sync(0);
    expect(() => m.pull(parts, { position: new Float64Array(5) })).toThrow(
      "blits: pull's array for position has room for 2 subjects, and was given more",
    );
  });

  it('throws for a channel the kit lacks', () => {
    const m = mix<{ id: number }, Pose>(K);
    expect(() => m.pull(parts, { size: new Float64Array(3) } as never)).toThrow(
      'blits: pull was handed size, which the kit lacks',
    );
  });
});

describe('pull reading subjects from the lanes in runs', () => {
  interface Wide {
    gain: number;
    position: number[];
    opacity: number;
    tint: number;
  }
  const W = kit<Wide>({
    gain: mul(),
    position: vec(2, sum()),
    opacity: mul({ bounds: [0, 1] }),
    tint: sum(),
  });
  type Part = { id: number };
  const rise = keys<Part, Wide>(100, [
    { at: 0, delta: { gain: 0.5, position: [0, 1], opacity: 0.4 } },
    { at: 1, delta: { gain: 2, position: [30, -5], opacity: 1.6 } },
  ]);

  it('writes runs, runs broken by order, repeats and channels no voice writes', () => {
    const parts = Array.from({ length: 150 }, (_, id) => ({ id }));
    const m = mix<Part, Wide>(W, { lanes: true });
    m.cue({ patch: rise, stagger: (p) => p.id });
    // The numbers follow first sight: the order of the first pull, which later lists break up.
    const lists = [
      parts,
      [...parts.slice(20), ...parts.slice(0, 20)],
      [...parts.slice(0, 30), parts[3] as Part, ...parts.slice(30)],
      parts.filter((p) => p.id % 3 !== 1),
    ];
    for (let t = 16; t <= 160; t += 16) {
      m.sync(t);
      for (const list of lists) {
        const k = list.length;
        const cols = {
          gain: new Float64Array(k),
          position: new Float64Array(2 * k),
          opacity: new Float64Array(k),
          tint: new Float64Array(k),
        };
        m.pull(list, cols);
        list.forEach((part, i) => {
          const pose = m.probe(part);
          expect(cols.gain[i], `t=${t} gain of ${part.id}`).toBe(pose.gain);
          expect([cols.position[2 * i], cols.position[2 * i + 1]]).toEqual(pose.position);
          expect(cols.opacity[i], `t=${t} opacity of ${part.id}`).toBe(pose.opacity);
          expect(cols.tint[i], `t=${t} tint of ${part.id}`).toBe(pose.tint);
        });
      }
    }
  });
});

describe('pull reading the same array again', () => {
  type Part = { id: number };
  const ramp = keys<Part, Pose>(100, [
    { at: 0, delta: { gain: 0.5 } },
    { at: 1, delta: { gain: 0.25 } },
  ]);
  const byId = keys<Part, Pose>(100, [
    { at: 0, delta: { position: [0, 0] } },
    { at: 1, delta: { position: [10, 20] } },
  ]);

  /** Pulls `list` and checks every subject's values against a probe of it. */
  function agrees(m: ReturnType<typeof mix<Part, Pose>>, list: Part[]): void {
    const gain = new Float64Array(list.length);
    const position = new Float64Array(list.length * 2);
    m.pull(list, { gain, position });
    list.forEach((part, i) => {
      const pose = m.probe(part);
      expect(gain[i], `gain of ${part.id}`).toBe(pose.gain);
      expect([position[2 * i], position[2 * i + 1]], `position of ${part.id}`).toEqual(
        pose.position,
      );
    });
  }

  for (const lanes of [true, false])
    it(`stays right as the array, the voices and the subjects change, lanes ${lanes ? 'on' : 'off'}`, () => {
      const list = Array.from({ length: 6 }, (_, id) => ({ id }));
      const m = mix<Part, Pose>(K, { lanes });
      const h = m.cue({ patch: ramp, stagger: (p) => p.id * 10 });
      let t = 0;
      const frame = () => {
        t += 16;
        m.sync(t);
        agrees(m, list);
      };
      frame();
      frame();
      // Edited in place: two entries swapped, then one replaced by a subject never seen.
      [list[1], list[4]] = [list[4] as Part, list[1] as Part];
      frame();
      list[2] = { id: 99 };
      frame();
      // A voice cued between pulls.
      m.cue({ patch: byId, subjects: [list[0] as Part, list[3] as Part] });
      frame();
      // A subject faded out of a voice, and one dropped.
      h.fade({ subject: list[5] as Part, over: 0 });
      frame();
      m.drop(list[0] as Part);
      frame();
      // Shorter, then longer again.
      list.length = 3;
      frame();
      list.push({ id: 7 }, { id: 8 });
      frame();
    });
});
