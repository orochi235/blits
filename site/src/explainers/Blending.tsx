import { kit, sum } from '@blits/channels';
import { keys, patch } from '@blits/patch';
import type { Easing, Setting } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { dots, label, trace } from './kit/draw';
import { Explainer, type Size } from './kit/Explainer';
import type { Ink } from './kit/ink';
import type { Scene } from './kit/scene';

interface Dot {
  i: number;
}

const row = (n: number): Dot[] => Array.from({ length: n }, (_, i) => ({ i }));

/**
 * A trace on a fixed time axis, 0 to `duration` left to right, with a cursor at `t` and a dashed
 * line at each mark.
 */
function timeline(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  series: Parameters<typeof trace>[3],
  opts: {
    t: number;
    duration: number;
    min?: number;
    max?: number;
    label: string;
    marks?: { at: number; text: string }[];
  },
): void {
  trace(ctx, box, ink, series, {
    t: opts.duration,
    span: opts.duration,
    min: opts.min,
    max: opts.max,
    label: opts.label,
  });
  const px = (t: number) => Math.round(box.x + (t / opts.duration) * box.w) + 0.5;
  ctx.lineWidth = 1;
  for (const m of opts.marks ?? []) {
    ctx.strokeStyle = ink.soft;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(px(m.at), box.y);
    ctx.lineTo(px(m.at), box.y + box.h);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, m.text, px(m.at) + 5, box.y + box.h - 8, ink.soft);
  }
  ctx.strokeStyle = ink.ink;
  ctx.beginPath();
  ctx.moveTo(px(opts.t), box.y);
  ctx.lineTo(px(opts.t), box.y + box.h);
  ctx.stroke();
}

const points = (history: { t: number; values: number[] }[], i: number): [number, number][] =>
  history.map((h) => [h.t, h.values[i] ?? 0]);

const EASES = ['linear', 'ease-in', 'ease-out', 'ease-in-out'] as const;

// ── Fade ──────────────────────────────────────────────────────────────────────

interface Lifted {
  lift: number;
  /** Always 1 from the patch, so what the mix hands back is the voice's weight. */
  envelope: number;
}

const FADE_DURATION = 4400;
const FADE_AT = 2600;

const fadeConfig = f.schema({
  ease: f
    .enum('ease-in-out', [...EASES])
    .radio()
    .label('Fade ease'),
});
type FadeConfig = ReturnType<typeof fadeConfig.defaults>;

const fadeRow = row(9);

const wave = patch<Dot, Lifted>(
  1400,
  (phase, d) => ({
    lift: 0.55 + 0.35 * Math.sin(2 * Math.PI * (phase - d.i / fadeRow.length)),
    envelope: 1,
  }),
  { writes: ['lift', 'envelope'] },
);

function fadeScene(c: FadeConfig): Scene<Dot, Lifted, FadeConfig> {
  return {
    kit: kit<Lifted>({ lift: sum(), envelope: sum() }),
    subjects: () => fadeRow,
    voices: () => [
      {
        name: 'wave',
        color: 'v1',
        spec: {
          patch: wave,
          fade: { in: 1000, out: 1200, ease: c.ease as Easing },
        },
      },
    ],
    events: () => [{ at: FADE_AT, run: (_m, handles) => handles[0]?.fade() }],
    record: ({ poses }) => [poses[0]?.envelope ?? 0],
  };
}

export function Fade() {
  return (
    <Explainer
      scene={fadeScene}
      schema={fadeConfig}
      duration={FADE_DURATION}
      aspect={0.46}
      caption="A wave that fades in over 1 s, then out over 1.2 s once fade() is called. The line under the row is the voice's weight: the ease shapes both ramps."
      draw={(ctx, frame, size, ink) => {
        const top: Size = { w: size.w, h: size.h * 0.55 };
        dots(
          ctx,
          top,
          ink,
          frame.poses.map((p) => ({
            lift: p.lift ?? 0,
            color: ink.voice('v1'),
          })),
          { baseline: 0.88, range: 0.72 },
        );
        const box = {
          x: 12,
          y: size.h * 0.6,
          w: size.w - 24,
          h: size.h * 0.4 - 12,
        };
        timeline(ctx, box, ink, [{ color: ink.voice('v1'), points: points(frame.history, 0) }], {
          t: frame.t,
          duration: FADE_DURATION,
          min: -0.08,
          max: 1.15,
          label: 'Weight',
          marks: [{ at: FADE_AT, text: 'fade()' }],
        });
      }}
    />
  );
}

// ── Retarget ──────────────────────────────────────────────────────────────────

interface Placed {
  x: number;
}

const RETARGET_DURATION = 4000;
const RETARGET_AT = 1100;
const FIRST_TARGET = 4;
const SECOND_TARGET = 1;

const retargetConfig = f.schema({
  current: f.boolean(true).label("from: 'current' on the second voice"),
});
type RetargetConfig = ReturnType<typeof retargetConfig.defaults>;

const one: Dot = { i: 0 };

