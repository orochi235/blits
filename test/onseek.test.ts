import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, last, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Sought } from '../src/types.js';
import { messages, thrownLater } from './later.js';

const K = kit<{ x: number }>({ x: sum() });
const ramp = patch<object, { x: number }>(1000, (p) => ({ x: p }), { writes: ['x'] });
const history = { ms: 10_000, tape };

/** A mix playing a ramp on `dot`, synced every 100 ms from 0 to `to`. */
function played(to: number) {
  const m = mix<object, { x: number }>(K, { history, name: 'm' });
  const dot = {};
  m.cue({ patch: ramp, subjects: [dot] });
  for (let t = 0; t <= to; t += 100) m.sync(t);
  return { m, dot, x: () => m.probe(dot).x };
}

describe('onSeek', () => {
  it('tells where each seek landed, back or forward, with no sync between, read at the time sought', () => {
    const { m, x } = played(800);
    const heard: (Sought & { x: number; now: number })[] = [];
    m.onSeek((s) => heard.push({ ...s, x: x(), now: m.now }));
    const kept = m.seq - 4;
    m.seek(400);
    m.seek(600);
    expect(heard).toEqual([
      { at: 400, frame: kept, back: true, x: 0.4, now: 400 },
      { at: 600, frame: m.seq, back: false, x: 0.6, now: 600 },
    ]);
  });

  it('tells the transport and every mix on it, and stops once unsubscribed', () => {
    const t = transport({ history });
    const a = mix<object, { x: number }>(K, { transport: t, name: 'a' });
    const b = mix<object, { x: number }>(K, { transport: t, name: 'b' });
    for (let at = 0; at <= 500; at += 100) t.sync(at);
    const heard: string[] = [];
    t.onSeek((s) => heard.push(`t ${s.at}`));
    const off = a.onSeek((s) => heard.push(`a ${s.at}`));
    b.onSeek((s) => heard.push(`b ${s.at}`));
    t.seek(200);
    off();
    t.seek(300);
    expect(heard).toEqual(['t 200', 'a 200', 'b 200', 't 300', 'b 300']);
  });

  for (const lanes of [true, false]) {
    it(`stops telling a seek once a listener seeks again, so the last heard is where it stands${lanes ? '' : ', without lanes'}`, () => {
      const m = mix<object, { x: number }>(K, { history, name: 'm', lanes });
      m.cue({ patch: ramp, subjects: [{}] });
      for (let t = 0; t <= 800; t += 100) m.sync(t);
      const heard: number[] = [];
      m.onSeek((s) => {
        if (s.at === 400) m.seek(200);
      });
      m.onSeek((s) => heard.push(s.at));
      m.seek(400);
      expect(m.now).toBe(200);
      expect(heard).toEqual([200]);
    });

    it(`goes on past a listener that throws, to every mix on the transport${lanes ? '' : ', without lanes'}`, () => {
      const t = transport({ history });
      const a = mix<object, { x: number }>(K, { transport: t, name: 'a', lanes });
      const b = mix<object, { x: number }>(K, { transport: t, name: 'b', lanes });
      for (let at = 0; at <= 500; at += 100) t.sync(at);
      const heard: string[] = [];
      a.onSeek(() => {
        throw new Error('a');
      });
      a.onSeek((s) => heard.push(`a ${s.at}`));
      b.onSeek((s) => heard.push(`b ${s.at}`));
      const errors = thrownLater(() => t.seek(200));
      expect(messages(errors)).toEqual(['a']);
      expect(heard).toEqual(['a 200', 'b 200']);
    });
  }
});

