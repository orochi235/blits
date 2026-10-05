import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import type { Setting } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { dots, label } from '../kit/draw';
import { Explainer, type Size } from '../kit/Explainer';
import type { Scene } from '../kit/scene';
import { type Dot, row } from './shared';

const BLEND_DURATION = 8000;

/** The blend signal: 0 to 1 and back once per run, read off the mix clock. */
const sweep = (t: number) => 0.5 - 0.5 * Math.cos((2 * Math.PI * t) / BLEND_DURATION);

const blendRow = row(9);
const last = blendRow.length - 1;

const shapes: { name: string; color: string; lift: (d: Dot) => number }[] = [
  { name: 'Flat', color: 'v1', lift: () => 0.3 },
  {
    name: 'Arch',
    color: 'v2',
    lift: (d) => 0.1 + 0.85 * Math.sin((Math.PI * d.i) / last),
  },
  { name: 'Ramp', color: 'v3', lift: (d) => 0.05 + 0.9 * (d.i / last) },
];

const alternatives = shapes.map((s) =>
  patch<Dot, { lift: number }>(0, (_phase, d) => ({ lift: s.lift(d) }), {
    writes: ['lift'],
  }),
);

const blendConfig = f.schema({
  signal: f
    .enum('sweep', ['sweep', 'held'])
    .labels([
      { value: 'sweep', label: 'Sweeps' },
      { value: 'held', label: 'Held' },
    ])
    .radio()
    .label('Blend signal'),
  by: f
    .number(0.5)
    .range(0, 1)
    .step(0.01)
    .label('Held at')
    .showIf((c) => c.signal === 'held'),
});
type BlendConfig = ReturnType<typeof blendConfig.defaults>;

const blendBy = (c: BlendConfig, t: number) => (c.signal === 'held' ? c.by : sweep(t));

function blendScene(c: BlendConfig): Scene<Dot, { lift: number }, BlendConfig> {
  return {
    kit: kit<{ lift: number }>({ lift: sum() }),
    subjects: () => blendRow,
    voices: () => [],
    events: () => [
      {
        at: 0,
        run: (m) => {
          m.blend(alternatives, (_d: Dot, s: Setting) => blendBy(c, s.timestamp));
        },
      },
    ],
  };
}

export function Blend() {
  return (
    <Explainer
      scene={blendScene}
      schema={blendConfig}
      duration={BLEND_DURATION}
      aspect={0.46}
      caption={
        <>
          Three poses of one row, cued with <code>mix.blend</code> and a signal that sweeps from 0
          to 1 and back, or holds wherever you set it. The faint dots are each pose alone; the solid
          ones are what the mix makes.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const top: Size = { w: size.w, h: size.h * 0.74 };
        const opts = { baseline: 0.92, range: 0.8 };
        for (const s of shapes) {
          dots(
            ctx,
            top,
            ink,
            blendRow.map((d) => ({
              lift: s.lift(d),
              scale: 0.55,
              color: ink.voice(s.color),
              alpha: 0.35,
            })),
            opts,
          );
        }
        dots(
          ctx,
          top,
          ink,
          frame.poses.map((p) => ({ lift: p.lift ?? 0, color: ink.ink })),
          opts,
        );

        const k = blendBy(c, frame.t);
        const left = 60;
        const right = size.w - 60;
        const y = size.h * 0.86;
        const px = (u: number) => left + u * (right - left);
        ctx.strokeStyle = ink.rule;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
        ctx.stroke();
        shapes.forEach((s, i) => {
          const at = px(i / (shapes.length - 1));
          ctx.fillStyle = ink.voice(s.color);
          ctx.beginPath();
          ctx.arc(at, y, 4, 0, Math.PI * 2);
          ctx.fill();
          label(ctx, s.name, at, y + 22, ink.voice(s.color), 'center');
        });
        ctx.fillStyle = ink.ink;
        ctx.beginPath();
        ctx.moveTo(px(k), y - 5);
        ctx.lineTo(px(k) - 6, y - 15);
        ctx.lineTo(px(k) + 6, y - 15);
        ctx.closePath();
        ctx.fill();
        label(ctx, `by ${k.toFixed(2)}`, px(k), y - 21, ink.ink, 'center');
      }}
    />
  );
}
