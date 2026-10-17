import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { MixOptions } from '../src/types.js';

interface Pose {
  x: number;
  y: number;
}
const K = kit<Pose>({ x: sum(), y: sum() });
interface Part {
  id: string;
}
const watched = { id: 'watched' };
const late = { id: 'late' };

/** Writes the number of steps it has taken to `key`, and logs each step's gap and timestamp. */
function counting(key: 'x' | 'y', log: { dt: number; at: number; id: string }[]) {
  return patch<Part, Pose, { n: number }>(
    0,
    (_p, _s, st) => ({ [key]: st.state.n }) as Partial<Pose>,
    {
      writes: [key],
      state: () => ({ n: 0 }),
      step: (s, dt, subject, setting) => {
        s.n++;
        log.push({ dt, at: setting.timestamp, id: subject.id });
      },
    },
  );
}

// Integrates toward 50, so a subject caught up from its origin reads near 50 and one met fresh 0.
const drift = (key: 'x' | 'y') =>
  patch<Part, Pose, { v: number }>(0, (_p, _s, st) => ({ [key]: st.state.v }) as Partial<Pose>, {
    writes: [key],
    state: () => ({ v: 0 }),
    step: (s, dt) => {
      s.v += (50 - s.v) * Math.min(1, dt / 200);
    },
  });

function run(opts: MixOptions, frames: number[], meetAt: number) {
  const exact: { dt: number; at: number; id: string }[] = [];
  const fresh: { dt: number; at: number; id: string }[] = [];
  const m = mix<Part, Pose>(K, opts);
  m.cue({ patch: counting('x', exact) });
  m.cue({ patch: counting('y', fresh), catchUp: 'fresh' });
  const poses = new Map<number, { watched: Pose; late?: Pose }>();
  for (const t of frames) {
    m.sync(t);
    const p = { watched: { ...m.probe(watched) }, late: undefined as Pose | undefined };
    if (t >= meetAt) p.late = { ...m.probe(late) };
    poses.set(t, p);
  }
  const of = (log: typeof exact, id: string) => log.filter((e) => e.id === id);
  return { m, poses, exact: (id: string) => of(exact, id), fresh: (id: string) => of(fresh, id) };
}

describe("catchUp: 'fresh'", () => {
  it('starts a subject met late stepping from first sight, while an exact voice beside it catches up', () => {
    const r = run({}, [0, 16, 32, 48, 64], 48);
    expect(r.exact('late').map((e) => e.dt)).toEqual([48, 16]);
    expect(r.fresh('late').map((e) => e.dt)).toEqual([16]);
    expect(r.poses.get(48)?.late).toEqual({ x: 1, y: 0 });
    expect(r.poses.get(64)?.late).toEqual({ x: 2, y: 1 });
  });

  it('plays a subject met on time exactly as an exact voice does', () => {
    const r = run({}, [0, 16, 32, 48, 64], 48);
    expect(r.fresh('watched').map((e) => e.dt)).toEqual(r.exact('watched').map((e) => e.dt));
    for (const p of r.poses.values()) expect(p.watched.y).toBe(p.watched.x);
  });

  it('keeps the stepMs grid from the origin, running none of the intervals before first sight', () => {
    const r = run({ stepMs: 4 }, [0, 16, 32, 50, 64], 50);
    // Met at 50, 12 intervals had passed; the exact voice runs them, the fresh one starts after.
    expect(r.exact('late').filter((e) => e.at <= 50)).toHaveLength(12);
    expect(r.fresh('late').filter((e) => e.at <= 50)).toHaveLength(0);
    expect(r.fresh('late').map((e) => e.at)).toEqual([52, 56, 60, 64]);
    expect(r.exact('late').filter((e) => e.at > 50)).toEqual(r.fresh('late'));
  });

  it('meets a stateful subject with fresh state, where exact catch-up has it near where it settled', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: drift('x') });
    m.cue({ patch: drift('y'), catchUp: 'fresh' });
    for (let t = 0; t <= 800; t += 16) {
      m.sync(t);
      m.probe(watched);
    }
    const p = m.probe(late);
    expect(p.x).toBe(50);
    expect(p.y).toBe(0);
    expect(m.probe(watched).y).toBe(m.probe(watched).x);
  });

  it('still rebuilds from the voice start on a handle seek', () => {
    const log: { dt: number; at: number; id: string }[] = [];
    const m = mix<Part, Pose>(K, { stepMs: 4 });
    const h = m.cue({ patch: counting('y', log), catchUp: 'fresh' });
    m.sync(0);
    m.probe(watched);
    m.sync(16);
    m.probe(watched);
    h.seek(100);
    m.probe(watched);
    expect(m.probe(watched).y).toBe(25);
  });

  it('says a read ahead cannot know the state of a subject it meets late', () => {
    const m = mix<Part, Pose>(K);
    m.cue({ patch: drift('x') });
    m.cue({ patch: drift('y'), catchUp: 'fresh' });
    m.sync(0);
    m.probe(watched);
    const ahead = m.project(400);
    expect(ahead.assess(late)).toEqual({ x: 'stepped', y: 'held' });
    expect(ahead.assess(watched)).toEqual({ x: 'stepped', y: 'stepped' });
  });

  it('seeks back and plays on as it played, under history', () => {
    const frames = Array.from({ length: 41 }, (_, i) => i * 16);
    const opts = (): MixOptions => ({ history: { ms: 10_000, every: 50, tape }, stepMs: 4 });
    const ref = run(opts(), frames, 160);
    const again = run(opts(), frames, 160);
    again.m.seek(320);
    const last = frames[frames.length - 1] as number;
    for (const t of frames.filter((t) => t > 320)) {
      again.m.sync(last + (t - 320));
      expect(again.m.probe(watched)).toEqual(ref.poses.get(t)?.watched);
      expect(again.m.probe(late)).toEqual(ref.poses.get(t)?.late);
    }
  });

  it('refuses a catchUp that is neither exact nor fresh', () => {
    const m = mix<Part, Pose>(K);
    expect(() => m.cue({ patch: drift('x'), catchUp: 'soon' as 'fresh' })).toThrow(/catchUp/);
  });
});
