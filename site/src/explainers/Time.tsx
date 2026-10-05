import { last, kit as makeKit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { label, lamp, numberLine, trace } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Ink } from './kit/ink';
import type { Scene } from './kit/scene';

/**
 * A time axis across the whole run, with windows shaded and the playhead drawn. The kit's `trace`
 * scrolls with the clock; these explainers want the run laid out left to right instead.
 */
export function timeline(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  opts: { duration: number; t: number; windows: { from: number; to: number; text: string }[] },
): void {
  const px = (t: number) => box.x + (t / opts.duration) * box.w;
  for (const w of opts.windows) {
    ctx.fillStyle = ink.rule;
    ctx.globalAlpha = 0.45;
    ctx.fillRect(px(w.from), box.y, px(w.to) - px(w.from), box.h);
    ctx.globalAlpha = 1;
    label(ctx, w.text, (px(w.from) + px(w.to)) / 2, box.y + box.h + 18, ink.soft, 'center');
  }
  ctx.strokeStyle = ink.ink;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(px(opts.t) + 0.5, box.y);
  ctx.lineTo(px(opts.t) + 0.5, box.y + box.h);
  ctx.stroke();
}

export const series = (history: { t: number; values: number[] }[], i: number): [number, number][] =>
  history.map((h) => [h.t, h.values[i] ?? 0]);

// ── Catch-up ────────────────────────────────────────────────────────────────

interface Count {
  seconds: number;
}

interface Subject {
  name: string;
}

const counters: Subject[] = [{ name: 'A' }, { name: 'B' }, { name: 'C' }];
const [, left] = counters as [Subject, Subject, Subject];
const CATCH = 6000;
const AWAY_FROM = 1500;

const catching = f.schema({
  away: f
    .number(2200)
    .range(100, CATCH - AWAY_FROM)
    .step(100)
    .suffix('ms')
    .label('B unprobed for'),
});
type CatchConfig = ReturnType<typeof catching.defaults>;

const awayOf = (c: CatchConfig) => ({ from: AWAY_FROM, to: AWAY_FROM + c.away });

interface Tally {
  value: number;
}

const tally = patch<Subject, Tally, Count>(
  0,
  (_phase, _s, setting) => ({ value: setting.state.seconds }),
  {
    writes: ['value'],
    state: () => ({ seconds: 0 }),
    step: (s, dt) => {
      s.seconds += dt / 1000;
    },
  },
);

function catchUpScene(c: CatchConfig): Scene<Subject, Tally, CatchConfig> {
  const away = awayOf(c);
  return {
    kit: makeKit<Tally>({ value: sum() }),
    subjects: () => counters,
    voices: () => [{ name: 'Seconds', color: 'v1', spec: { patch: tally } }],
    probing: (t, s) => s !== left || t < away.from || t >= away.to,
    record: ({ poses }) => poses.map((p) => p.value ?? 0),
  };
}

/** A stopwatch dial per subject: the hand and the swept wedge both read its counted seconds. */
function dials(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Ink,
  rows: { name: string; color: string; seconds: number; note?: string }[],
): void {
  const r = Math.min(h * 0.34, w / (rows.length * 3));
  const cy = 14 + r;
  const turn = 6;
  rows.forEach((row, i) => {
    const cx = (w * (i + 1)) / (rows.length + 1);
    const angle = (row.seconds / turn) * Math.PI * 2 - Math.PI / 2;
    ctx.fillStyle = row.color;
    ctx.globalAlpha = 0.18;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, -Math.PI / 2, angle);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = ink.rule;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let s = 0; s < turn; s++) {
      const a = (s / turn) * Math.PI * 2 - Math.PI / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r * 0.84, cy + Math.sin(a) * r * 0.84);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.stroke();
    }
    ctx.strokeStyle = row.color;
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * r * 0.9, cy + Math.sin(angle) * r * 0.9);
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.fillStyle = row.color;
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    label(
      ctx,
      `${row.name}  ${row.seconds.toFixed(2)} s`,
      cx,
      cy + r + 20,
      ink.ink,
      'center',
      true,
    );
    if (row.note) label(ctx, row.note, cx, cy + r + 38, ink.soft, 'center');
  });
}

export function CatchUp() {
  return (
    <Explainer
      scene={catchUpScene}
      schema={catching}
      duration={CATCH}
      aspect={0.8}
      caption={
        <>
          Each subject counts the seconds its <code>step</code> has been handed, and its dial shows
          the count: one turn is 6 s. B goes unprobed in the shaded stretch, so its hand holds
          still; the next probe hands it the whole gap in one step, and the hand jumps by as much as
          it missed.
        </>
      }
      draw={(ctx, frame, size, ink, cfg) => {
        const span = awayOf(cfg);
        const stage = Math.round(size.h * 0.36);
        const away = frame.t >= span.from && frame.t < span.to;
        dials(
          ctx,
          size.w,
          stage,
          ink,
          counters.map((c, i) => ({
            name: c.name,
            color: ink.voice(c === left ? 'v2' : 'v1'),
            seconds: frame.poses[i]?.value ?? 0,
            note: c === left && away ? 'not probed' : undefined,
          })),
        );
        const top = stage + Math.round((size.h - stage) * 0.42);
        ctx.save();
        ctx.translate(0, stage);
        numberLine(ctx, { w: size.w, h: top - stage }, ink, {
          from: 0,
          to: 6,
          rows: counters.map((c, i) => ({
            label: c.name,
            color: ink.voice(c === left ? 'v2' : 'v1'),
            value: frame.poses[i]?.value,
            strong: c === left,
          })),
        });
        ctx.restore();
        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: CATCH,
          t: frame.t,
          windows: [{ ...span, text: 'B not probed' }],
        });
        trace(
          ctx,
          box,
          ink,
          counters.map((c, i) => ({
            color: ink.voice(c === left ? 'v2' : 'v1'),
            points: series(frame.history, i),
            width: c === left ? 2.5 : 1.5,
          })),
          { t: CATCH, span: CATCH, min: 0, max: 6, label: 'Seconds counted' },
        );
      }}
    />
  );
}

