import { kit, max, mul, sum } from '@blits/channels';
import { mix } from '@blits/mixer';
import { patch } from '@blits/patch';
import type { Channel as Ch, Handle } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { label } from './kit/draw';
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

export default function Locus() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.42}
      caption="Voice A hands over to voice B. Both write the same gain the whole way, so a handover between alternatives should read that gain throughout."
      draw={(ctx, frame, size, ink, c) => {
        const { folded, piled } = curvesFor(c);
        const rest = (channels[c.channel] ?? mul)().rest ?? 0;
        const left = 56;
        const right = size.w - 190;
        const top = 16;
        const bottom = size.h - 40;
        const lo = Math.min(0, c.gain);
        const hi = Math.max(1, c.gain * 2.2);
        const px = (k: number) => left + k * (right - left);
        const py = (v: number) => bottom - ((v - lo) / (hi - lo)) * (bottom - top);

        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 1;
        ctx.strokeRect(left + 0.5, top + 0.5, right - left, bottom - top);
        ctx.font = '12px "JetBrains Mono", ui-monospace, Menlo, monospace';
        ctx.fillStyle = ink.soft;
        ctx.textAlign = 'right';
        for (const v of [lo, hi, c.gain]) {
          if (v !== c.gain && Math.abs(py(v) - py(c.gain)) < 16) continue;
          ctx.fillText(v.toFixed(2), left - 8, py(v) + 4);
        }
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = ink.soft;
        ctx.beginPath();
        ctx.moveTo(left, py(rest) + 0.5);
        ctx.lineTo(right, py(rest) + 0.5);
        ctx.stroke();
        ctx.setLineDash([]);
        label(
          ctx,
          'rest',
          right - 6,
          py(rest) < top + 20 ? py(rest) + 18 : py(rest) - 6,
          ink.soft,
          'right',
        );
        label(ctx, 'all A', left, size.h - 16, ink.soft);
        label(ctx, 'all B', right, size.h - 16, ink.soft, 'right');
        label(ctx, 'halfway', px(0.5), size.h - 16, ink.soft, 'center');

        const line = (points: [number, number][], color: string, strong: boolean) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = strong ? 2.5 : 1.5;
          ctx.globalAlpha = strong ? 1 : 0.45;
          ctx.setLineDash(strong ? [] : [5, 4]);
          ctx.beginPath();
          points.forEach(([k, v], i) => {
            if (i === 0) ctx.moveTo(px(k), py(v));
            else ctx.lineTo(px(k), py(v));
          });
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
        };
        line(c.locus ? piled : folded, ink.soft, false);
        line(c.locus ? folded : piled, ink.ink, true);

        const k = frame.handles[1]?.weight ?? share(frame.t);
        const value = frame.poses[0]?.gain;
        if (value !== undefined) {
          ctx.fillStyle = ink.ink;
          ctx.beginPath();
          ctx.arc(px(k), py(value), 6, 0, Math.PI * 2);
          ctx.fill();
        }

        const x = right + 24;
        label(ctx, c.locus ? 'Folded as alternatives' : 'Piled up', x, top + 16, ink.ink);
        ctx.font = '600 28px "JetBrains Mono", ui-monospace, Menlo, monospace';
        ctx.fillStyle = ink.ink;
        ctx.textAlign = 'left';
        ctx.fillText(value === undefined ? '—' : value.toFixed(3), x, top + 52);
        label(ctx, c.locus ? 'Without the locus' : 'In one locus', x, top + 90, ink.soft);
        const other = c.locus ? piled : folded;
        const near = other[Math.round(k * 50)]?.[1];
        ctx.font = '16px "JetBrains Mono", ui-monospace, Menlo, monospace';
        ctx.fillStyle = ink.soft;
        ctx.fillText(near === undefined ? '—' : near.toFixed(3), x, top + 112);
      }}
    />
  );
}
