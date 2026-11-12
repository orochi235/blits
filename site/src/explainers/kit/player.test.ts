import { kit, type Mix, patch, sum, watched } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { Player } from './player';
import { FRAME, type Scene } from './scene';

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

  it('keeps the ledger where a debugger ran the main mix back to, and seeks it back later', () => {
    const ledgered: Scene<string, Pose, object> = {
      ...scene,
      voices: () => [
        {
          name: 'rise',
          color: 'v1',
          spec: { patch: patch(500, (p) => ({ x: p }), { writes: ['x'] }), loop: true },
        },
      ],
      events: () => [{ at: 500, run: (m) => m.mute({ over: 300 }) }],
      ledger: { subject: (s) => s[0] as string, channels: ['x'] },
    };
    const duration = 1500;
    const p = new Player(ledgered, {}, { name: 'player-reverse', duration });
    const m = mixOf(p);
    const solo = (p as unknown as { solos: { mix: Mix<string, Pose> }[] }).solos[0]?.mix;
    // As the explainer plays: a frame at a time, out to the end and back, following the mix.
    let t = 0;
    let way = 1;
    const frame = () => {
      t += FRAME * way;
      if (t >= duration) {
        way = -1;
        t = 2 * duration - t;
      }
      t = p.at(Math.max(0, t)).t;
      expect(solo?.now).toBe(m.now);
    };
    for (let i = 0; i < 60; i++) frame();
    m.rate = -1;
    for (let i = 0; i < 30; i++) frame();
    m.rate = 1;
    for (let i = 0; i < 180; i++) frame();
    expect(way).toBe(-1);
    expect(m.now).toBeLessThan(500);
    p.close();
  });

  it.each([0.5, 1.5])(
    'keeps the run on the mix clock where a debugger set its rate to %s for a while',
    (rate) => {
      const looped: Scene<string, Pose, object> = {
        ...scene,
        voices: () => [
          {
            name: 'rise',
            color: 'v1',
            spec: { patch: patch(500, (p) => ({ x: p }), { writes: ['x'] }), loop: true },
          },
        ],
      };
      const duration = 8000;
      const p = new Player(looped, {}, { name: `player-rate-${rate}`, duration });
      const m = mixOf(p);
      let t = 0;
      let way = 1;
      const frame = () => {
        t += FRAME * way;
        if (t >= duration) {
          way = -1;
          t = 2 * duration - t;
        }
        t = p.at(Math.max(0, t)).t;
      };
      for (let i = 0; i < 60; i++) frame();
      const lead = m.now - t;
      m.rate = rate;
      for (let i = 0; i < 150; i++) frame();
      expect(m.now - t - lead).toBeGreaterThanOrEqual(-1e-6);
      expect(m.now - t - lead).toBeLessThan(FRAME);
      m.rate = 1;
      // Out past the boomerang and back to the start, which seeks to the run's first frames.
      while (way === 1) frame();
      while (t > 0) frame();
      expect(m.now - t - lead).toBeLessThan(FRAME);
      p.close();
    },
  );

  it("plays back through a debugger's hold that sought back past where it was going", () => {
    const duration = 1000;
    const p = new Player(scene, {}, { name: 'player-held-back', duration });
    const m = mixOf(p);
    for (let t = 0; t <= 600; t += FRAME) p.at(t);
    const entry = watched()
      .entries()
      .find((e) => e.mix === (m as unknown));
    const h = (entry as NonNullable<typeof entry>).hold();
    h.step(30);
    p.at(500);
    h.seek(h.now - 300);
    expect(() => h.free()).not.toThrow();
    // The next frame follows the mix to where the hold's free left it, rather than moving it on.
    const now = m.now;
    p.at(450);
    expect(m.now).toBe(now);
    for (let t = 450; t > 0; t -= FRAME) p.at(t);
    expect(p.at(0).t).toBe(0);
    p.close();
  });
});
