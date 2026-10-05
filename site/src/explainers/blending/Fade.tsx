import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import type { Easing } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { dots } from '../kit/draw';
import { Explainer, type Size } from '../kit/Explainer';
import type { Scene } from '../kit/scene';
import { type Dot, EASES, points, row, timeline } from './shared';

interface Lifted {
  lift: number;
  /** Always 1 from the patch, so what the mix hands back is the voice's weight. */
  envelope: number;
}

const FADE_DURATION = 4400;

const fadeConfig = f.schema({
  ease: f
    .enum('ease-in-out', [...EASES])
    .radio()
    .label('Fade ease'),
  at: f
    .number(2600)
    .range(0, FADE_DURATION - 200)
    .step(100)
    .suffix('ms')
    .label('Call fade() at'),
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
    events: () => [{ at: c.at, run: (_m, handles) => handles[0]?.fade() }],
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
      caption={
        <>
          A wave that fades in over 1 s, then out over 1.2 s once <code>fade()</code> is called. The
          line under the row is the voice's weight: the ease shapes both ramps. Call{' '}
          <code>fade()</code>
          before the fade in has finished and the fade out starts from wherever the weight had got
          to.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
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
          marks: [{ at: c.at, text: 'fade()' }],
        });
      }}
    />
  );
}
