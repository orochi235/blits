import { kit, type Mix, mix } from '@msb235/blits';
import { MeshBasicMaterial } from 'three';
import {
  ConstantColor,
  ConstantValue,
  IntervalValue,
  PointEmitter,
  RenderMode,
  Vector4,
} from 'three.quarks';
import { describe, expect, it } from 'vitest';
import { channels, drive, type Emission } from '../src/index.js';
import { born, hold, system } from './fixtures.js';

const K = kit<Emission>(channels);

/** A first write, which owes nothing, then `frames` more, each `dt` ms on. */
function run(frames: number, dt: number, m: Mix<unknown, Emission>, w: () => void, from = 0) {
  for (let f = 0; f <= frames; f++) {
    m.sync(from + f * dt);
    w();
  }
}

function setup() {
  const m = mix<unknown, Emission>(K);
  const q = drive(m, { kit: K });
  return { m, q, write: () => q.write() };
}

describe('wire and at', () => {
  it('emits from two emitters on one source independently', () => {
    const { m, q, write } = setup();
    const src = q.wire(system());
    src.at([1, 0, 0]).cue({ patch: hold({ rate: 10 }) });
    src.at([0, 2, 0]).cue({ patch: hold({ rate: 20 }) });
    run(10, 100, m, write);
    expect(born(src.system).filter((p) => p.position.x === 1)).toHaveLength(10);
    expect(born(src.system).filter((p) => p.position.y === 2)).toHaveLength(20);
  });

  it('bursts n at the next write, at its own emitter only', () => {
    const { m, q, write } = setup();
    const src = q.wire(system());
    const one = src.at([1, 0, 0]);
    src.at([0, 2, 0]);
    run(1, 100, m, write);
    one.burst(5);
    run(0, 0, m, write, 200);
    expect(born(src.system).filter((p) => p.position.x === 1)).toHaveLength(5);
    expect(born(src.system).filter((p) => p.position.y === 2)).toHaveLength(0);
    run(0, 0, m, write, 300);
    expect(src.system.particleNum).toBe(5);
  });

  it('floors a burst, and ignores one at or below 0 or not finite', () => {
    const { m, q, write } = setup();
    const src = q.wire(system());
    const e = src.at([0, 0, 0]);
    run(0, 0, m, write);
    e.burst(2.7);
    e.burst(-1);
    e.burst(Number.NaN);
    e.burst(Number.POSITIVE_INFINITY);
    run(0, 0, m, write, 100);
    expect(src.system.particleNum).toBe(2);
  });

  it('makes a system with particles, in world space unless told otherwise', () => {
    const { m, q, write } = setup();
    const src = q.particles({
      looping: true,
      duration: 1,
      onlyUsedByOther: true,
      shape: new PointEmitter(),
      startLife: new ConstantValue(2),
      startSpeed: new ConstantValue(5),
      startSize: new IntervalValue(0.1, 0.2),
      startColor: new ConstantColor(new Vector4(1, 1, 1, 1)),
      emissionOverTime: new ConstantValue(0),
      renderMode: RenderMode.BillBoard,
      material: new MeshBasicMaterial(),
    });
    expect(src.system.worldSpace).toBe(true);
    src.at([0, 0, 0]).cue({ patch: hold({ rate: 10 }) });
    run(10, 100, m, write);
    expect(src.system.particleNum).toBe(10);
  });
});

describe('drop', () => {
  it("puts the system's authored values back when its last emitter drops", () => {
    const { m, q, write } = setup();
    const src = q.wire(system());
    const e = src.at([0, 0, 0]);
    e.cue({ patch: hold({ rate: 10, speed: 2 }) });
    run(10, 100, m, write);
    e.drop();
    expect((src.system.startSpeed as ConstantValue).value).toBe(5);
  });

  it('drops every emitter on a source', () => {
    const { m, q, write } = setup();
    const src = q.wire(system());
    const one = src.at([0, 0, 0]);
    const two = src.at([1, 0, 0]);
    one.cue({ patch: hold({ rate: 10 }) });
    two.cue({ patch: hold({ rate: 10 }) });
    run(5, 100, m, write);
    const before = src.system.particleNum;
    src.drop();
    run(5, 100, m, write, 600);
    expect(src.system.particleNum).toBe(before);
    expect(m.voices()).toHaveLength(0);
  });

  it('refuses a cue naming its own subjects, a cue after drop, and a wire of something else', () => {
    const { q } = setup();
    const e = q.wire(system()).at([0, 0, 0]);
    expect(() => e.cue({ patch: hold({ rate: 1 }), subjects: ['x'] } as never)).toThrow(
      /names its own subject/,
    );
    e.drop();
    expect(() => e.cue({ patch: hold({ rate: 1 }) })).toThrow(/dropped/);
    expect(() => e.source.at([0, 0, 0]).drop()).not.toThrow();
    expect(() => q.wire({} as never)).toThrow(/not a ParticleSystem/);
  });
});
