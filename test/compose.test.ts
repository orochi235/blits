import { describe, expect, it } from 'vitest';
import { kit, last, mul, sum, vec } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { keys, patch } from '../src/patch.js';
import { level, slew } from '../src/signals.js';
import type { Channel, Signal } from '../src/types.js';

interface Part {
  id: string;
}
const part = { id: 'a' };

// What a package such as magicsmoke would publish: its channels and a patch written against them.
interface Jolt {
  offset: number[];
}
const joltKit = kit<Jolt>({ offset: vec(2, sum()) });
const jolt = patch<Part, Jolt>(0, () => ({ offset: [3, 4] }), { kit: joltKit });

describe('patches written against a kit', () => {
  it('fold in a host whose kit has the same kinds under the same names, wherever made', () => {
    interface Host {
      offset: number[];
      gain: number;
    }
    const m = mix<Part, Host>(kit<Host>({ offset: vec(2, sum()), gain: mul() }));
    m.cue({ patch: jolt });
    m.cue({ patch: jolt, weight: 0.5 });
    m.sync(0);
    expect(m.probe(part).offset).toEqual([4.5, 6]);
  });

  it('take their writes from the kit when no writes are given', () => {
    expect(jolt.writes).toEqual(['offset']);
  });

  it('are refused at cue by a kit whose channel of that name folds another way', () => {
    const m = mix<Part, Jolt>(kit<Jolt>({ offset: vec(2, mul()) }));
    expect(() => m.cue({ patch: jolt })).toThrow(/offset is vec\(2, mul\).*vec\(2, sum\)/);
  });

  it('match a custom channel only by identity', () => {
    interface Clip {
      clip: number;
    }
    const custom: Channel<number> = { merge: Math.min, lerp: (a, b, u) => a + (b - a) * u };
    const own = keys<Part, Clip>(100, [{ at: 0, delta: { clip: 1 } }], { kit: { clip: custom } });
    expect(() => mix<Part, Clip>(kit<Clip>({ clip: custom })).cue({ patch: own })).not.toThrow();
    const lookalike = { ...custom };
    expect(() => mix<Part, Clip>(kit<Clip>({ clip: lookalike })).cue({ patch: own })).toThrow(
      /custom channel/,
    );
  });

  it('give the stock channels kinds, and a last with its own lerp none', () => {
    expect([sum().kind, mul().kind, last().kind, vec(3, sum()).kind]).toEqual([
      'sum',
      'mul',
      'last',
      'vec(3, sum)',
    ]);
    expect(last<number>({ lerp: (a) => a }).kind).toBeUndefined();
  });

  it('a patch with neither writes nor kit is refused where it is made', () => {
    expect(() => patch<Part, Jolt>(0, () => ({}), {})).toThrow(/writes/);
  });
});

describe('patches that read the host', () => {
  interface Pose {
    crawl: number;
  }
  const PART = kit<Pose>({ crawl: sum() });
  const follows = patch<Part, Pose>(
    0,
    (_p, _s, setting) => ({ crawl: (setting.host as { pointer: number }).pointer }),
    { writes: ['crawl'], reads: ['pointer'] },
  );

  it('are refused at cue by a mix whose host lacks a field they read', () => {
    expect(() => mix<Part, Pose>(PART).cue({ patch: follows })).toThrow(/host\.pointer/);
    expect(() => mix<Part, Pose>(PART, { host: { other: 1 } }).cue({ patch: follows })).toThrow(
      /host\.pointer/,
    );
  });

  it('run in a mix whose host has it', () => {
    const m = mix<Part, Pose>(PART, { host: { pointer: 7 } });
    m.cue({ patch: follows });
    m.sync(0);
    expect(m.probe(part).crawl).toBe(7);
  });
});

describe('a typed host', () => {
  interface Pose {
    crawl: number;
  }
  interface Host {
    pointer: number;
  }
  const PART = kit<Pose>({ crawl: sum() });

  it('reaches patches and signals as its own type, with no cast', () => {
    const follows = patch<Part, Pose, void, Host>(
      0,
      (_p, _s, setting) => ({ crawl: setting.host.pointer }),
      { writes: ['crawl'], reads: ['pointer'] },
    );
    const near = slew<Part, Host>((_s, setting) => setting.host.pointer / 10, { riseMs: 0 });
    const m = mix<Part, Pose, Host>(PART, { host: { pointer: 7 } });
    m.cue({ patch: follows, weight: near });
    m.cue({ patch: follows, weight: level<Part>(1) });
    m.sync(0);
    expect(m.probe(part).crawl).toBeCloseTo(7 * 0.7 + 7, 9);
  });

  it('is refused by the type of a mix that does not declare it', () => {
    const near: Signal<Part, Host> = (_s, setting) => setting.host.pointer;
    const m = mix<Part, Pose>(PART, { host: { pointer: 7 } });
    const follows = patch<Part, Pose>(0, () => ({ crawl: 1 }), { writes: ['crawl'] });
    // @ts-expect-error: the mix's host is unknown, so a signal needing a Host cannot play in it.
    m.cue({ patch: follows, weight: near });
  });
});

describe('draining by tag', () => {
  interface Pose {
    crawl: number;
  }
  const PART = kit<Pose>({ crawl: sum() });
  const sender = (what: string) =>
    patch<Part, Pose, null>(0, () => ({}), {
      writes: [],
      state: () => null,
      step: (_s, _dt, _subject, setting) => setting.send(what),
    });

  it("takes one package's events and leaves the others queued", () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: sender('spark'), tags: ['magicsmoke'] });
    m.cue({ patch: sender('chime'), tags: ['wod', 'sound'] });
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    const smoke = m.drain<string>('magicsmoke');
    expect(smoke.map((e) => [e.event, e.tags])).toEqual([['spark', ['magicsmoke']]]);
    expect(m.drain<string>('sound').map((e) => e.event)).toEqual(['chime']);
    expect(m.drain()).toEqual([]);
  });

  it('gives an untagged voice no tags', () => {
    const m = mix<Part, Pose>(PART);
    m.cue({ patch: sender('x') });
    m.sync(0);
    m.probe(part);
    m.sync(16);
    m.probe(part);
    expect(m.drain()[0]?.tags).toEqual([]);
  });
});
