import { createHistory as tape } from '@weasel-js/history';
import { afterEach, describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { lean } from '../src/lean.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { slew } from '../src/signals.js';
import { transport } from '../src/transport.js';
import type { Mix, Watched, WatchedFrame } from '../src/types.js';
import { watched } from '../src/watch.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Part {
  id: string;
}
const a: Part = { id: 'a' };

/** x reads the voice's elapsed ms, for 100 s. */
const clock = patch<Part, Pose>(100_000, (p) => ({ x: p * 100_000 }), { writes: ['x'] });

const entryOf = <I, O>(m: Mix<I, O>) =>
  watched()
    .entries()
    .find((e) => e.mix === (m as unknown)) as Watched<I, O>;

const taped = { history: { ms: 10_000, tape } };

afterEach(() => {
  watched().history = undefined;
});

describe('the registry', () => {
  it('lists a mix with its release and name, from mix and from lean', () => {
    const m = mix<Part, Pose>(K, { name: 'stock' });
    const l = lean.create<Part, Pose>(K, { name: 'lean' });
    expect(entryOf(m).name).toBe('stock');
    expect(entryOf(m).release).toMatch(/^\d+\.\d+\.\d+/);
    expect(entryOf(l).name).toBe('lean');
  });

  it('does not list the mixes a projection makes for itself', () => {
    const m = mix<Part, Pose>(K, taped);
    m.cue({ patch: clock, start: 0 });
    m.sync(0);
    m.sync(100);
    const before = watched().entries().length;
    m.project(50).probe(a);
    m.project(500).probe(a);
    expect(watched().entries().length).toBe(before);
  });

  it('is the one registry another copy of blits lists its mixes in', async () => {
    const path = '../src/watch.js?copy';
    const other = (await import(/* @vite-ignore */ path)) as typeof import('../src/watch.js');
    expect(other.watched).not.toBe(watched);
    expect(other.watched()).toBe(watched());
  });

  it('tells a listener of each mix made', () => {
    const heard: string[] = [];
    const off = watched().on((c) => {
      if (c.kind === 'add') heard.push(c.entry.name ?? '');
    });
    mix<Part, Pose>(K, { name: 'heard' });
    off();
    mix<Part, Pose>(K, { name: 'unheard' });
    expect(heard).toEqual(['heard']);
  });

  it("gives a mix the registry's history where it names none, and says so", () => {
    watched().history = { ms: 5000 };
    expect(entryOf(mix<Part, Pose>(K)).history).toEqual({ ms: 5000, tape: false, added: true });
    expect(entryOf(mix<Part, Pose>(K, { history: { ms: 100 } })).history).toEqual({
      ms: 100,
      tape: false,
      added: false,
    });
    watched().history = undefined;
    const shared = transport();
    watched().history = { ms: 5000 };
    expect(entryOf(mix<Part, Pose>(K, { transport: shared })).history).toBeUndefined();
    const t = transport();
    expect(entryOf(mix<Part, Pose>(K, { transport: t })).history?.added).toBe(true);
  });
});