// ── Hide the tab ────────────────────────────────────────────────────────────

interface Pose {
  sweep: number;
  level: number;
}

const tab = { id: 'tab' };
const HIDE = 8000;

const hiding = f.schema({
  rebase: f.boolean(false).label('Rebase on return'),
  hideAt: f.number(2000).range(0, 6000).step(100).suffix('ms').label('Hide the tab at'),
  hideFor: f.number(2500).range(100, 4000).step(100).suffix('ms').label('Hidden for'),
});
type HideConfig = ReturnType<typeof hiding.defaults>;

const hiddenOf = (c: HideConfig) => ({ from: c.hideAt, to: Math.min(HIDE, c.hideAt + c.hideFor) });

function hideScene(c: HideConfig): Scene<typeof tab, Pose, HideConfig> {
  return {
    kit: makeKit<Pose>({ sweep: last(), level: sum() }),
    subjects: () => [tab],
    voices: () => [
      {
        name: 'Sweep, one pass',
        color: 'v1',
        spec: {
          patch: patch<typeof tab, Pose>(4000, (phase) => ({ sweep: phase }), {
            writes: ['sweep'],
          }),
          loop: false,
        },
      },
      {
        name: 'Fade in',
        color: 'v2',
        spec: {
          patch: patch<typeof tab, Pose>(0, () => ({ level: 1 }), { writes: ['level'] }),
          fade: { in: 3000 },
        },
      },
    ],
    syncing: (t) => t < hiddenOf(c).from || t >= hiddenOf(c).to,
    events: () =>
      c.rebase
        ? [
            {
              at: hiddenOf(c).to,
              run: (m) => m.rebase(),
            },
          ]
        : [],
    record: ({ poses }) => [poses[0]?.sweep ?? Number.NaN, poses[0]?.level ?? 0],
  };
}

/** A lamp riding a track: the sweep places it, the fade lights it. */
function sweeper(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ink: Ink,
  pose: Pose | undefined,
  hidden: boolean,
): void {
  const from = 72;
  const to = w - 64;
  const y = h * 0.5;
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(from, y);
  ctx.lineTo(to, y);
  ctx.stroke();
  const sweep = pose?.sweep;
  if (sweep === undefined || Number.isNaN(sweep)) {
    label(ctx, 'The pass is over: no sweep', (from + to) / 2, y - 18, ink.soft, 'center');
  } else {
    lamp(ctx, ink, from + sweep * (to - from), y, 12, pose?.level ?? 0, ink.voice('v1'));
  }
  if (hidden) label(ctx, 'Hidden: no frames', to, y + 32, ink.soft, 'right');
}

export default function HideTab() {
  return (
    <Explainer
      scene={hideScene}
      schema={hiding}
      duration={HIDE}
      aspect={0.66}
      caption={
        <>
          The lamp rides the sweep and glows with the fade. In the shaded stretch the tab is hidden
          and the host gets no frames. Without <code>rebase()</code>, the first frame back is as
          much later on every clock as the tab was hidden: hide it long enough and the fade has
          finished and the sweep's one pass is over. With it, both resume where they were.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const span = hiddenOf(c);
        const pose = frame.poses[0];
        const stage = Math.round(size.h * 0.22);
        sweeper(ctx, size.w, stage, ink, pose, frame.hidden);
        const top = stage + Math.round((size.h - stage) * 0.4);
        ctx.save();
        ctx.translate(0, stage);
        numberLine(ctx, { w: size.w, h: top - stage }, ink, {
          from: 0,
          to: 1,
          rows: [
            { label: 'Sweep', color: ink.voice('v1'), value: pose?.sweep },
            { label: 'Fade', color: ink.voice('v2'), value: pose?.level },
          ],
        });
        ctx.restore();
        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: HIDE,
          t: frame.t,
          windows: [{ ...span, text: frame.hidden ? 'Tab hidden: no frames' : 'Tab hidden' }],
        });
        const sweep = series(frame.history, 0).filter(([, v]) => !Number.isNaN(v));
        trace(
          ctx,
          box,
          ink,
          [
            { color: ink.voice('v1'), points: sweep },
            { color: ink.voice('v2'), points: series(frame.history, 1) },
          ],
          { t: HIDE, span: HIDE, min: 0, max: 1.05 },
        );
      }}
    />
  );
}
