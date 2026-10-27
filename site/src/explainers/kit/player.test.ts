import { kit, type Mix, patch, sum } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { Player } from './player';
import type { Scene } from './scene';

type Pose = { x: number };
const scene: Scene<string, Pose, object> = {
  kit: kit<Pose>({ x: sum() }),
  subjects: () => ['s'],
  voices: () => [
    {
      name: 'rise',
      color: 'v1',
      spec: { patch: patch(500, (p) => ({ x: p }), { writes: ['x'] }), subjects: ['s'] },
    },
  ],
};

const mixOf = (p: Player<string, Pose, object>) =>
  (p as unknown as { main: { mix: Mix<string, Pose> } }).main.mix;

/** Each `end` the host announced, as mix time. */
function ends(p: Player<string, Pose, object>): number[] {
  const m = mixOf(p);
  return m
    .marks(Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY)
    .filter((k) => k.voice === undefined && k.name === 'end')
    .map((k) => m.now + (k.timestamp - m.timestamp));
}

describe('the explainer player', () => {
  it('announces where the run ends once, and keeps it there through a replay', () => {
    const duration = 1000;
    const p = new Player(scene, {}, { name: 'player-end', duration });
    p.at(0);
    const [end] = ends(p);
    expect(ends(p)).toHaveLength(1);
    expect((end as number) - mixOf(p).now).toBeCloseTo(duration);
    for (const t of [duration, duration / 2, 0, duration, 300]) {
      p.at(t);
      expect(ends(p)).toHaveLength(1);
      expect(ends(p)[0]).toBeCloseTo(end as number);
    }
    p.at(duration);
    expect(mixOf(p).now).toBeCloseTo(end as number);
    p.close();
  });

  it('announces nothing for a run nobody watches', () => {
    const p = new Player(scene, {}, { duration: 1000, listed: false });
    p.at(1000);
    expect(ends(p)).toEqual([]);
  });
});
