import { kit, max, mul, sum } from '@blits/channels';
import { mix } from '@blits/mixer';
import { patch } from '@blits/patch';
import type { Channel as Ch, Handle } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { label, lamp } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene, SceneEvent } from './kit/scene';

interface Pose {
  gain: number;
}

const subject = { id: 'light' };

const config = f.schema({
  locus: f.boolean(true).label('Same locus'),
  gain: f.number(0.06).range(0, 1).step(0.01).label('Gain each voice writes'),
  channel: f.enum('mul', ['mul', 'max', 'sum']).radio().label('Channel'),
});
type Config = ReturnType<typeof config.defaults>;

const channels: Record<string, () => Ch<number>> = { sum, mul, max };

const HOLD = 1000;
const OVER = 4000;
const DURATION = HOLD * 2 + OVER;

/** How far the handover has got at time t: 0 is all A, 1 is all B. */
const share = (t: number) => Math.max(0, Math.min(1, (t - HOLD) / OVER));

const hold = (gain: number) =>
  patch<typeof subject, Pose>(0, () => ({ gain }), { writes: ['gain'] });

function build(c: Config) {
  return kit<Pose>({ gain: (channels[c.channel] ?? mul)() });
}

/** Sets the two weights for a handover at share k, on the handles a scene event is given. */
function weigh(handles: Handle[], k: number): void {
  const [a, b] = handles;
  if (a) a.weight = 1 - k;
  if (b) b.weight = k;
}

/** The folded gain across the whole handover, from a throwaway mix per point, for the curves. */
function curve(c: Config, locus: boolean): [number, number][] {
  const points: [number, number][] = [];
  for (let n = 0; n <= 50; n++) {
    const k = n / 50;
    const m = mix<typeof subject, Pose>(build(c));
    const spot = locus ? 'handover' : undefined;
    m.cue({ patch: hold(c.gain), weight: 1 - k, locus: spot });
    m.cue({ patch: hold(c.gain), weight: k, locus: spot });
    m.sync(0);
    points.push([k, m.probe(subject).gain]);
  }
  return points;
}

function scene(c: Config): Scene<typeof subject, Pose, Config> {
  const spot = c.locus ? 'handover' : undefined;
  const events: SceneEvent<typeof subject, Pose>[] = [];
  for (let t = HOLD; t <= HOLD + OVER; t += 50) {
    const k = share(t);
    events.push({ at: t, run: (_m, handles) => weigh(handles, k) });
  }
  return {
    kit: build(c),
    subjects: () => [subject],
    voices: () => [
      { name: 'A', color: 'v1', spec: { patch: hold(c.gain), weight: 1, locus: spot } },
      { name: 'B', color: 'v2', spec: { patch: hold(c.gain), weight: 0, locus: spot } },
    ],
    events: () => events,
    ledger: { subject: () => subject, channels: ['gain'] },
  };
}

const curves = new Map<string, { folded: [number, number][]; piled: [number, number][] }>();

function curvesFor(c: Config) {
  const key = `${c.channel}:${c.gain}`;
  let got = curves.get(key);
  if (!got) {
    got = { folded: curve(c, true), piled: curve(c, false) };
    curves.clear();
    curves.set(key, got);
  }
  return got;
}

const MONO = '12px "JetBrains Mono", ui-monospace, Menlo, monospace';
const BIG = '600 16px "JetBrains Mono", ui-monospace, Menlo, monospace';

/** Y-axis values to print, dropping any that would land on one already kept. */
function ticks(values: number[], py: (v: number) => number): number[] {
  const kept: number[] = [];
  for (const v of values) if (kept.every((k) => Math.abs(py(k) - py(v)) >= 16)) kept.push(v);
  return kept;
}

