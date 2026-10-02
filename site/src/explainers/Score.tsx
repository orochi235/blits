import { kit, sum } from '@blits/channels';
import { mix } from '@blits/index';
import { keys, patch } from '@blits/patch';
import type { Mark, Marked } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { label } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Scene, VoiceDef } from './kit/scene';

interface Row {
  id: string;
}

// One channel per voice, so each lane can show its own voice's contribution.
interface Pose {
  orb: number;
  text: number;
  tint: number;
}

const ROW: Row = { id: 'row' };

const config = f.schema({
  flight: f.number(900).range(300, 1600).step(50).label('Orb flight, ms'),
  hold: f.number(600).range(0, 1500).step(50).label('Tint hold, ms'),
  early: f.boolean(false).label('Cut the orb short at 0.8 s'),
});
type Config = ReturnType<typeof config.defaults>;

function voices(c: Config): VoiceDef<Row, Pose>[] {
  return [
    {
      name: 'orb',
      color: 'v1',
      spec: {
        name: 'orb',
        start: 300,
        loop: false,
        fade: { out: 150 },
        patch: keys<Row, Pose>(c.flight, [
          { at: 0, delta: { orb: 0 } },
          { at: 1, delta: { orb: 1 }, ease: 'ease-in-out' },
        ]),
      },
    },
    {
      name: 'text',
      color: 'v2',
      spec: {
        name: 'text',
        loop: false,
        anchor: { start: { after: 'orb' } },
        patch: keys<Row, Pose>(700, [
          { at: 0, delta: { text: 0 } },
          { at: 1, delta: { text: 1 } },
        ]),
      },
    },
    {
      name: 'tint',
      color: 'v3',
      spec: {
        name: 'tint',
        fade: { in: 200, out: 1400 },
        anchor: { in: { after: 'text' }, out: { after: 'text', by: c.hold } },
        patch: patch<Row, Pose>(0, () => ({ tint: 1 }), { writes: ['tint'] }),
      },
    },
  ];
}

function scene(c: Config): Scene<Row, Pose, Config> {
  return {
    kit: kit<Pose>({ orb: sum(), text: sum(), tint: sum() }),
    subjects: () => [ROW],
    voices: () => voices(c),
    events: () => (c.early ? [{ at: 800, run: (_m, handles) => handles[0]?.fade() }] : []),
  };
}

/** The marks the plan holds at time `t`, read off a mix played to it. */
function marksAt(c: Config, t: number): Marked[] {
  // History keeps the voices that have left, so their marks stay listed.
  const m = mix<Row, Pose>(kit<Pose>({ orb: sum(), text: sum(), tint: sum() }), {
    history: { ms: DURATION },
  });
  const handles = voices(c).map((v) => m.cue(v.spec));
  m.sync(0);
  if (c.early && t >= 800) {
    m.sync(800);
    handles[0]?.fade();
  }
  m.sync(t);
  return m.marks(0, DURATION);
}

const DURATION = 5000;
const LANES = ['orb', 'text', 'tint'] as const;

export default function Score() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.42}
      caption="Each lane is one voice. The bar runs from its start to its end, with its fades shaded; the dashed lines are the anchors it hangs from. Cut the orb short and everything after it moves up."
      draw={(ctx, frame, size, ink, c) => {
        const left = 56;
        const right = size.w - 16;
        const top = 24;
        const lane = (size.h - top - 30) / LANES.length;
        const x = (t: number) => left + (t / DURATION) * (right - left);
        const marks = marksAt(c, frame.t);
        const markOf = (name: string, mark: Mark) =>
          marks.find((e) => e.name === name && e.mark === mark)?.timestamp;
        const pose = frame.poses[0];

        LANES.forEach((name, i) => {
          const y = top + lane * i + lane / 2;
          const color = ink.voice(`v${i + 1}`);
          label(ctx, name, 12, y + 4, ink.soft, 'left', true);
          const s = markOf(name, 'start');
          const inn = markOf(name, 'in');
          const out = markOf(name, 'out');
          const end = markOf(name, 'end');
          if (s === undefined) {
            label(ctx, 'pending', x(0) + 4, y + 4, ink.soft);
            return;
          }
          const h = lane * 0.42;
          const stop = end ?? DURATION;
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.25;
          ctx.fillRect(x(s), y - h / 2, x(stop) - x(s), h);
          ctx.globalAlpha = 1;
          // Full weight between in and out, solid.
          const a = inn ?? s;
          const b = out ?? stop;
          ctx.fillRect(x(a), y - h / 2, Math.max(0, x(b) - x(a)), h);
          // What it contributes now.
          const v = (pose?.[name] as number | undefined) ?? 0;
          ctx.fillStyle = ink.ink;
          ctx.fillRect(x(frame.t) + 3, y + h / 2 - v * h, 4, v * h);
        });

        // Anchors: text starts at the orb's end; the tint is in at the text's end.
        ctx.strokeStyle = ink.soft;
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        for (const [from, to] of [
          ['orb', 'text'],
          ['text', 'tint'],
        ] as const) {
          const t = markOf(from, 'end');
          if (t === undefined) continue;
          const i = LANES.indexOf(from);
          const j = LANES.indexOf(to);
          ctx.beginPath();
          ctx.moveTo(x(t), top + lane * i + lane / 2);
          ctx.lineTo(x(t), top + lane * j + lane / 2);
          ctx.stroke();
        }
        ctx.setLineDash([]);

        ctx.strokeStyle = ink.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(x(frame.t), top - 6);
        ctx.lineTo(x(frame.t), size.h - 24);
        ctx.stroke();
        label(ctx, `${(frame.t / 1000).toFixed(2)} s`, x(frame.t), size.h - 8, ink.soft, 'center');
      }}
    />
  );
}