const there = keys<Dot, Placed>(
  2400,
  [
    { at: 0, delta: { x: 0 } },
    { at: 1, delta: { x: FIRST_TARGET } },
  ],
  { ease: 'ease-in-out' },
);

const back = keys<Dot, Placed>(
  1600,
  [
    { at: 0, delta: { x: 0 } },
    { at: 1, delta: { x: SECOND_TARGET } },
  ],
  { ease: 'ease-in-out' },
);

function retargetScene(c: RetargetConfig): Scene<Dot, Placed, RetargetConfig> {
  return {
    kit: kit<Placed>({ x: sum() }),
    subjects: () => [one],
    voices: () => [
      { name: 'there', color: 'v1', spec: { patch: there, loop: false } },
      {
        name: 'back',
        color: 'v2',
        spec: {
          patch: back,
          loop: false,
          start: RETARGET_AT,
          from: c.current ? 'current' : undefined,
        },
      },
    ],
    events: () => [{ at: RETARGET_AT, run: (_m, handles) => handles[0]?.fade({ over: 0 }) }],
    record: ({ poses }) => [poses[0]?.x ?? 0],
  };
}

export function Retarget() {
  return (
    <Explainer
      scene={retargetScene}
      schema={retargetConfig}
      duration={RETARGET_DURATION}
      aspect={0.46}
      caption="The first voice heads for 4. At 1.1 s it is cut and a second voice heads for 1. With from: 'current' the second starts where the dot is; without it, from its own first stop at 0."
      draw={(ctx, frame, size, ink) => {
        const left = 40;
        const right = size.w - 40;
        const y = size.h * 0.26;
        const px = (v: number) => left + (v / FIRST_TARGET) * (right - left);
        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, y + 0.5);
        ctx.lineTo(right, y + 0.5);
        ctx.stroke();
        for (let v = 0; v <= FIRST_TARGET; v++) {
          ctx.beginPath();
          ctx.moveTo(Math.round(px(v)) + 0.5, y - 4);
          ctx.lineTo(Math.round(px(v)) + 0.5, y + 4);
          ctx.stroke();
          label(ctx, String(v), px(v), y + 22, ink.soft, 'center');
        }
        const flags: [number, string, string][] = [
          [FIRST_TARGET, 'First target', 'v1'],
          [SECOND_TARGET, 'Second target', 'v2'],
        ];
        for (const [v, text, color] of flags) {
          ctx.strokeStyle = ink.voice(color);
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(px(v)) + 0.5, y - 26);
          ctx.lineTo(Math.round(px(v)) + 0.5, y);
          ctx.stroke();
          ctx.setLineDash([]);
          label(ctx, text, px(v), y - 32, ink.voice(color), 'center');
        }
        const x = frame.poses[0]?.x;
        if (x !== undefined) {
          const second = frame.t >= RETARGET_AT;
          ctx.fillStyle = ink.voice(second ? 'v2' : 'v1');
          ctx.beginPath();
          ctx.arc(px(x), y, 10, 0, Math.PI * 2);
          ctx.fill();
        }
        const box = {
          x: 12,
          y: size.h * 0.46,
          w: size.w - 24,
          h: size.h * 0.54 - 12,
        };
        timeline(ctx, box, ink, [{ color: ink.ink, points: points(frame.history, 0) }], {
          t: frame.t,
          duration: RETARGET_DURATION,
          min: -0.3,
          max: FIRST_TARGET + 0.3,
          label: 'Position',
          marks: [{ at: RETARGET_AT, text: 'second voice' }],
        });
      }}
    />
  );
}

// ── Blend ─────────────────────────────────────────────────────────────────────

const BLEND_DURATION = 8000;

/** The blend signal: 0 to 1 and back once per run, read off the mix clock. */
const sweep = (t: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BLEND_DURATION);

const blendRow = row(9);
const last = blendRow.length - 1;

const shapes: { name: string; color: string; lift: (d: Dot) => number }[] = [
  { name: 'Flat', color: 'v1', lift: () => 0.3 },
  {
    name: 'Arch',
    color: 'v2',
    lift: (d) => 0.1 + 0.85 * Math.sin((Math.PI * d.i) / last),
  },
  { name: 'Ramp', color: 'v3', lift: (d) => 0.05 + 0.9 * (d.i / last) },
];

const alternatives = shapes.map((s) =>
  patch<Dot, { lift: number }>(0, (_phase, d) => ({ lift: s.lift(d) }), {
    writes: ['lift'],
  }),
);

function blendScene(): Scene<Dot, { lift: number }, Record<string, never>> {
  return {
    kit: kit<{ lift: number }>({ lift: sum() }),
    subjects: () => blendRow,
    voices: () => [],
    events: () => [
      {
        at: 0,
        run: (m) => {
          m.blend(alternatives, (_d: Dot, s: Setting) => sweep(s.timestamp));
        },
      },
    ],
  };
}

