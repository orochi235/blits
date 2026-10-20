// @vitest-environment happy-dom
import { kit, mix, sum } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { agent } from '../src/agent.js';
import type { Event } from '../src/protocol.js';
import { decode, encode, serve, type Wire, wireSource } from '../src/wire.js';

/** Two wire ends joined in memory, each delivering what the other sends. */
function joined(): [Wire, Wire] {
  const ends = [new Set<(t: string) => void>(), new Set<(t: string) => void>()];
  const end = (i: 0 | 1): Wire => ({
    send: (text) => {
      for (const fn of [...(ends[1 - i] as Set<(t: string) => void>)]) fn(text);
    },
    listen(fn) {
      (ends[i] as Set<(t: string) => void>).add(fn);
      return () => (ends[i] as Set<(t: string) => void>).delete(fn);
    },
  });
  return [end(0), end(1)];
}

describe('the wire', () => {
  it('keeps NaN and the infinities across JSON', () => {
    const v = { a: Number.NaN, b: [Number.POSITIVE_INFINITY, -Infinity, 1], c: { $n: 'x', d: 2 } };
    expect(decode(encode(v))).toEqual(v);
  });

  it('carries the agent across: the state on subscribing, and commands back', () => {
    const m = mix<unknown, { x: number }>(kit<{ x: number }>({ x: sum() }), { name: 'wired' });
    m.sync(0);
    const [page, panel] = joined();
    const a = agent();
    const stop = serve(a, page);
    const source = wireSource(panel);
    const events: Event[] = [];
    source.subscribe((e) => events.push(e));
    const mixes = events.find((e) => e.kind === 'mixes');
    const id =
      mixes?.kind === 'mixes' ? mixes.mixes.find((x) => x.name === 'wired')?.id : undefined;
    expect(id).toBeDefined();
    source.send({ kind: 'mix', id: id as number });
    source.send({ kind: 'hold', on: true });
    const hold = [...events].reverse().find((e) => e.kind === 'hold');
    expect(hold?.kind === 'hold' && hold.hold.state).toBe('held');
    expect(hold?.kind === 'hold' && Number.isNaN(hold.hold.rate)).toBe(false);
    events.length = 0;
    source.refresh();
    expect(events.some((e) => e.kind === 'mixes')).toBe(true);
    stop();
    a.dispose();
    source.close();
  });
});
