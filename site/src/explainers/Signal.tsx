import { kit, sum } from '@blits/channels';
import { patch } from '@blits/patch';
import { gate, level, slew } from '@blits/signals';
import { f } from '@weasel-js/labkit';
import { label, lamp, trace } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene } from './kit/scene';

interface Pose {
  glow: number;
  lit: number;
}

const subject = { id: 'lamp' };

const config = f.schema({
  input: f.enum('steps', ['square', 'steps', 'sine']).radio().label('Input'),
  rise: f.number(600).range(0, 3000).step(50).suffix('ms').label('Slew rise'),
  fall: f.number(1500).range(0, 3000).step(50).suffix('ms').label('Slew fall'),
  on: f.number(0.6).range(0, 1).step(0.05).label('Gate on at'),
  off: f.number(0.4).range(0, 1).step(0.05).label('Gate off at'),
});
type Config = ReturnType<typeof config.defaults>;

const STEPS = [0.1, 0.5, 0.9, 0.5];

/** What the host would be reading at time `t`: a pointer, a hover, a meter. A function of t so a run replays. */
function input(kind: Config['input'], t: number): number {
  if (kind === 'square') return t % 4000 < 2000 ? 0.9 : 0.1;
  if (kind === 'sine') return 0.5 - 0.42 * Math.cos((2 * Math.PI * t) / 4000);
  return STEPS[Math.floor(t / 1000) % STEPS.length] as number;
}

const constant = (key: keyof Pose) =>
  patch<typeof subject, Pose>(0, () => ({ [key]: 1 }), { writes: [key] });

function scene(c: Config): Scene<typeof subject, Pose, Config> {
  const host = level<typeof subject>();
  return {
    kit: kit<Pose>({ glow: sum(), lit: sum() }),
    subjects: () => [subject],
    voices: () => [
      {
        name: 'Slewed',
        color: 'v1',
        spec: { patch: constant('glow'), weight: slew(host, { riseMs: c.rise, fallMs: c.fall }) },
      },
      {
        name: 'Gated',
        color: 'v2',
        spec: { patch: constant('lit'), weight: gate(host, { on: c.on, off: c.off }) },
      },
    ],
    // The host writes its level once a frame, before it syncs; this is that host.
    syncing: (t) => {
      host.set(input(c.input, t));
      return true;
    },
    record: ({ t, poses }) => [input(c.input, t), poses[0]?.glow ?? 0, poses[0]?.lit ?? 0],
  };
}

const SPAN = 6000;

export default function Signal() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={12000}
      aspect={0.42}
      caption="The gray line is the level the host writes. Each voice writes 1 and takes its weight from a signal: one slews toward the level, the other gates it."
      draw={(ctx, frame, size, ink, c) => {
        const side = Math.min(230, size.w * 0.3);
        const box = { x: 12, y: 12, w: size.w - side - 36, h: size.h - 40 };
        const points = (k: number) =>
          frame.history.map((h) => [h.t, h.values[k] ?? 0] as [number, number]);
        const py = (v: number) => box.y + box.h - v * box.h;

        ctx.strokeStyle = ink.soft;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        for (const [v, name] of [
          [c.on, 'on'],
          [c.off, 'off'],
        ] as const) {
          ctx.beginPath();
          ctx.moveTo(box.x, py(v) + 0.5);
          ctx.lineTo(box.x + box.w, py(v) + 0.5);
          ctx.stroke();
          label(ctx, name, box.x + box.w + 6, py(v) + 4, ink.soft);
        }
        ctx.setLineDash([]);

        trace(
          ctx,
          box,
          ink,
          [
            { color: ink.soft, points: points(0), width: 1.5 },
            { color: ink.voice('v2'), points: points(2), width: 2, dash: [6, 3] },
            { color: ink.voice('v1'), points: points(1), width: 2.5 },
          ],
          { t: frame.t, span: SPAN, min: -0.05, max: 1.05 },
        );
        label(ctx, `last ${SPAN / 1000} s`, box.x, size.h - 10, ink.soft);
        label(ctx, 'now', box.x + box.w, size.h - 10, ink.soft, 'right');

        const now = frame.history[frame.history.length - 1]?.values ?? [0, 0, 0];
        const lamps = [
          { name: 'Level', value: now[0] ?? 0, color: ink.soft },
          { name: 'Slewed', value: now[1] ?? 0, color: ink.voice('v1') },
          { name: 'Gated', value: now[2] ?? 0, color: ink.voice('v2') },
        ];
        const x = size.w - side + 24;
        const r = Math.max(8, Math.min(22, (size.h - 40) / 8, side / 7));
        const step = (size.h - 8 - 4 * r) / 2;
        lamps.forEach((l, i) => {
          const cy = 4 + 2 * r + i * step;
          lamp(ctx, ink, x + r, cy, r, l.value, l.color);
          label(ctx, l.name, x + 2 * r + 14, cy - 2, ink.ink);
          label(ctx, l.value.toFixed(3), x + 2 * r + 14, cy + 14, ink.soft, 'left', true);
        });
      }}
    />
  );
}
