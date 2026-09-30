import { last, kit as makeKit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { label, numberLine, trace } from './kit/draw';
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
const AWAY = { from: 1500, to: 3700 };

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

const catchUp: Scene<Subject, Tally, Record<string, never>> = {
  kit: makeKit<Tally>({ value: sum() }),
  subjects: () => counters,
  voices: () => [{ name: 'Seconds', color: 'v1', spec: { patch: tally } }],
  probing: (t, s) => s !== left || t < AWAY.from || t >= AWAY.to,
  record: ({ poses }) => poses.map((p) => p.value ?? 0),
};
const catchUpScene = () => catchUp;

export function CatchUp() {
  return (
    <Explainer
      scene={catchUpScene}
      duration={CATCH}
      aspect={0.5}
      caption="Each subject counts the seconds its step has been handed. B goes unprobed in the shaded stretch, so it holds still; the next probe hands it the whole gap in one step."
      draw={(ctx, frame, size, ink) => {
        const top = Math.round(size.h * 0.5);
        numberLine(ctx, { w: size.w, h: top }, ink, {
          from: 0,
          to: 6,
          rows: counters.map((c, i) => ({
            label: c.name,
            color: ink.voice(c === left ? 'v2' : 'v1'),
            value: frame.poses[i]?.value,
            strong: c === left,
          })),
        });
        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: CATCH,
          t: frame.t,
          windows: [{ ...AWAY, text: 'B not probed' }],
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
const HIDDEN = { from: 2000, to: 4500 };

const hiding = f.schema({
  rebase: f.boolean(false).label('Rebase on return'),
});
type HideConfig = ReturnType<typeof hiding.defaults>;

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
    syncing: (t) => t < HIDDEN.from || t >= HIDDEN.to,
    events: () =>
      c.rebase
        ? [
            {
              at: HIDDEN.to,
              run: (m) => m.rebase(),
            },
          ]
        : [],
    record: ({ poses }) => [poses[0]?.sweep ?? Number.NaN, poses[0]?.level ?? 0],
  };
}

export default function HideTab() {
  return (
    <Explainer
      scene={hideScene}
      schema={hiding}
      duration={HIDE}
      aspect={0.5}
      caption="In the shaded stretch the tab is hidden and the host gets no frames. Without rebase, the first frame back is 2.5 s later on every clock: the fade has finished and the sweep's one pass is over. With rebase, both resume where they were."
      draw={(ctx, frame, size, ink) => {
        const pose = frame.poses[0];
        const top = Math.round(size.h * 0.42);
        numberLine(ctx, { w: size.w, h: top }, ink, {
          from: 0,
          to: 1,
          rows: [
            { label: 'Sweep', color: ink.voice('v1'), value: pose?.sweep },
            { label: 'Fade', color: ink.voice('v2'), value: pose?.level },
          ],
        });
        const box = { x: 72, y: top + 12, w: size.w - 136, h: size.h - top - 44 };
        timeline(ctx, box, ink, {
          duration: HIDE,
          t: frame.t,
          windows: [{ ...HIDDEN, text: frame.hidden ? 'Tab hidden: no frames' : 'Tab hidden' }],
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