export function Blend() {
  return (
    <Explainer
      scene={blendScene}
      duration={BLEND_DURATION}
      aspect={0.46}
      caption="Three poses of one row, cued with mix.blend and a signal that sweeps from 0 to 1 and back. The faint dots are each pose alone; the solid ones are what the mix makes."
      draw={(ctx, frame, size, ink) => {
        const top: Size = { w: size.w, h: size.h * 0.74 };
        const opts = { baseline: 0.92, range: 0.8 };
        for (const s of shapes) {
          dots(
            ctx,
            top,
            ink,
            blendRow.map((d) => ({
              lift: s.lift(d),
              scale: 0.55,
              color: ink.voice(s.color),
              alpha: 0.35,
            })),
            opts,
          );
        }
        dots(
          ctx,
          top,
          ink,
          frame.poses.map((p) => ({ lift: p.lift ?? 0, color: ink.ink })),
          opts,
        );

        const k = sweep(frame.t);
        const left = 60;
        const right = size.w - 60;
        const y = size.h * 0.86;
        const px = (u: number) => left + u * (right - left);
        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        shapes.forEach((s, i) => {
          const at = px(i / (shapes.length - 1));
          ctx.fillStyle = ink.voice(s.color);
          ctx.beginPath();
          ctx.arc(at, y, 4, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, s.name, at, y + 22, ink.voice(s.color), 'center');
        });
        ctx.fillStyle = ink.ink;
        ctx.beginPath();
        ctx.moveTo(px(k), y - 5);
        ctx.lineTo(px(k) - 6, y - 15);
        ctx.lineTo(px(k) + 6, y - 15);
        ctx.closePath();
        ctx.fill();
        label(ctx, `by ${k.toFixed(2)}`, px(k), y - 21, ink.ink, 'center');
      }}
    />
  );
}

// ── Handover at rest ──────────────────────────────────────────────────────────

const HANDOVER_DURATION = 6000;
const HANDOVER_AT = 1900;
const DEADLINE = 2500;

const handoverConfig = f.schema({
  leave: f
    .enum('rest', ['rest', 'ramp'])
    .labels([
      { value: 'rest', label: "at: 'rest'" },
      { value: 'ramp', label: 'over: 400' },
    ])
    .radio()
    .label('fade() with'),
});
type HandoverConfig = ReturnType<typeof handoverConfig.defaults>;

interface Hopper extends Dot {
  /** Never comes to rest, so only the deadline removes the voice from it. */
  restless?: boolean;
}

const hoppers: Hopper[] = [...row(5), { i: 5, restless: true }];

/** A hop in the first 60% of each pass and exactly at rest for the rest of it. */
const hop = patch<Hopper, { lift: number }>(
  1000,
  (phase, d) => {
    if (d.restless) return { lift: 0.45 + 0.25 * Math.sin(2 * Math.PI * phase) };
    return { lift: phase < 0.6 ? Math.sin((Math.PI * phase) / 0.6) : 0 };
  },
  { writes: ['lift'] },
);

function handoverScene(c: HandoverConfig): Scene<Hopper, { lift: number }, HandoverConfig> {
  return {
    kit: kit<{ lift: number }>({ lift: sum() }),
    subjects: () => hoppers,
    voices: () => [
      {
        name: 'hop',
        color: 'v1',
        spec: { patch: hop, stagger: (d: Hopper) => d.i * 170 },
      },
    ],
    events: () => [
      {
        at: HANDOVER_AT,
        run: (_m, handles) =>
          handles[0]?.fade(c.leave === 'rest' ? { at: 'rest', deadline: DEADLINE } : { over: 400 }),
      },
    ],
    record: ({ poses }) => poses.map((p) => p.lift ?? 0),
  };
}

export function Handover() {
  return (
    <Explainer
      scene={handoverScene}
      schema={handoverConfig}
      duration={HANDOVER_DURATION}
      aspect={0.5}
      caption="A looping hop, staggered across the row, faded at 1.9 s. At rest, each dot finishes its hop and leaves when it lands; the last dot never lands, so the deadline takes it. With a ramp, every dot sinks at once, mid-air or not."
      draw={(ctx, frame, size, ink, c) => {
        const top: Size = { w: size.w, h: size.h * 0.5 };
        dots(
          ctx,
          top,
          ink,
          frame.poses.map((p, i) => ({
            lift: p.lift ?? 0,
            color: ink.voice(hoppers[i]?.restless ? 'v3' : 'v1'),
          })),
          { baseline: 0.9, range: 0.72 },
        );
        const box = {
          x: 12,
          y: size.h * 0.54,
          w: size.w - 24,
          h: size.h * 0.46 - 12,
        };
        const marks = [{ at: HANDOVER_AT, text: 'fade()' }];
        if (c.leave === 'rest') marks.push({ at: HANDOVER_AT + DEADLINE, text: 'deadline' });
        timeline(
          ctx,
          box,
          ink,
          hoppers.map((d, i) => ({
            color: ink.voice(d.restless ? 'v3' : 'v1'),
            width: 1.5,
            points: points(frame.history, i),
          })),
          {
            t: frame.t,
            duration: HANDOVER_DURATION,
            min: -0.08,
            max: 1.15,
            label: 'Lift per dot',
            marks,
          },
        );
      }}
    />
  );
}
