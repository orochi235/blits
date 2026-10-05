import { kit, sum } from '@blits/channels';
import { curve } from '@blits/easing';
import { keys, patch } from '@blits/patch';
import type { Easing, Patch as P, Setting } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { label, lamp } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Ink } from './kit/ink';
import type { Scene } from './kit/scene';

interface Pose {
  fn: number;
  keys: number;
}

const DURATION = 3000;
const NAMES = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'] as const;

const config = f.schema({
  ease: f
    .enum('ease-in-out', [...NAMES, 'bezier', 'steps'])
    .labels([
      ...NAMES.map((n) => ({ value: n, label: n })),
      { value: 'bezier', label: 'cubic-bezier' },
      { value: 'steps', label: 'steps' },
    ])
    .radio()
    .label('Curve')
    .section('Easing of the keys', { pack: 'one-up' }),
  x1: f
    .number(0.7)
    .range(0, 1)
    .step(0.05)
    .label('x1')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'bezier'),
  y1: f
    .number(-0.4)
    .range(-0.5, 1.5)
    .step(0.05)
    .label('y1')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'bezier'),
  x2: f
    .number(0.3)
    .range(0, 1)
    .step(0.05)
    .label('x2')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'bezier'),
  y2: f
    .number(1.4)
    .range(-0.5, 1.5)
    .step(0.05)
    .label('y2')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'bezier'),
  count: f
    .number(4)
    .range(1, 10)
    .step(1)
    .label('Steps')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'steps'),
  jump: f
    .enum('end', ['start', 'end'])
    .radio()
    .label('Jump')
    .section('Easing of the keys')
    .showIf((c) => c.ease === 'steps'),
});
type Config = ReturnType<typeof config.defaults>;

function easingOf(c: Config): Easing {
  if (c.ease === 'bezier') return { bezier: [c.x1, c.y1, c.x2, c.y2] };
  if (c.ease === 'steps') return { steps: c.count, jump: c.jump };
  return c.ease;
}

const STOPS = [
  { at: 0, delta: { keys: 0 } },
  { at: 0.5, delta: { keys: 1 } },
  { at: 1, delta: { keys: 0 } },
];

const fnPatch = patch<object, Pose>(DURATION, (phase) => ({ fn: Math.sin(Math.PI * phase) ** 2 }), {
  writes: ['fn'],
});

function keysPatch(c: Config) {
  return keys<object, Pose>(DURATION, STOPS, { ease: easingOf(c) });
}

const subject = { id: 'subject' };

