import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Sought } from '../src/types.js';

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
});
