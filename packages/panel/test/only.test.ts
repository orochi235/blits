// @vitest-environment happy-dom

import { kit, mix, sum } from '@msb235/blits';
import { expect, it } from 'vitest';
import { agent } from '../src/agent.js';
import type { Event } from '../src/protocol.js';

const K = kit<{ x: number }>({ x: sum() });

function setup() {
  const a = agent();
  const events: Event[] = [];
  a.subscribe((e) => events.push(e));
  const last = <K extends Event['kind']>(kind: K) =>
    [...events].reverse().find((e) => e.kind === kind) as Extract<Event, { kind: K }> | undefined;
  return { a, last };
}

it('picks the only mix on the page, and nothing once there are two', () => {
  const first = setup();
  expect(first.last('picked')?.mix).toBeNull();
  const kept = [mix<unknown, { x: number }>(K, { name: 'only-a' })];
  const id = first.last('mixes')?.mixes[0]?.id;
  expect(first.last('picked')?.mix).toBe(id);

  const later = setup();
  expect(later.last('picked')?.mix).toBe(id);

  kept.push(mix<unknown, { x: number }>(K, { name: 'only-b' }));
  expect(first.last('picked')?.mix).toBe(id);
  first.a.send({ kind: 'mix', id: null });
  expect(first.last('picked')?.mix).toBeNull();
  expect(setup().last('picked')?.mix).toBeNull();

  for (const x of [first, later]) x.a.dispose();
  expect(kept).toHaveLength(2);
});
