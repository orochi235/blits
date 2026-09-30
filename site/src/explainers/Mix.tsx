import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { label } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';

interface Subject {
  i: number;
}

// `wave`, `pulse` and `swell` each carry one voice's influence alone, so the stage can stack them
// per subject; `height` is the pose a host would write.
interface Pose {
  height: number;
  wave: number;
  pulse: number;
  swell: number;
}

const COUNT = 12;
const subjects: Subject[] = Array.from({ length: COUNT }, (_, i) => ({ i }));

const config = f.schema({
  focus: f
    .number(4)
    .range(0, COUNT - 1)
    .step(1)
    .label('Ledger subject'),
  wave: f.number(1).range(0, 1).step(0.05).label('Weight of wave'),
  pulse: f.number(1).range(0, 1).step(0.05).label('Weight of pulse'),
  swell: f.number(0.7).range(0, 1).step(0.05).label('Weight of swell'),
  mute: f.boolean(true).label('Mute at 5 s'),
});
type Config = ReturnType<typeof config.defaults>;

const TAU = 2 * Math.PI;

function scene(c: Config): Scene<Subject, Pose, Config> {
  return {
    kit: kit<Pose>({ height: sum(), wave: sum(), pulse: sum(), swell: sum() }),
    subjects: () => subjects,
    voices: () => [
      {
        name: 'Wave',
        color: 'v1',
        spec: {
          patch: patch<Subject, Pose>(
            3000,
            (phase, s) => {
              const v = 0.5 * (0.5 + 0.5 * Math.sin(TAU * (phase - s.i / COUNT)));
              return { height: v, wave: v };
            },
            { writes: ['height', 'wave'] },
          ),
          weight: c.wave,
        },
      },
      {
        name: 'Pulse',
        color: 'v2',
        spec: {
          patch: patch<Subject, Pose>(
            1200,
            (phase) => {
              const v = 0.35 * (0.5 - 0.5 * Math.cos(TAU * phase));
              return { height: v, pulse: v };
            },
            { writes: ['height', 'pulse'] },
          ),
          target: (s) => s.i % 2 === 0,
          weight: c.pulse,
        },
      },
      {
        name: 'Swell',
        color: 'v3',
        spec: {
          patch: patch<Subject, Pose>(
            4000,
            (phase) => {
              const v = 0.4 * Math.sin(Math.PI * phase) ** 2;
              return { height: v, swell: v };
            },
            { writes: ['height', 'swell'] },
          ),
          weight: c.swell,
        },
      },
    ],
    events: () => (c.mute ? [{ at: 5000, run: (m) => m.mute({ over: 1500 }) }] : []),
    ledger: { subject: (s) => (s[c.focus] ?? s[0]) as Subject, channels: ['height'] },
  };
}

export default function Mix() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={8000}
      aspect={0.4}
      caption="Each column is one subject. The colored blocks are what each voice adds to it; the line on top is the folded pose. Pulse only reaches the even columns."
      draw={(ctx, frame, size, ink, c) => {
        const left = 16;
        const right = size.w - 16;
        const top = 30;
        const bottom = size.h - 28;
        const col = (right - left) / COUNT;
        const bar = col * 0.56;
        const y = (v: number) => bottom - (v / 1.1) * (bottom - top);

        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(left, bottom + 0.5);
        ctx.lineTo(right, bottom + 0.5);
        ctx.stroke();

        const layers = [
          { key: 'wave', color: ink.voice('v1') },
          { key: 'pulse', color: ink.voice('v2') },
          { key: 'swell', color: ink.voice('v3') },
        ] as const;

        frame.subjects.forEach((s, i) => {
          const pose = frame.poses[i];
          const cx = left + col * (i + 0.5);
          const x0 = cx - bar / 2;
          if (i === c.focus) {
            ctx.fillStyle = ink.rule;
            ctx.globalAlpha = 0.5;
            ctx.fillRect(cx - col / 2 + 2, top - 6, col - 4, bottom - top + 6);
            ctx.globalAlpha = 1;
          }
          let base = 0;
          for (const layer of layers) {
            const v = pose?.[layer.key] ?? 0;
            if (v <= 0) continue;
            ctx.fillStyle = layer.color;
            ctx.fillRect(x0, y(base + v), bar, y(base) - y(base + v));
            base += v;
          }
          const folded = pose?.height;
          if (folded !== undefined) {
            ctx.strokeStyle = ink.ink;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x0 - 4, y(folded));
            ctx.lineTo(x0 + bar + 4, y(folded));
            ctx.stroke();
          }
          label(ctx, String(s.i), cx, size.h - 10, i === c.focus ? ink.ink : ink.soft, 'center');
        });

        const live = frame.handles.some((h) => h.state !== 'done');
        label(ctx, live ? 'Live' : 'Not live: every voice is done', left, 18, ink.soft);
      }}
    />
  );
}
