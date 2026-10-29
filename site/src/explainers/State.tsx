import { kit, patch, sum } from '@msb235/blits';
import { f } from '@weasel-js/labkit';
import { label, numberLine, trace } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Ink } from './kit/ink';
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
const AWAY_FROM = 1700;
/** The longest gap the slider offers, and so the cap at which capping changes nothing. */
const MOST = 3000;
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
  away: f.number(1200).range(100, MOST).step(100).suffix('ms').label('Left unprobed for'),
  cap: f
    .number(Number.POSITIVE_INFINITY)
    .range(16, MOST)
    .step(8)
    .suffix('ms')
    .endless('uncapped')
    .label('Cap each step at'),
});
type Config = ReturnType<typeof config.defaults>;

const awayOf = (c: Config) => ({ from: AWAY_FROM, to: AWAY_FROM + c.away });

function scene(c: Config): Scene<Subject, Pose, Config> {
  return {
    kit: kit<Pose>({ x: sum() }),
    subjects: () => [steady, gap],
    voices: () => [{ name: 'Spring', color: 'v1', spec: { patch: spring } }],
    options: () => (c.cap < MOST ? { maxDt: c.cap } : {}),
    probing: (t, s) => s !== gap || t < awayOf(c).from || t >= awayOf(c).to,
    record: ({ t, poses }) => [poses[0]?.x ?? 0, poses[1]?.x ?? 0, target(t)],
  };
}

const MIN = -1;
const MAX = 2;
/** How far past each end of the scale the squashed band reaches, and the value it reaches at. */
const PAD = 0.9;
const REACH = 100;
const LO = MIN - PAD;
const HI = MAX + PAD;

/**
 * Linear on the scale, and past either end on a log scale squeezed into a band PAD wide, so a
 * weight thrown to 97 still visibly swings rather than pinning to the edge.
 */
const squash = (v: number) => {
  const bend = (over: number) => PAD * Math.min(1, Math.log1p(over) / Math.log1p(REACH));
  return v < MIN ? MIN - bend(MIN - v) : v > MAX ? MAX + bend(v - MAX) : v;
};

/**
 * Each subject as a weight on a rail, joined by a coil to a post at its target. Past the scale the
 * rail is dashed, the weight moves through the squashed band, and says where it really is.
 */
function rails(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Ink,
  goal: number,
  rows: { name: string; color: string; x: number | undefined; note?: string }[],
): void {
  const left = 72;
  const right = w - 64;
  const px = (v: number) => left + ((squash(v) - LO) / (HI - LO)) * (right - left);
  const rowH = (h - 12) / rows.length;
  rows.forEach((row, i) => {
    const y = 12 + rowH * (i + 0.55);
    label(ctx, row.name, left - 18, y + 4, ink.soft, 'right');
    ctx.strokeStyle = ink.rule;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px(MIN), y + 14);
    ctx.lineTo(px(MAX), y + 14);
    ctx.stroke();
    ctx.setLineDash([2, 4]);
    for (const [a, b] of [
      [left, px(MIN)],
      [px(MAX), right],
    ]) {
      ctx.beginPath();
      ctx.moveTo(a, y + 14);
      ctx.lineTo(b, y + 14);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const post = px(goal);
    ctx.strokeStyle = ink.soft;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(post, y - 16);
    ctx.lineTo(post, y + 14);
    ctx.stroke();
    ctx.setLineDash([]);

    if (row.x === undefined) return;
    const off = row.x < MIN ? -1 : row.x > MAX ? 1 : 0;
    const mass = px(row.x);
    coil(ctx, post, mass, y, row.color);
    ctx.fillStyle = row.color;
    ctx.globalAlpha = row.note ? 0.45 : 1;
    ctx.fillRect(mass - 11, y - 11, 22, 22);
    ctx.globalAlpha = 1;
    if (off !== 0) {
      const text = `off the scale: ${row.x.toFixed(1)}`;
      label(ctx, text, mass - off * 18, y - 18, ink.ink, off < 0 ? 'left' : 'right', true);
    }
    if (row.note) label(ctx, row.note, right, y - 18, ink.soft, 'right');
  });
}

function coil(ctx: CanvasRenderingContext2D, a: number, b: number, y: number, color: string): void {
  const turns = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(a, y);
  for (let k = 1; k < turns; k++) ctx.lineTo(a + ((b - a) * k) / turns, y + (k % 2 ? -6 : 6));
  ctx.lineTo(b, y);
  ctx.stroke();
}

export default function State() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.85}
      caption={
        <>
          One spring patch, two subjects: each weight is pulled toward the dashed post, which flips
          between 1 and 0. The lower one goes unprobed in the shaded stretch, and its next{' '}
          <code>step</code> is handed the whole gap. Uncapped, at the cap slider's right end, one
          Euler step that long throws it far off the scale. Bring <code>maxDt</code> down and the
          step shrinks: a few hundred ms still overshoots, and near a frame it takes one short step
          and carries on.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const span = awayOf(c);
        const stage = Math.round(size.h * 0.3);
        const away = frame.t >= span.from && frame.t < span.to;
        rails(ctx, size.w, stage, ink, target(frame.t), [
          { name: 'Steady', color: ink.voice('v1'), x: frame.poses[0]?.x },
          {
            name: 'Unprobed',
            color: ink.voice('v2'),
            x: frame.poses[1]?.x,
            note: away ? 'not probed: frozen' : undefined,
          },
        ]);
        const top = stage + Math.round((size.h - stage) * 0.32);
        ctx.save();
        ctx.translate(0, stage);
        numberLine(ctx, { w: size.w, h: top - stage }, ink, {
          from: LO,
          to: HI,
          place: squash,
          rows: [
            { label: 'Steady', color: ink.voice('v1'), value: frame.poses[0]?.x },
            { label: 'Unprobed', color: ink.voice('v2'), value: frame.poses[1]?.x, strong: true },
          ],
        });
        ctx.restore();

        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: DURATION,
          t: frame.t,
          windows: [{ ...span, text: c.cap < MOST ? `Not probed, maxDt ${c.cap}` : 'Not probed' }],
        });
        const points = (i: number): [number, number][] =>
          frame.history.map((h) => [h.t, squash(h.values[i] ?? 0)]);
        trace(
          ctx,
          box,
          ink,
          [
            { color: ink.soft, points: points(2), width: 1, dash: [3, 3] },
            { color: ink.voice('v1'), points: points(0), width: 1.5 },
            { color: ink.voice('v2'), points: points(1), width: 2.5 },
          ],
          { t: DURATION, span: DURATION, min: LO, max: HI, label: 'Position, target dashed' },
        );
      }}
    />
  );
}
