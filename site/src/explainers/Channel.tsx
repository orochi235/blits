import { kit, last, max, mul, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import type { Channel as Ch } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { numberLine } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';

interface Pose {
  value: number;
}

const config = f.schema({
  channel: f.enum('sum', ['sum', 'mul', 'max', 'last']).radio().label('Channel'),
  a: f.number(0.8).range(-1, 2).step(0.05).label('Voice A writes'),
  b: f.number(1.5).range(-1, 2).step(0.05).label('Voice B writes'),
  weightA: f.number(1).range(0, 1).step(0.05).label('Weight of A'),
  weightB: f.number(1).range(0, 1).step(0.05).label('Weight of B'),
});
type Config = ReturnType<typeof config.defaults>;

const channels: Record<string, () => Ch<number>> = { sum, mul, max, last: () => last<number>() };

const subject = { id: 'field' };

function scene(c: Config): Scene<typeof subject, Pose, Config> {
  return {
    kit: kit<Pose>({ value: (channels[c.channel] ?? sum)() }),
    subjects: () => [subject],
    voices: () => [
      {
        name: 'A',
        color: 'v1',
        spec: { patch: patch(0, () => ({ value: c.a }), { writes: ['value'] }), weight: c.weightA },
      },
      {
        name: 'B',
        color: 'v2',
        spec: {
          patch: patch(
            4000,
            (phase) => ({ value: c.b * (0.75 + 0.25 * Math.cos(phase * 2 * Math.PI)) }),
            {
              writes: ['value'],
            },
          ),
          weight: c.weightB,
        },
      },
    ],
    ledger: { subject: () => subject, channels: ['value'] },
  };
}

export default function Channel() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={4000}
      aspect={0.32}
      caption="Voice A holds still and voice B breathes. The channel decides what the two make together, and its rest is where a voice at weight 0 leaves the value."
      draw={(ctx, frame, size, ink, c) => {
        const channel = (channels[c.channel] ?? sum)();
        const alone = frame.alone.map((p) => p.value);
        const folded = frame.poses[0]?.value;
        numberLine(ctx, size, ink, {
          from: -1,
          to: 3,
          rest: channel.rest,
          rows: [
            { label: 'A', color: ink.voice('v1'), value: alone[0] },
            { label: 'B', color: ink.voice('v2'), value: alone[1] },
            { label: 'Folded', color: ink.ink, value: folded, strong: true },
          ],
        });
      }}
    />
  );
}
