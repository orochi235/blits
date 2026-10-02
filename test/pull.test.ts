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