describe('labels', () => {
  it("takes the mix's labelOf, else guesses from the subject", () => {
    const m = mix<unknown, Pose>(K, {
      labelOf: (s: unknown) => (s === 'named' ? 'given' : undefined),
    });
    const e = entryOf(m);
    class Mesh {}
    const mesh = new Mesh();
    expect(e.label('named')).toBe('given');
    expect(e.label('a')).toBe('a');
    expect(e.label(7)).toBe('7');
    expect(e.label({ name: 'hero' })).toBe('hero');
    expect(e.label({ id: 3 })).toBe('3');
    expect(e.label(mesh)).toMatch(/^Mesh #\d+$/);
    expect(e.label(mesh)).toBe(e.label(mesh));
    expect(e.label({})).toMatch(/^Object #\d+$/);
  });
});

describe('watching', () => {
  it('hands over each frame the host read, with copies of its poses', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: clock, start: 0 });
    const frames: WatchedFrame<Part, Pose>[] = [];
    const off = entryOf(m).watch((f) => frames.push(f));
    const out = { x: 0 };
    m.sync(0);
    m.probe(a, out);
    m.sync(100);
    m.probe(a, out);
    m.sync(200);
    expect(frames.map((f) => f.now)).toEqual([0, 100]);
    expect(frames.map((f) => f.probed[0]?.pose.x)).toEqual([0, 100]);
    expect(frames[0]?.probed[0]?.subject).toBe(a);
    expect(frames[1]?.voices).toEqual(m.voices());
    off();
  });

  it('records what pull wrote and what drain handed the host, who still gets it', () => {
    const m = mix<Part, Pose>(K);
    const pinger = patch<Part, Pose>(
      0,
      (_p, _s, st) => {
        st.send('ping');
        return { x: 1 };
      },
      { writes: ['x'] },
    );
    m.cue({ patch: pinger, start: 0 });
    const frames: WatchedFrame<Part, Pose>[] = [];
    const off = entryOf(m).watch((f) => frames.push(f));
    m.sync(0);
    const into = { x: new Float64Array(1) };
    m.pull([a], into);
    const got = m.drain();
    m.sync(16);
    expect(got.map((e) => e.event)).toEqual(['ping']);
    expect(frames[0]?.sent.map((e) => e.event)).toEqual(['ping']);
    expect(frames[0]?.pulled[0]?.columns.x?.[0]).toBe(1);
    expect(frames[0]?.pulled[0]?.columns.x).not.toBe(into.x);
    off();
  });

  it('puts the methods back once the last watcher stops', () => {
    const m = mix<Part, Pose>(K);
    const e = entryOf(m);
    const one = e.watch(() => {});
    const two = e.watch(() => {});
    expect(Object.hasOwn(m, 'probe')).toBe(true);
    one();
    expect(Object.hasOwn(m, 'probe')).toBe(true);
    two();
    for (const k of ['probe', 'pull', 'drain'])
      expect(m[k as 'probe']).toBe(Object.getPrototypeOf(m)[k]);
    const t = (m as unknown as { transport: { sync: unknown } }).transport;
    expect(t.sync).toBe(Object.getPrototypeOf(t).sync);
  });

  it('lists subjects the voices name and those the host read', () => {
    const m = mix<Part, Pose>(K);
    const b: Part = { id: 'b' };
    m.cue({ patch: clock, subjects: [b] });
    const e = entryOf(m);
    const off = e.watch(() => {});
    m.sync(0);
    m.probe(a);
    expect(new Set(e.subjects())).toEqual(new Set([a, b]));
    const c: Part = { id: 'c' };
    m.cue({
      patch: patch<Part, Pose>(10, () => ({ x: 1 }), { writes: ['x'] }),
      subjects: [c],
      start: 0,
    });
    m.sync(100);
    expect(e.subjects()).not.toContain(c);
    // A subject the host read once drops out two frames later.
    m.sync(200);
    m.sync(300);
    m.probe({ id: 'z' });
    m.sync(400);
    m.probe(b);
    m.sync(500);
    m.probe(b);
    expect(e.subjects().map((x) => x.id)).not.toContain('z');
    off();
  });

  it('reads a subject the host never probed without starting its slew', () => {
    const run = (look: boolean) => {
      const m = mix<Part, Pose>(K, { history: { ms: 2000 } });
      const rising = slew<Part>(() => 1, { riseMs: 1000, from: 0 });
      m.cue({ patch: patch<Part, Pose>(0, () => ({ x: 100 }), { writes: ['x'] }), weight: rising });
      m.sync(0);
      m.sync(500);
      const read = look ? entryOf(m).read(a).x : Number.NaN;
      m.sync(1000);
      return { read, x: m.probe(a).x };
    };
    // A probe at 500 would have started the slew there, and 1000 would read half of it.
    expect(run(true).x).toBe(run(false).x);
    expect(run(true).read).toBe(0);
  });
});

