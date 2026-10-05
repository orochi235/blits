import { kit, sum } from '@blits/channels';
import { keys } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { label } from '../kit/draw';
import { Explainer } from '../kit/Explainer';
import type { Scene } from '../kit/scene';
import { type Dot, points, timeline } from './shared';

interface Placed {
  x: number;
}

const RETARGET_DURATION = 4000;
const FIRST_TARGET = 4;
const SECOND_TARGET = 1;
const FIRST_FLIGHT = 2400;

const retargetConfig = f.schema({
  current: f.boolean(true).label('Second voice starts where the dot is'),
  at: f.number(1100).range(0, FIRST_FLIGHT).step(50).suffix('ms').label('Cut over at'),
});
type RetargetConfig = ReturnType<typeof retargetConfig.defaults>;

const one: Dot = { i: 0 };

const there = keys<Dot, Placed>(
  FIRST_FLIGHT,
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
          start: c.at,
          from: c.current ? 'current' : undefined,
        },
      },
    ],
    events: () => [{ at: c.at, run: (_m, handles) => handles[0]?.fade({ over: 0 }) }],
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
      caption={
        <>
          The first voice heads for 4. At the cut it is faded out and a second voice heads for 1.
          With <code>from: 'current'</code> the second starts where the dot is, wherever the cut
          catches it; without it, from its own first stop at 0.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
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
          const second = frame.t >= c.at;
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
          marks: [{ at: c.at, text: 'second voice' }],
        });
      }}
    />
  );
}
