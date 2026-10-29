// @vitest-environment happy-dom

import { kit, mix, patch, sum, vec } from '@msb235/blits';
import { createHistory as tape } from '@weasel-js/history';
import { afterEach, describe, expect, it } from 'vitest';
import { agent, flatten } from '../src/agent.js';
import type { Event } from '../src/protocol.js';

interface Pose {
  x: number;
  at: number[];
}
const K = kit<Pose>({ x: sum(), at: vec(2, sum()) });
/** x reads the voice's elapsed ms. */
const clock = patch<unknown, Pose>(100_000, (p) => ({ x: p * 100_000, at: [1, 2] }), {
  writes: ['x', 'at'],
});

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  document.body.innerHTML = '';
});

function setup(opts: Parameters<typeof agent>[0] = {}) {
  const a = agent(opts);
  disposers.push(() => a.dispose());
  const events: Event[] = [];
  a.subscribe((e) => events.push(e));
  const last = <K extends Event['kind']>(kind: K) =>
    [...events].reverse().find((e) => e.kind === kind) as Extract<Event, { kind: K }> | undefined;
  return { a, events, last };
}

describe('flatten', () => {
  it('keys each number of a pose by where it sits', () => {
    expect(flatten({ x: 1, at: [2, 3], c: { l: 0.5, name: 'n' } })).toEqual({
      x: 1,
      'at[0]': 2,
      'at[1]': 3,
      'c.l': 0.5,
    });
  });
});