describe('call', () => {
  /** A mix with a log a driver's call writes to, and a seek handler cutting it as a driver would. */
  function driven() {
    const { m, dot, x } = played(0);
    const log: { at: number; seq: number; v: number }[] = [];
    m.onSeek((s) => {
      if (s.back) log.splice(0, log.length, ...log.filter((e) => e.seq <= s.frame));
    });
    const kick = (v: number) => m.call('kick', () => log.push({ at: m.now, seq: m.seq, v }));
    return { m, dot, x, log, kick, ats: () => log.map((e) => [e.at, e.v]) };
  }

  it('makes the call now, and again as the mix plays past it after a seek back', () => {
    const d = driven();
    for (let t = 100; t <= 800; t += 100) {
      d.m.sync(t);
      if (t === 300) d.kick(1);
      if (t === 500) d.kick(2);
    }
    expect(d.ats()).toEqual([
      [300, 1],
      [500, 2],
    ]);
    d.m.seek(200);
    expect(d.ats()).toEqual([]);
    for (let t = 900; t <= 1200; t += 100) d.m.sync(t);
    expect(d.ats()).toEqual([
      [300, 1],
      [500, 2],
    ]);
  });

  it('makes it again on a seek forward, and only once though it cues inside', () => {
    const d = driven();
    const other = {};
    d.m.sync(100);
    d.m.call('add', () => {
      d.log.push({ at: d.m.now, seq: d.m.seq, v: 0 });
      d.m.cue({ patch: ramp, subjects: [other] });
    });
    for (let t = 200; t <= 500; t += 100) d.m.sync(t);
    d.m.seek(50);
    expect(d.m.voices()).toHaveLength(1);
    d.m.seek(400);
    expect(d.ats()).toEqual([[100, 0]]);
    expect(d.m.voices()).toHaveLength(2);
  });

  it('lets go of the calls ahead when the host makes another after a seek back, until switchBranch', () => {
    const d = driven();
    for (let t = 100; t <= 600; t += 100) {
      d.m.sync(t);
      if (t === 400) d.kick(1);
    }
    d.m.seek(200);
    d.m.sync(700);
    d.m.cue({ patch: ramp, subjects: [{}] });
    for (let t = 800; t <= 1100; t += 100) d.m.sync(t);
    expect(d.ats()).toEqual([]);

    d.m.seek(200);
    const branches = d.m.tape?.branches() ?? [];
    const old = branches.find((b) => !b.current) as { id: number };
    d.m.tape?.switchBranch(old.id);
    for (let t = 1200; t <= 1500; t += 100) d.m.sync(t);
    expect(d.ats()).toEqual([[400, 1]]);
  });

  it('is not made by a read ahead, and only called without a tape', () => {
    const d = driven();
    for (let t = 100; t <= 600; t += 100) {
      d.m.sync(t);
      if (t === 400) d.kick(1);
    }
    d.m.seek(200);
    d.m.project(500);
    expect(d.ats()).toEqual([]);

    const bare = mix<object, { x: number }>(K);
    let made = 0;
    bare.call('kick', () => made++);
    expect(made).toBe(1);
  });

  for (const lanes of [true, false])
    it(`keeps a voice it cues ahead of those cued after it, made again after a seek back${lanes ? '' : ', without lanes'}`, () => {
      const L = kit<{ x: number }>({ x: last<number>() });
      const val = (v: number) =>
        patch<object, { x: number }>(10_000, () => ({ x: v }), { writes: ['x'] });
      const m = mix<object, { x: number }>(L, { lanes, history: { ms: 100_000, every: 50, tape } });
      const dot = {};
      const seen = new Map<number, number>();
      for (let t = 0; t <= 400; t += 20) {
        m.sync(t);
        if (t === 100) m.call('driver', () => m.cue({ patch: val(1) }));
        if (t === 200) m.cue({ patch: val(2) });
        seen.set(t, m.probe(dot).x);
      }
      expect(seen.get(300)).toBe(2);
      m.seek(60);
      for (let t = 420; t <= 660; t += 20) {
        m.sync(t);
        expect([m.now, m.probe(dot).x]).toEqual([m.now, seen.get(m.now)]);
      }
    });
});

describe.each([true, false])('an onWake listener, lanes %s', (lanes) => {
  it('that throws leaves a cue made and taped, and the listeners after it told', () => {
    const m = mix<object, { x: number }>(K, { history, name: 'm', lanes });
    const dot = {};
    m.sync(0);
    m.sync(100);
    let woke = 0;
    const off = m.onWake(() => {
      throw new Error('boom');
    });
    m.onWake(() => woke++);
    const errors = thrownLater(() => m.cue({ patch: ramp, subjects: [dot] }));
    off();
    expect(messages(errors)).toEqual(['boom']);
    expect(woke).toBe(1);
    m.sync(200);
    m.sync(300);
    const live = m.probe(dot).x;
    m.seek(50);
    m.seek(300);
    expect(m.probe(dot).x).toBe(live);
    expect(m.voices().length).toBe(1);
  });

  it('that throws leaves a rate write taped', () => {
    const long = patch<object, { x: number }>(10_000, (p) => ({ x: p }), { writes: ['x'] });
    const m = mix<object, { x: number }>(K, { history: { ms: 100_000, tape }, name: 'r', lanes });
    const dot = {};
    m.cue({ patch: long, subjects: [dot] });
    for (const t of [0, 100, 200]) m.sync(t);
    const off = m.onWake(() => {
      throw new Error('rate');
    });
    const errors = thrownLater(() => {
      m.rate = 0;
    });
    off();
    expect(messages(errors)).toEqual(['rate']);
    m.sync(300);
    m.sync(400);
    const live = [m.now, m.probe(dot).x];
    m.seek(100);
    for (const t of [500, 600, 700]) m.sync(t);
    expect([m.now, m.probe(dot).x]).toEqual(live);
    expect(m.rate).toBe(0);
  });

  it('that throws leaves a seek whole, and its onSeek listeners told', () => {
    const m = mix<object, { x: number }>(K, { history, name: 'm', lanes });
    m.cue({ patch: ramp, subjects: [{}] });
    for (let t = 0; t <= 800; t += 100) m.sync(t);
    const heard: number[] = [];
    m.onSeek((s) => heard.push(s.at));
    const off = m.onWake(() => {
      throw new Error('seek');
    });
    const errors = thrownLater(() => m.seek(400));
    off();
    expect(messages(errors)).toEqual(['seek']);
    expect(m.now).toBe(400);
    expect(heard).toEqual([400]);
  });

  it('is told of a seek once every mix on the transport is back', () => {
    const t = transport({ history });
    const a = mix<object, { x: number }>(K, { transport: t, name: 'a', lanes });
    const b = mix<object, { x: number }>(K, { transport: t, name: 'b', lanes });
    const da = {};
    const db = {};
    a.cue({ patch: ramp, subjects: [da] });
    b.cue({ patch: ramp, subjects: [db] });
    for (let at = 0; at <= 800; at += 100) {
      t.sync(at);
      a.probe(da);
      b.probe(db);
    }
    const seen: number[][] = [];
    a.onWake(() => seen.push([a.now, b.now, b.probe(db).x]));
    t.seek(300);
    expect(seen).toEqual([[300, 300, b.probe(db).x]]);
    expect(seen[0]?.[2]).toBeCloseTo(0.3);
  });
});
