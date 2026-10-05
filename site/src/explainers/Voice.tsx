import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { dots, trace } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';

interface Pose {
  lift: number;
  /** Always 1 from the patch, so what the mix hands back is this subject's weight. */
  envelope: number;
}

const DURATION = 7000;
const COUNT = 7;

const config = f.schema({
  rate: f.number(1).range(0, 3).step(0.25).label('Rate'),
  loop: f
    .enum('forever', ['forever', 'once', 'n'])
    .labels([
      { value: 'forever', label: 'Forever' },
      { value: 'once', label: 'Once' },
      { value: 'n', label: 'n passes' },
    ])
    .radio()
    .label('Loop'),
  passes: f
    .number(3)
    .range(1, 8)
    .step(1)
    .label('Passes')
    .showIf((c) => c.loop === 'n'),
  stagger: f.number(150).range(0, 500).step(10).suffix('ms').label('Stagger per dot'),
  fadeIn: f.number(600).range(0, 2000).step(50).suffix('ms').label('Fade in'),
  fadeOut: f.number(800).range(0, 2000).step(50).suffix('ms').label('Fade out'),
  fadeAt: f.number(4500).range(0, DURATION).step(100).suffix('ms').label('Fade out at'),
});
type Config = ReturnType<typeof config.defaults>;

interface Dot {
  i: number;
}

const row: Dot[] = Array.from({ length: COUNT }, (_, i) => ({ i }));

const hop = patch<Dot, Pose>(1000, (phase) => ({ lift: Math.sin(Math.PI * phase), envelope: 1 }), {
  writes: ['lift', 'envelope'],
});

/** The slider's right end is never: the run loops before it. */
const fades = (c: Config) => c.fadeAt < DURATION;

function scene(c: Config): Scene<Dot, Pose, Config> {
  const loop = c.loop === 'forever' ? true : c.loop === 'once' ? false : c.passes;
  return {
    kit: kit<Pose>({ lift: sum(), envelope: sum() }),
    subjects: () => row,
    voices: () => [
      {
        name: 'hop',
        color: 'v1',
        spec: {
          patch: hop,
          rate: c.rate,
          loop,
          stagger: (d) => d.i * c.stagger,
          fade: { in: c.fadeIn, out: c.fadeOut },
        },
      },
    ],
    events: () => (fades(c) ? [{ at: c.fadeAt, run: (_mix, handles) => handles[0]?.fade() }] : []),
    record: ({ poses }) => poses.map((p) => p.envelope ?? 0),
    ledger: { subject: (s) => s[0] as Dot, channels: ['lift', 'envelope'] },
  };
}

export default function Voice() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.5}
      caption={
        <>
          One voice, seven dots. Each dot starts later by the stagger and fades in from its own
          start; the lines under the row are each dot's weight over time, and the dashed mark is
          where <code>fade()</code> is called. With “Fade out at” at its right end, it never is.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const top = { w: size.w, h: size.h * 0.55 };
        dots(
          ctx,
          top,
          ink,
          frame.poses.map((p) => ({
            lift: p.lift ?? 0,
            color: ink.voice('v1'),
            alpha: 0.2 + 0.8 * (p.envelope ?? 0),
          })),
          { baseline: 0.85, range: 0.65 },
        );

        const box = { x: 12, y: size.h * 0.6, w: size.w - 24, h: size.h * 0.4 - 12 };
        const series = row.map((_, i) => ({
          color: ink.voice('v1'),
          width: i === 0 ? 2.5 : 1.25,
          points: frame.history.map((h) => [h.t, h.values[i] ?? 0] as [number, number]),
        }));
        trace(ctx, box, ink, series, {
          t: DURATION,
          span: DURATION,
          min: -0.05,
          max: 1.1,
          label: 'Weight per dot',
        });

        const px = (t: number) => box.x + (t / DURATION) * box.w;
        ctx.lineWidth = 1;
        if (fades(c)) {
          ctx.strokeStyle = ink.soft;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(Math.round(px(c.fadeAt)) + 0.5, box.y);
          ctx.lineTo(Math.round(px(c.fadeAt)) + 0.5, box.y + box.h);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.strokeStyle = ink.ink;
        ctx.beginPath();
        ctx.moveTo(Math.round(px(frame.t)) + 0.5, box.y);
        ctx.lineTo(Math.round(px(frame.t)) + 0.5, box.y + box.h);
        ctx.stroke();
      }}
    />
  );
}