function scene(c: Config): Scene<typeof subject, Pose, Config> {
  return {
    kit: kit<Pose>({ fn: sum(), keys: sum() }),
    subjects: () => [subject],
    voices: () => [
      { name: 'patch', color: 'v1', spec: { patch: fnPatch } },
      { name: 'keys', color: 'v2', spec: { patch: keysPatch(c) } },
    ],
    ledger: { subject: () => subject, channels: ['fn', 'keys'] },
  };
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The value range every plot shares, wide enough for a bezier's overshoot. */
const LO = -0.5;
const HI = 1.5;

function frameBox(ctx: CanvasRenderingContext2D, box: Box, ink: Ink) {
  const py = (v: number) => box.y + box.h - ((v - LO) / (HI - LO)) * box.h;
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  ctx.setLineDash([3, 3]);
  for (const v of [0, 1]) {
    ctx.beginPath();
    ctx.moveTo(box.x, Math.round(py(v)) + 0.5);
    ctx.lineTo(box.x + box.w, Math.round(py(v)) + 0.5);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  return py;
}

/** One function of 0..1 drawn across a box, with a marker at `at`. */
function plot(
  ctx: CanvasRenderingContext2D,
  box: Box,
  ink: Ink,
  opts: {
    fn: (u: number) => number;
    color: string;
    at: number;
    value: number | undefined;
    title: string;
    stops?: { at: number; value: number }[];
  },
) {
  const py = frameBox(ctx, box, ink);
  const px = (u: number) => box.x + u * box.w;
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.strokeStyle = opts.color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  const n = Math.max(2, Math.round(box.w));
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = px(u);
    const y = py(opts.fn(u));
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.fillStyle = opts.color;
  for (const s of opts.stops ?? []) {
    ctx.fillRect(px(s.at) - 4, py(s.value) - 4, 8, 8);
  }
  ctx.strokeStyle = ink.soft;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(Math.round(px(opts.at)) + 0.5, box.y);
  ctx.lineTo(Math.round(px(opts.at)) + 0.5, box.y + box.h);
  ctx.stroke();
  if (opts.value !== undefined) {
    ctx.fillStyle = ink.ink;
    ctx.beginPath();
    ctx.arc(px(opts.at), py(opts.value), 5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  label(ctx, opts.title, box.x + 8, box.y + 18, ink.soft, 'left', opts.title.includes('('));
}

const stub = {} as Setting<void>;

/** How far back, in phase, a rail's ghosts reach: enough to show a snap as one jump. */
const TRAIL = 0.1;
const GHOSTS = 10;

/**
 * One thing a channel drives: a puck gliding along a rail to `value`, trailed by where it was a
 * moment ago, and a lamp lit to the same value.
 */
function rail(
  ctx: CanvasRenderingContext2D,
  box: Box,
  ink: Ink,
  opts: { name: string; color: string; value: number | undefined; past: (k: number) => number },
) {
  const gutter = 52;
  const x0 = box.x + gutter;
  const x1 = box.x + box.w - 2.4 * box.h;
  const cy = box.y + box.h / 2;
  const px = (v: number) => x0 + ((v - LO) / (HI - LO)) * (x1 - x0);
  label(ctx, opts.name, box.x, cy + 4, opts.color, 'left', true);
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, cy);
  ctx.lineTo(x1, cy);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1;
  ctx.strokeStyle = ink.soft;
  for (const v of [0, 1]) {
    const x = Math.round(px(v)) + 0.5;
    ctx.beginPath();
    ctx.moveTo(x, cy - 9);
    ctx.lineTo(x, cy + 9);
    ctx.stroke();
    label(ctx, String(v), x, box.y + box.h + 2, ink.soft, 'center', true);
  }
  const r = Math.min(9, box.h * 0.3);
  ctx.fillStyle = opts.color;
  for (let k = GHOSTS; k >= 1; k--) {
    ctx.globalAlpha = 0.28 * (1 - k / (GHOSTS + 1));
    ctx.beginPath();
    ctx.arc(px(opts.past(k)), cy, r * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (opts.value !== undefined) {
    ctx.beginPath();
    ctx.arc(px(opts.value), cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = ink.ink;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  lamp(ctx, ink, box.x + box.w - box.h * 0.9, cy, box.h * 0.32, opts.value ?? 0, opts.color);
}

export default function Patch() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.68}
      caption={
        <>
          The scrubber is the phase: one pass of both patches. On top, each value drives a puck and
          a lamp. The <code>patch</code> one glides steadily; the <code>keys</code> one moves with
          whatever easing you pick, on each segment between stops, and snaps when it's steps.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const phase = (frame.t % DURATION) / DURATION;
        const pad = 12;
        const kp: P<object, Pose, void> = keysPatch(c);
        const pose = frame.poses[0];
        const ago = (k: number) => (((phase - (k * TRAIL) / GHOSTS) % 1) + 1) % 1;
        const railH = Math.max(28, Math.min(44, size.w * 0.055));
        rail(ctx, { x: pad, y: pad, w: size.w - 2 * pad, h: railH }, ink, {
          name: 'fn',
          color: ink.voice('v1'),
          value: pose?.fn,
          past: (k) => fnPatch.at(ago(k), subject, stub).fn ?? 0,
        });
        rail(ctx, { x: pad, y: 2.4 * pad + railH, w: size.w - 2 * pad, h: railH }, ink, {
          name: 'keys',
          color: ink.voice('v2'),
          value: pose?.keys,
          past: (k) => kp.at(ago(k), subject, stub).keys ?? 0,
        });

        const top = 3 * pad + 2 * railH + 18;
        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(pad, top - pad / 2 - 0.5);
        ctx.lineTo(size.w - pad, top - pad / 2 - 0.5);
        ctx.stroke();
        const plotH = size.h - top;
        const side = Math.min(plotH - pad, size.w * 0.3);
        const left = { x: pad, w: size.w - side - 4 * pad };
        const rowH = (plotH - 2 * pad) / 2;

        plot(ctx, { x: left.x, y: top, w: left.w, h: rowH }, ink, {
          fn: (u) => fnPatch.at(u, subject, stub).fn ?? 0,
          color: ink.voice('v1'),
          at: phase,
          value: frame.alone[0]?.fn,
          title: 'patch(duration, at)',
        });
        plot(ctx, { x: left.x, y: top + pad + rowH, w: left.w, h: rowH }, ink, {
          fn: (u) => kp.at(u, subject, stub).keys ?? 0,
          color: ink.voice('v2'),
          at: phase,
          value: frame.alone[1]?.keys,
          title: 'keys(duration, stops)',
          stops: STOPS.map((s) => ({ at: s.at, value: s.delta.keys })),
        });

        const ease = curve(easingOf(c));
        const seg = phase < 0.5 ? phase / 0.5 : (phase - 0.5) / 0.5;
        const box = { x: size.w - side - pad, y: top, w: side, h: side };
        plot(ctx, box, ink, {
          fn: ease,
          color: ink.voice('v2'),
          at: seg,
          value: ease(seg),
          title: 'The easing',
        });
        if (c.ease === 'bezier') {
          const px = (u: number) => box.x + u * box.w;
          const py = (v: number) => box.y + box.h - ((v - LO) / (HI - LO)) * box.h;
          ctx.strokeStyle = ink.soft;
          ctx.fillStyle = ink.soft;
          ctx.lineWidth = 1;
          for (const [ax, ay, bx, by] of [
            [0, 0, c.x1, c.y1],
            [1, 1, c.x2, c.y2],
          ] as const) {
            ctx.beginPath();
            ctx.moveTo(px(ax), py(ay));
            ctx.lineTo(px(bx), py(by));
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(px(bx), py(by), 3.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }}
    />
  );
}