describe('the agent', () => {
  it('lists the mixes, and sends the picked subject each frame the host read', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-a' });
    const el = document.createElement('div');
    document.body.appendChild(el);
    m.cue({ patch: clock, start: 0, subjects: [el], name: 'tick' });
    const { a, last, events } = setup();
    const info = last('mixes')?.mixes.find((x) => x.name === 'agent-a');
    expect(info?.channels).toEqual(['x', 'at']);
    a.send({ kind: 'mix', id: info?.id as number });
    const listed = last('subjects')?.subjects ?? [];
    expect(listed).toHaveLength(1);
    a.send({ kind: 'subject', id: listed[0]?.id as number });
    m.sync(0);
    m.probe(el);
    m.sync(100);
    m.probe(el);
    m.sync(200);
    const samples = events.flatMap((e) => (e.kind === 'samples' ? e.samples : []));
    expect(samples.map((s) => [s.now, s.values.x, s.read])).toEqual([
      [0, 0, false],
      [100, 100, false],
    ]);
    expect(samples[1]?.values['at[1]']).toBe(2);
    expect(last('voices')?.voices[0]?.name).toBe('tick');
    expect(JSON.parse(JSON.stringify(events))).toBeTruthy();
  });

  it('reads a subject the host did not read, and fills its past from history', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-b', history: { ms: 1000 } });
    m.cue({ patch: clock, start: 0, subjects: ['s'] });
    m.sync(0);
    m.sync(500);
    const { a, last, events } = setup();
    const id = last('mixes')?.mixes.find((x) => x.name === 'agent-b')?.id as number;
    a.send({ kind: 'mix', id });
    a.send({ kind: 'subject', id: last('subjects')?.subjects[0]?.id as number });
    const fill = [...events].reverse().find((e) => e.kind === 'samples' && e.reset);
    expect(fill?.kind === 'samples' && fill.samples.map((s) => s.now)).toEqual([
      0, 100, 200, 300, 400,
    ]);
    m.probe('other');
    m.sync(516);
    const s = last('samples')?.samples[0];
    expect(s?.read).toBe(true);
    expect(s?.values.x).toBe(500);
  });

  it('holds, steps and frees the clock, and frees it on a switch to another mix', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-c', history: { ms: 1000, tape } });
    const other = mix<unknown, Pose>(K, { name: 'agent-d' });
    m.cue({ patch: clock, start: 0 });
    m.sync(0);
    m.sync(100);
    const { a, last } = setup();
    const ids = last('mixes')?.mixes ?? [];
    a.send({ kind: 'mix', id: ids.find((x) => x.name === 'agent-c')?.id as number });
    a.send({ kind: 'hold', on: true });
    expect(last('hold')?.hold.state).toBe('held');
    a.send({ kind: 'step', ms: 50 });
    expect(m.now).toBe(150);
    a.send({ kind: 'seek', to: 20 });
    expect(m.now).toBe(20);
    a.send({ kind: 'mix', id: ids.find((x) => x.name === 'agent-d')?.id as number });
    expect(last('hold')?.hold.state).toBe('free');
    expect(m.seek).toBe(Object.getPrototypeOf(m).seek);
    expect(other).toBeDefined();
  });

  it('sends the plan ahead on the mix clock: voice marks, announced marks, and no end for a loop', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-plan' });
    m.sync(0);
    m.sync(100);
    // Host time from here on runs 5000 ahead of mix time.
    m.rebase();
    m.sync(5100);
    const once = patch<unknown, Pose>(1000, () => ({ x: 1 }), { writes: ['x'] });
    const v = m.cue({ patch: once, start: 5600, subjects: ['s'], name: 'once' });
    const loop = m.cue({ patch: once, start: 5600, subjects: ['s'], name: 'loop', loop: true });
    m.announce('beat', { at: 6100 });
    const { a, last } = setup();
    a.send({
      kind: 'mix',
      id: last('mixes')?.mixes.find((x) => x.name === 'agent-plan')?.id as number,
    });
    const marks = last('marks')?.marks ?? [];
    const of = (id: number) => marks.filter((k) => k.voice === id);
    expect(of(v.id).find((k) => k.mark === 'start')?.at).toBe(600);
    expect(of(v.id).find((k) => k.mark === 'end')?.at).toBe(1600);
    expect(of(v.id)[0]?.name).toBe('once');
    expect(of(loop.id).map((k) => k.mark)).not.toContain('end');
    expect(marks.find((k) => k.voice === null)).toMatchObject({
      at: 1100,
      name: 'beat',
      mark: null,
    });
    expect(marks.map((k) => k.at)).toEqual([...marks.map((k) => k.at)].sort((x, y) => x - y));
  });

  it('says a clock is held elsewhere', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-e' });
    m.sync(0);
    const { a, last } = setup();
    const { a: b } = setup();
    const id = last('mixes')?.mixes.find((x) => x.name === 'agent-e')?.id as number;
    b.send({ kind: 'mix', id });
    b.send({ kind: 'hold', on: true });
    a.send({ kind: 'mix', id });
    a.send({ kind: 'hold', on: true });
    expect(last('hold')?.hold.state).toBe('elsewhere');
    b.send({ kind: 'hold', on: false });
    a.send({ kind: 'hold', on: true });
    expect(last('hold')?.hold.state).toBe('held');
  });

  it('picks a DOM subject on the page, from an element inside it', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-f' });
    const card = document.createElement('section');
    const inner = document.createElement('span');
    card.appendChild(inner);
    document.body.appendChild(card);
    m.cue({ patch: clock, subjects: [card] });
    const { a, last } = setup();
    a.send({ kind: 'arm', on: true });
    expect(last('arming')?.on).toBe(true);
    document.elementsFromPoint = () => [inner, card, document.body];
    inner.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 5, clientY: 5 }));
    expect(last('arming')?.on).toBe(false);
    const picked = last('picked');
    expect(picked?.mix).toBe(last('mixes')?.mixes.find((x) => x.name === 'agent-f')?.id);
    expect(picked?.subject).not.toBeNull();
  });

  it('picks through the app’s own function for subjects the DOM cannot see', () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-g' });
    const mesh = { name: 'mesh' };
    m.cue({ patch: clock, subjects: [mesh] });
    const { a, last } = setup({ pick: () => mesh });
    a.send({ kind: 'arm', on: true });
    document.elementsFromPoint = () => [document.body];
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 1, clientY: 1 }));
    expect(last('subjects')?.subjects.find((s) => s.id === last('picked')?.subject)?.label).toBe(
      'mesh',
    );
  });

  it("draws each bounded voice's circle on the page, through the app's screen, while asked, and no finder's", () => {
    const m = mix<unknown, Pose>(K, { name: 'agent-h' });
    const dot = { name: 'dot' };
    m.plot([dot], new Float64Array([0, 0]));
    const area = { x: 10, y: 20, r: 5 };
    m.cue({ patch: clock, weight: () => 1, within: area });
    m.cue({ patch: clock, subjects: [dot] });
    m.cue({ patch: clock, weight: () => 1, within: { find: () => 0 } });
    const { a, last } = setup({ screen: (x, y) => ({ x: x * 2, y: y * 2 }) });
    a.send({
      kind: 'mix',
      id: last('mixes')?.mixes.find((x) => x.name === 'agent-h')?.id as number,
    });
    expect(last('voices')?.voices.map((v) => v.bounded)).toEqual([true, false, true]);
    const svg = () => document.querySelector('[data-blits-panel="circles"]');
    expect(svg()).toBeNull();
    a.send({ kind: 'circles', on: true });
    expect(last('circles')?.on).toBe(true);
    const c = () => svg()?.querySelector('circle');
    expect([c()?.getAttribute('cx'), c()?.getAttribute('cy'), c()?.getAttribute('r')]).toEqual([
      '20',
      '40',
      '10',
    ]);
    expect(svg()?.querySelectorAll('circle').length).toBe(1);
    area.x = 15;
    m.sync(0);
    m.probe(dot);
    m.sync(16);
    expect(c()?.getAttribute('cx')).toBe('30');
    a.send({ kind: 'circles', on: false });
    expect(svg()).toBeNull();
  });
});
