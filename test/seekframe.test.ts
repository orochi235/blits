import { createHistory as tape } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import { transport } from '../src/transport.js';
import type { Handle, Mix } from '../src/types.js';
import { memoryStore } from './store.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });
interface Part {
  id: string;
}
const a = { id: 'a' };

const wave = patch<Part, Pose>(400, (phase) => ({ x: Math.sin(phase * 2 * Math.PI) * 10 }), {
  writes: ['x'],
});
const drift = patch<Part, Pose, { x: number }>(0, (_p, _s, st) => ({ x: st.state.x }), {
  writes: ['x'],
  state: () => ({ x: 0 }),
  step: (s, dt) => {
    s.x += (50 - s.x) * Math.min(1, dt / 200);
  },
});

const opts = () => ({ history: { ms: 100_000, every: 50, tape }, stepMs: 4 });
const frames = Array.from({ length: 61 }, (_, i) => i * 16);

/**
 * Rate 0 holds mix time at 480 from the frame at 480 to the one at 640, and the host cues a voice
 * and changes its weight while it does, so frames at one mix time show different poses.
 */
function scene(
  m: Mix<Part, Pose>,
  t: number,
  h: Record<string, Handle<Part>>,
  clock: { rate: number } = m,
) {
  if (t === 0) m.cue({ patch: drift });
  if (t === 480) clock.rate = 0;
  if (t === 560) h.v = m.cue({ patch: wave, weight: 0.5, start: m.now - 100 });
  if (t === 608) (h.v as { weight: number }).weight = 1;
  if (t === 640) clock.rate = 1;
}

function play() {
  const m = mix<Part, Pose>(K, opts());
  const h: Record<string, Handle<Part>> = {};
  const poses = new Map<number, number>();
  const seqs = new Map<number, number>();
  for (const t of frames) {
    m.sync(t);
    scene(m, t, h);
    poses.set(t, m.probe(a).x);
    seqs.set(t, m.seq);
  }
  return { m, poses, seqs };
}

describe('seek({ frame })', () => {
  it('numbers each frame, more with every sync', () => {
    const { seqs } = play();
    const numbers = frames.map((t) => seqs.get(t) as number);
    for (let i = 1; i < numbers.length; i++)
      expect(numbers[i] as number).toBeGreaterThan(numbers[i - 1] as number);
  });

  it('lands on an earlier frame at the same mix time, which a seek by time cannot', () => {
    const run = play();
    // Every frame from 480 to 624 stands at mix time 480, and they show three different poses.
    expect(new Set([544, 576, 608].map((t) => run.poses.get(t))).size).toBe(3);
    run.m.seek(480);
    expect(run.m.probe(a).x).toBe(run.poses.get(624));
    run.m.seek({ frame: run.seqs.get(576) as number });
    expect(run.m.now).toBe(480);
    expect(run.m.probe(a).x).toBe(run.poses.get(576));
  });

  it('plays on from that frame as the run played, its later calls made again', () => {
    const run = play();
    const last = frames[frames.length - 1] as number;
    run.m.seek({ frame: run.seqs.get(544) as number });
    expect(run.m.probe(a).x).toBe(run.poses.get(544));
    for (const t of frames.filter((t) => t > 544)) {
      run.m.sync(last + (t - 544));
      expect(run.m.probe(a).x).toBe(run.poses.get(t));
    }
  });

  it('lands on a frame where mix time moved as a seek to its time does', () => {
    const run = play();
    const ref = play();
    run.m.seek({ frame: run.seqs.get(320) as number });
    ref.m.seek(320);
    expect(run.m.probe(a).x).toBe(ref.m.probe(a).x);
    expect(run.m.probe(a).x).toBe(run.poses.get(320));
  });

  it('reads that frame through project too, moving nothing', () => {
    const run = play();
    const p = run.m.project({ frame: run.seqs.get(576) as number });
    expect(p.timestamp).toBe(480);
    expect(p.probe(a).x).toBe(run.poses.get(576));
    expect(run.m.probe(a).x).toBe(run.poses.get(960));
  });

  it("seeks to the current frame as a seek to the mix's own time does", () => {
    const run = play();
    const ref = play();
    run.m.seek({ frame: run.m.seq });
    ref.m.seek(ref.m.now);
    expect(run.m.now).toBe(ref.m.now);
    expect(run.m.probe(a).x).toBe(ref.m.probe(a).x);
  });

  it('refuses a frame its history does not hold', () => {
    const run = play();
    const at576 = run.seqs.get(576) as number;
    expect(() => run.m.seek({ frame: run.m.seq + 1 })).toThrow(/frame/);
    expect(() => run.m.seek({ frame: 0.5 })).toThrow(/frame/);
    expect(() => run.m.project({ frame: run.m.seq + 1 })).toThrow(/frame/);
    run.m.seek({ frame: run.seqs.get(544) as number });
    // A seek back lets go of the frames after the one it went to.
    expect(() => run.m.seek({ frame: at576 })).toThrow(/frame/);
    const bare = mix<Part, Pose>(K);
    bare.sync(0);
    expect(() => bare.seek({ frame: bare.seq })).toThrow(/history/);
  });

  it('moves every mix on a transport, by its number', () => {
    const tr = transport({ history: opts().history });
    const m = mix<Part, Pose>(K, { transport: tr, stepMs: 4 });
    const h: Record<string, Handle<Part>> = {};
    const poses = new Map<number, number>();
    const seqs = new Map<number, number>();
    for (const t of frames) {
      tr.sync(t);
      scene(m, t, h, tr);
      poses.set(t, m.probe(a).x);
      seqs.set(t, tr.seq);
      expect(m.seq).toBe(tr.seq);
    }
    tr.seek({ frame: seqs.get(592) as number });
    expect(m.probe(a).x).toBe(poses.get(592));
    expect(
      tr
        .project({ frame: seqs.get(544) as number })
        .of(m)
        .probe(a).x,
    ).toBe(poses.get(544));
  });

  it('reaches a frame paged to a store once prepare has loaded its time', async () => {
    const m = mix<Part, Pose>(K, {
      history: { ms: 200, tape, store: memoryStore() },
      keyOf: (p: Part) => p.id,
    });
    const h: Record<string, Handle<Part>> = {};
    const poses = new Map<number, number>();
    const seqs = new Map<number, number>();
    for (const t of frames) {
      m.sync(t);
      if (t === 480) m.rate = 0;
      if (t === 560) h.v = m.cue({ patch: wave, weight: 0.5, start: m.now - 100 });
      if (t === 608) (h.v as { weight: number }).weight = 1;
      if (t === 640) m.rate = 1;
      poses.set(t, m.probe(a).x);
      seqs.set(t, m.seq);
    }
    const frame = seqs.get(576) as number;
    expect(() => m.seek({ frame })).toThrow(/prepare/);
    await m.prepare(480);
    m.seek({ frame });
    expect(m.probe(a).x).toBe(poses.get(576));
  });
});