export default function Locus() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.66}
      caption="Voice A hands over to voice B, and both write the same gain the whole way. In one locus the light holds steady; piled up, it flares or dips halfway through."
      draw={(ctx, frame, size, ink, c) => {
        const { folded, piled } = curvesFor(c);
        const rest = (channels[c.channel] ?? mul)().rest ?? 0;
        const k = frame.handles[1]?.weight ?? share(frame.t);
        const live = frame.poses[0]?.gain;
        const at = (points: [number, number][]) => points[Math.round(k * 50)]?.[1];
        const inLocus = c.locus ? live : at(folded);
        const pile = c.locus ? at(piled) : live;

        const all = [...folded, ...piled].map((p) => p[1]);
        const peak = Math.max(c.gain, ...all);
        const lo = Math.min(0, ...all);

        const stageH = Math.round(size.h * 0.38);
        const R = Math.max(10, Math.min(30, size.w * 0.045, stageH * 0.22));
        const r = R * 0.6;
        const cy = stageH * 0.5;

        const split = size.w * 0.33;
        [size.w * 0.09, size.w * 0.24].forEach((x, i) => {
          const w = frame.handles[i]?.weight ?? (i === 0 ? 1 - k : k);
          lamp(ctx, ink, x, cy, r, w, ink.voice(`v${i + 1}`));
          label(ctx, i === 0 ? 'A' : 'B', x, cy - r - 12, ink.ink, 'center');
          label(ctx, `weight ${w.toFixed(2)}`, x, cy + r + 20, ink.soft, 'center', true);
        });
        label(ctx, `each writes ${c.gain.toFixed(2)}`, split / 2, cy + r + 42, ink.soft, 'center');

        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(split + 0.5, 12);
        ctx.lineTo(split + 0.5, stageH - 12);
        ctx.stroke();
        // Lit on the plot's scale: the highest point either curve reaches is a fully lit lamp.
        const lit = (v: number | undefined) => ((v ?? lo) - lo) / Math.max(peak - lo, 1e-6);
        const lamps = [
          { x: size.w * 0.52, name: 'In one locus', value: inLocus, strong: c.locus },
          { x: size.w * 0.82, name: 'Without the locus', value: pile, strong: !c.locus },
        ];
        for (const b of lamps) {
          lamp(ctx, ink, b.x, cy, R, lit(b.value), ink.light);
          label(ctx, b.name, b.x, cy - R - 14, b.strong ? ink.ink : ink.soft, 'center');
          ctx.font = BIG;
          ctx.fillStyle = b.strong ? ink.ink : ink.soft;
          ctx.textAlign = 'center';
          ctx.fillText(b.value === undefined ? '—' : b.value.toFixed(3), b.x, cy + R + 24);
        }

        const left = 56;
        const right = size.w - 16;
        const top = stageH + 12;
        const bottom = size.h - 36;
        const hi = lo + Math.max(peak - lo, 0.01) * 1.2;
        const px = (q: number) => left + q * (right - left);
        const py = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

        ctx.strokeStyle = ink.rule;
        ctx.strokeRect(left + 0.5, top + 0.5, right - left, bottom - top);
        ctx.font = MONO;
        ctx.fillStyle = ink.soft;
        ctx.textAlign = 'right';
        for (const v of ticks([lo, c.gain, peak], py)) {
          ctx.fillText(v.toFixed(2), left - 8, py(v) + 4);
        }
        if (rest >= lo && rest <= hi) {
          ctx.setLineDash([3, 3]);
          ctx.strokeStyle = ink.soft;
          ctx.beginPath();
          ctx.moveTo(left, py(rest) + 0.5);
          ctx.lineTo(right, py(rest) + 0.5);
          ctx.stroke();
          ctx.setLineDash([]);
          label(ctx, 'rest', right - 6, py(rest) - 6, ink.soft, 'right');
        } else {
          const up = rest > hi;
          const y = up ? top + 16 : bottom - 6;
          label(ctx, `rest ${rest.toFixed(2)} ${up ? '↑' : '↓'}`, right - 6, y, ink.soft, 'right');
        }
        label(ctx, 'all A', left, size.h - 14, ink.soft);
        label(ctx, 'all B', right, size.h - 14, ink.soft, 'right');
        label(ctx, 'halfway', px(0.5), size.h - 14, ink.soft, 'center');

        const line = (points: [number, number][], color: string, strong: boolean) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = strong ? 2.5 : 1.5;
          ctx.setLineDash(strong ? [] : [5, 4]);
          ctx.beginPath();
          points.forEach(([q, v], i) => {
            if (i === 0) ctx.moveTo(px(q), py(v));
            else ctx.lineTo(px(q), py(v));
          });
          ctx.stroke();
          ctx.setLineDash([]);
        };
        line(c.locus ? piled : folded, ink.soft, false);
        line(c.locus ? folded : piled, ink.ink, true);

        const midF = folded[25]?.[1] ?? 0;
        const midP = piled[25]?.[1] ?? 0;
        if (Math.abs(py(midF) - py(midP)) < 14) {
          label(ctx, 'the same either way', px(0.5), py(midF) - 10, ink.soft, 'center');
        } else {
          const up = midP > midF;
          const p = c.locus ? ink.soft : ink.ink;
          const f = c.locus ? ink.ink : ink.soft;
          label(ctx, 'without the locus', px(0.5), py(midP) + (up ? -10 : 20), p, 'center');
          label(ctx, 'in one locus', px(0.5), py(midF) + (up ? 20 : -10), f, 'center');
        }

        const other = c.locus ? pile : inLocus;
        if (other !== undefined) {
          ctx.strokeStyle = ink.soft;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(px(k), py(other), 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        if (live !== undefined) {
          ctx.fillStyle = ink.ink;
          ctx.beginPath();
          ctx.arc(px(k), py(live), 6, 0, Math.PI * 2);
          ctx.fill();
        }
      }}
    />
  );
}
