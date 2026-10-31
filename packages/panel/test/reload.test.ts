// @vitest-environment happy-dom
import { kit, mix, patch, sum } from '@msb235/blits';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agent } from '../src/agent.js';
import type { Event } from '../src/protocol.js';
import { serve, type Wire, wireSource } from '../src/wire.js';

type Pose = { x: number };
const K = kit<Pose>({ x: sum() });
const still = patch<unknown, Pose>(100_000, () => ({ x: 1 }), { writes: ['x'] });

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

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const d of disposers.splice(0)) d();
  vi.useRealTimers();
});

describe('a reloaded panel', () => {
  it('a panel that reloads and refreshes gets the picked mix’s subject list again', () => {
    vi.useFakeTimers();
    const m = mix<unknown, Pose>(K, { name: 'reload' });
    m.cue({ patch: still, start: 0, subjects: ['s1', 's2'] });
    m.sync(0);
    const a = agent();
    disposers.push(() => a.dispose());
    const [page, panel] = joined();
    disposers.push(serve(a, page));

    const first = wireSource(panel);
    const seen1: Event[] = [];
    first.subscribe((e) => seen1.push(e));
    const id = [...seen1].reverse().find((e) => e.kind === 'mixes');
    const mixId = id?.kind === 'mixes' ? id.mixes.find((x) => x.name === 'reload')?.id : -1;
    first.send({ kind: 'mix', id: mixId as number });
    expect(seen1.some((e) => e.kind === 'subjects' && e.subjects.length === 2)).toBe(true);
    first.close();

    // The panel reloads: a new wire source on the same channel, which says hello.
    const second = wireSource(panel);
    const seen2: Event[] = [];
    second.subscribe((e) => seen2.push(e));
    expect(seen2.some((e) => e.kind === 'picked' && e.mix === mixId)).toBe(true);
    vi.advanceTimersByTime(2000);
    expect({
      subjects: seen2.some((e) => e.kind === 'subjects' && e.subjects.length === 2),
      voices: seen2.some((e) => e.kind === 'voices' && e.voices.length === 1),
    }).toEqual({ subjects: true, voices: true });
  });
});
