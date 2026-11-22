// @vitest-environment happy-dom
import { agent } from '@msb235/blits-panel';
import { compile } from '@pg/blits/compile';
import { Player } from '@pg/blits/player';
import { describe, expect, it } from 'vitest';
import { comp, play, step, subjects, voice } from './helpers';

type Event = Parameters<Parameters<ReturnType<typeof agent>['subscribe']>[0]>[0];

const c = comp([
  voice({
    id: 'a',
    patch: {
      kind: 'keys',
      period: 1000,
      stops: [
        { at: 0, delta: { turn: 0 } },
        { at: 1, delta: { turn: 90 } },
      ],
      ease: 'linear',
    },
  }),
]);

describe("the debug panel's hold across a rebuild", () => {
  it('is let go with the closed mix, and the score plays on at its own rate', () => {
    const p = new Player(
      (listed) => compile(c, subjects, { solos: true, name: 'held', listed }),
      subjects,
    );
    const a = agent();
    const events: Event[] = [];
    a.subscribe((e) => events.push(e));
    const last = <K extends Event['kind']>(kind: K) =>
      [...events].reverse().find((e) => e.kind === kind) as Extract<Event, { kind: K }>;
    try {
      play(p, 500);
      const id = last('mixes').mixes.find((m) => m.name === 'held')?.id as number;
      a.send({ kind: 'mix', id });
      a.send({ kind: 'hold', on: true });
      a.send({ kind: 'rate', rate: 0 });
      step(p, 5);
      const t = p.t;
      expect(p.following).toBe(true);
      expect(last('hold').hold.state).toBe('held');

      p.rebuild();
      expect(p.t).toBe(t);
      expect(last('hold').hold.state).toBe('free');
      step(p, 5);
      expect(p.t).toBeGreaterThan(t);
    } finally {
      a.dispose();
      p.list(false);
    }
  });
});
