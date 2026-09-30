import { hex, kit, mixHex, mul, sum } from '@blits/channels';
import { keys, patch } from '@blits/patch';
import { f } from '@weasel-js/labkit';
import { label } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene, VoiceDef } from './kit/scene';

interface Swatch {
  i: number;
}
interface Pose {
  gain: number;
  lift: number;
  color?: number;
}

const config = f.schema({
  pulse: f.boolean(true).label('Pulse'),
  wave: f.boolean(true).label('Wave'),
  tint: f.boolean(true).label('Tint'),
});
type Config = ReturnType<typeof config.defaults>;

const swatches: Swatch[] = [0, 1, 2, 3, 4].map((i) => ({ i }));

const PART = kit<Pose>({ gain: mul(), lift: sum(), color: hex() });

const pulse = patch<Swatch, Pose>(
  2400,
  (phase, s) => ({ gain: 0.6 + 0.4 * Math.sin(phase * 2 * Math.PI + s.i * 0.9) }),
  { writes: ['gain'] },
);

const wave = keys<Swatch, Pose>(
  1600,
  [
    { at: 0, delta: { lift: 0 } },
    { at: 0.5, delta: { lift: 1 }, ease: 'ease-out' },
    { at: 1, delta: { lift: 0 }, ease: 'ease-in' },
  ],
  {},
);

const tint = keys<Swatch, Pose>(
  6000,
  [
    { at: 0, delta: { color: 0x2f66d8 } },
    { at: 0.33, delta: { color: 0xc23d7a } },
    { at: 0.66, delta: { color: 0xd99a12 } },
    { at: 1, delta: { color: 0x2f66d8 } },
  ],
  { lerpBy: (c) => (c === 'color' ? (mixHex as never) : undefined) },
);

function scene(c: Config): Scene<Swatch, Pose, Config> {
  const voices: VoiceDef<Swatch, Pose>[] = [];
  if (c.pulse)
    voices.push({ name: 'Pulse', color: 'v1', spec: { patch: pulse, fade: { in: 400 } } });
  if (c.wave)
    voices.push({
      name: 'Wave',
      color: 'v2',
      spec: { patch: wave, stagger: (s) => s.i * 140, fade: { in: 400 } },
    });
  if (c.tint) voices.push({ name: 'Tint', color: 'v3', spec: { patch: tint } });
  return {
    kit: PART,
    subjects: () => swatches,
    voices: () => voices,
    ledger: { subject: (all) => all[2] as Swatch, channels: ['gain', 'lift', 'color'] },
  };
}

const css = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export default function Home() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={12000}
      aspect={0.36}
      caption="Five subjects under three voices. Each voice runs on its own clock, and the mix folds whatever is playing into one pose per swatch: its gain, its lift and its color. Switch a voice off and the others carry on."
      format={{ color: (v) => (typeof v === 'number' ? css(v) : '—') }}
      draw={(ctx, frame, size, ink) => {
        const n = frame.subjects.length;
        const gap = size.w / (n + 1);
        const side = Math.min(gap * 0.62, size.h * 0.36);
        const base = size.h * 0.78;
        frame.poses.forEach((pose, i) => {
          const cx = gap * (i + 1);
          const y = base - side - (pose.lift ?? 0) * size.h * 0.3;
          ctx.globalAlpha = 0.25 + 0.75 * Math.max(0, Math.min(1, pose.gain ?? 1));
          ctx.fillStyle = pose.color === undefined ? ink.soft : css(pose.color);
          ctx.fillRect(cx - side / 2, y, side, side);
          ctx.globalAlpha = 1;
        });
        ctx.strokeStyle = ink.rule;
        ctx.beginPath();
        ctx.moveTo(gap / 2, base + 0.5);
        ctx.lineTo(size.w - gap / 2, base + 0.5);
        ctx.stroke();
        label(ctx, 'Subject', gap * 3, base + 20, ink.soft, 'center');
      }}
    />
  );
}