describe('what an entry tells', () => {
  it("names the channels, a voice's name and tags, and reads back in time", () => {
    const m = mix<Part, Pose>(K, { history: { ms: 1000 } });
    const h = m.cue({ patch: clock, start: 0, name: 'tick', tags: ['beat'] });
    const e = entryOf(m);
    m.sync(0);
    m.sync(300);
    expect(e.channels).toEqual(['x']);
    expect(e.voice(h)).toEqual({ name: 'tick', tags: ['beat'] });
    expect(e.voice(mix<Part, Pose>(K).cue({ patch: clock }))).toBeUndefined();
    expect(e.read(a, 100).x).toBe(100);
    expect(e.reach).toBe(0);
    expect(entryOf(mix<Part, Pose>(K)).reach).toBeNaN();
    expect(e.read(a).x).toBe(300);
  });
});

describe('holding', () => {
  function setup(opts: Parameters<typeof mix>[1] = taped) {
    const m = mix<Part, Pose>(K, opts);
    m.cue({ patch: clock, start: 0 });
    m.sync(0);
    m.sync(100);
    return { m, e: entryOf(m) };
  }

  it("pauses the mix on the host's frames, and plays it at the hold's rate", () => {
    const { m, e } = setup();
    const h = e.hold();
    m.sync(200);
    expect(m.probe(a).x).toBe(100);
    h.rate = 0.5;
    m.sync(300);
    expect(m.probe(a).x).toBe(150);
    h.free();
  });

  it('steps, and wakes a host sleeping on the mix', () => {
    const { m, e } = setup();
    const h = e.hold();
    let woke = 0;
    m.onWake(() => woke++);
    m.sync(116);
    woke = 0;
    h.step(100);
    expect(m.probe(a).x).toBe(200);
    expect(woke).toBeGreaterThan(0);
    h.free();
  });

  it('seeks back, and the page shows the earlier pose', () => {
    const { m, e } = setup();
    m.sync(300);
    const h = e.hold();
    expect(h.reach).toBe(0);
    h.seek(50);
    expect(m.probe(a).x).toBe(50);
    m.sync(400);
    expect(m.probe(a).x).toBe(50);
    h.free();
  });

  it('records nothing it does on the tape', () => {
    const { m, e } = setup();
    const t = m.tape as NonNullable<typeof m.tape>;
    const depth = t.undoDepth();
    const h = e.hold();
    h.rate = 2;
    h.step(50);
    h.seek(20);
    h.rate = 0;
    h.free();
    expect(t.undoDepth() + (t.branches().find((b) => b.current)?.length ?? 0)).toBe(depth);
  });

  it("carries on from where it was left, then makes the host's clock calls", () => {
    const { m, e } = setup();
    const h = e.hold();
    m.rate = 2;
    expect(m.rate).toBe(1);
    h.step(400);
    h.free();
    expect(m.rate).toBe(2);
    m.sync(5000);
    expect(m.probe(a).x).toBe(500);
    m.sync(5016);
    expect(m.probe(a).x).toBe(532);
  });

  it('leaves the calls ahead of a seek back on the tape, and plays them again', () => {
    const { m, e } = setup();
    const late = patch<Part, Pose>(0, () => ({ x: 1000 }), { writes: ['x'] });
    m.sync(200);
    m.cue({ patch: late, start: 200 });
    m.sync(300);
    const h = e.hold();
    h.seek(150);
    expect(m.probe(a).x).toBe(150);
    // The host's own call, made behind what the tape holds, is not recorded.
    const depth = (m.tape as NonNullable<typeof m.tape>).undoDepth();
    m.cue({ patch: patch<Part, Pose>(0, () => ({ x: 0 }), { writes: ['x'] }), start: 150 });
    expect((m.tape as NonNullable<typeof m.tape>).undoDepth()).toBe(depth);
    h.rate = 1;
    m.sync(400);
    expect(m.probe(a).x).toBe(250 + 1000);
    h.free();
  });

  it("makes the host's own seek once freed, not while held", () => {
    const { m, e } = setup();
    m.sync(300);
    const h = e.hold();
    m.seek(50);
    expect(m.probe(a).x).toBe(300);
    h.free();
    expect(m.probe(a).x).toBe(50);
  });

  it('hands a watcher the frames a hold plays', () => {
    const { m, e } = setup();
    const seen: number[] = [];
    const off = e.watch((f) => seen.push(f.probed[0]?.pose.x ?? Number.NaN));
    const h = e.hold();
    h.step(50);
    m.probe(a);
    h.step(50);
    m.probe(a);
    m.sync(116);
    expect(seen).toEqual([150, 200]);
    h.free();
    off();
  });

  it("plays the host's later calls at their own mix time after a paused seek back", () => {
    const m = mix<Part, Pose>(K, taped);
    const v = m.cue({ patch: clock, start: 0 });
    m.sync(0);
    m.sync(200);
    v.rate = 0;
    m.sync(300);
    const h = entryOf(m).hold();
    h.seek(150);
    m.sync(400);
    m.sync(1000);
    expect(m.probe(a).x).toBe(150);
    h.rate = 1;
    m.sync(1150);
    expect(m.probe(a).x).toBe(200);
    h.free();
  });

  it('seeks ahead while paused', () => {
    const { m, e } = setup();
    const h = e.hold();
    h.seek(500);
    expect(m.probe(a).x).toBe(500);
    h.free();
  });

  it("leaves the host's rate and its ramp as they were", () => {
    const { m, e } = setup();
    m.rate = 2;
    m.sync(200);
    const h = e.hold();
    h.rate = 0.5;
    m.sync(300);
    h.free();
    m.seek(250);
    m.sync(400);
    m.sync(500);
    expect(m.probe(a).x).toBeCloseTo(450, 6);
    m.ramp(3, 1000);
    m.sync(1000);
    const again = e.hold();
    again.free();
    // The gap to the host's next sync is the hold's, taken out; the ramp goes on after it.
    m.sync(3000);
    expect(m.rate).toBe(2.5);
    m.sync(3500);
    expect(m.rate).toBe(3);
  });

  it('steps from a rebase the host asked for before the hold', () => {
    const { m, e } = setup();
    m.rebase();
    const h = e.hold();
    h.step(100);
    expect(m.now).toBe(200);
    h.free();
  });

  it('refuses a bad rate from the host at once, and frees whatever a queued call throws', () => {
    const { m, e } = setup();
    const h = e.hold();
    expect(() => {
      m.rate = -1;
    }).toThrow(RangeError);
    h.free();
    const t = (m as unknown as { transport: { ramp: unknown } }).transport;
    expect(t.ramp).toBe(Object.getPrototypeOf(t).ramp);
  });

  it('refuses a second hold, and holds every mix on a shared transport', () => {
    const t = transport(taped);
    const one = mix<Part, Pose>(K, { transport: t });
    const two = mix<Part, Pose>(K, { transport: t });
    const h = entryOf(one).hold();
    expect(() => entryOf(two).hold()).toThrow(/held already/);
    expect(h.mixes).toEqual([one, two]);
    h.free();
    expect(() => entryOf(two).hold().free()).not.toThrow();
  });

  it('without history, reaches only now and cannot seek back', () => {
    const { e } = setup({});
    const h = e.hold();
    expect(h.reach).toBe(h.now);
    expect(() => h.seek(50)).toThrow(/history/);
    h.free();
  });
});

describe('closing a mix', () => {
  it('takes it off the list and tells listeners, once', () => {
    const m = mix<Part, Pose>(K, { name: 'closing' });
    const r = watched();
    const entry = r.entries().find((e) => e.mix === m);
    expect(entry).toBeDefined();
    const seen: unknown[] = [];
    const off = r.on((change) => seen.push(change));
    m.close();
    m.close();
    off();
    expect(r.entries().some((e) => e.mix === m)).toBe(false);
    expect(seen).toEqual([{ kind: 'gone', id: entry?.id }]);
  });
});
