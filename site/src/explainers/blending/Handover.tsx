import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { dots } from '../kit/draw';
import { Explainer, type Size } from '../kit/Explainer';
import type { Scene } from '../kit/scene';
import { type Dot, points, row, timeline } from './shared';

const HANDOVER_DURATION = 6000;
const HANDOVER_AT = 1900;

const handoverConfig = f.schema({
  leave: f
    .enum('rest', ['rest', 'ramp'])
    .labels([
      { value: 'rest', label: 'At rest' },
      { value: 'ramp', label: 'Over 400 ms' },
    ])
    .radio()
    .label('Leave'),
  deadline: f
    .number(2500)
    .range(0, HANDOVER_DURATION - HANDOVER_AT)
    .step(100)
    .suffix('ms')
    .label('Deadline')
    .showIf((c) => c.leave === 'rest'),
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
          handles[0]?.fade(
            c.leave === 'rest' ? { at: 'rest', deadline: c.deadline } : { over: 400 },
          ),
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
      caption={
        <>
          A looping hop, staggered across the row, faded at 1.9 s. With <code>at: 'rest'</code>,
          each dot finishes its hop and leaves when it lands; the last dot never lands, so the{' '}
          <code>deadline</code> takes it, and a short enough deadline takes dots still mid-hop. With{' '}
          <code>over: 400</code>, every dot sinks at once, mid-air or not.
        </>
      }
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
        if (c.leave === 'rest') marks.push({ at: HANDOVER_AT + c.deadline, text: 'deadline' });
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
