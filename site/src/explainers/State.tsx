import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { numberLine, trace } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';
import { timeline } from './Time';

interface Pose {
  x: number;
}

interface Spring {
  x: number;
  v: number;
}

interface Subject {
  name: string;
}

const steady: Subject = { name: 'Probed every frame' };
const gap: Subject = { name: 'Left unprobed' };
const DURATION = 6000;
const AWAY = { from: 1700, to: 2900 };
const STIFFNESS = 150;
const DAMPING = 8;

/** Where the spring is pulled to: 1, then 0, flipping every 1.5 s of mix time. */
const target = (ms: number) => (Math.floor(ms / 1500) % 2 === 0 ? 1 : 0);

const spring = patch<Subject, Pose, Spring>(0, (_phase, _s, setting) => ({ x: setting.state.x }), {
  writes: ['x'],
  state: () => ({ x: 0, v: 0 }),
  step: (s, dt, _subject, setting) => {
    const goal = target(setting.timestamp);
    if (!Number.isFinite(dt)) {
      s.x = goal;
      s.v = 0;
      return;
    }
    const secs = dt / 1000;
    s.v += (-STIFFNESS * (s.x - goal) - DAMPING * s.v) * secs;
    s.x += s.v * secs;
  },
});

const config = f.schema({
  capped: f.boolean(false).label('Cap each step at 64 ms'),
});
type Config = ReturnType<typeof config.defaults>;

function scene(c: Config): Scene<Subject, Pose, Config> {
  return {
    kit: kit<Pose>({ x: sum() }),
    subjects: () => [steady, gap],
    voices: () => [{ name: 'Spring', color: 'v1', spec: { patch: spring } }],
    options: () => (c.capped ? { maxDt: 64 } : {}),
    probing: (t, s) => s !== gap || t < AWAY.from || t >= AWAY.to,
    record: ({ t, poses }) => [poses[0]?.x ?? 0, poses[1]?.x ?? 0, target(t)],
  };
}

const MIN = -1;
const MAX = 2;

export default function State() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.52}
      caption={
        <>
          One spring patch, two subjects. The lower one goes unprobed in the shaded stretch, and its
          next <code>step</code> is handed the whole 1.2 s gap. Uncapped, one Euler step that long
          throws it far off the scale; with <code>maxDt: 64</code> it takes one short step and
          carries on.
        </>
      }
      draw={(ctx, frame, size, ink) => {
        const top = Math.round(size.h * 0.4);
        numberLine(ctx, { w: size.w, h: top }, ink, {
          from: MIN,
          to: MAX,
          rows: [
            { label: 'Steady', color: ink.voice('v1'), value: frame.poses[0]?.x },
            { label: 'Unprobed', color: ink.voice('v2'), value: frame.poses[1]?.x, strong: true },
          ],
        });

        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: DURATION,
          t: frame.t,
          windows: [{ ...AWAY, text: 'Not probed' }],
        });
        const clamp = (v: number) => Math.max(MIN - 0.2, Math.min(MAX + 0.2, v));
        const points = (i: number): [number, number][] =>
          frame.history.map((h) => [h.t, clamp(h.values[i] ?? 0)]);
        trace(
          ctx,
          box,
          ink,
          [
            { color: ink.soft, points: points(2), width: 1, dash: [3, 3] },
            { color: ink.voice('v1'), points: points(0), width: 1.5 },
            { color: ink.voice('v2'), points: points(1), width: 2.5 },
          ],
          { t: DURATION, span: DURATION, min: MIN, max: MAX, label: 'Position, target dashed' },
        );
      }}
    />
  );
}
