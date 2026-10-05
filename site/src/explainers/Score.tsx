import { kit, sum } from '@blits/channels';
import { mix } from '@blits/index';
import { keys, patch } from '@blits/patch';
import type { Mark, Marked } from '@blits/types';
import { f } from '@weasel-js/labkit';
import { label, lamp } from './kit/draw';
import { Explainer } from './kit/Explainer';
import type { Ink } from './kit/ink';
import { FRAME, type Frame, type Scene, type VoiceDef } from './kit/scene';

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
const DURATION = 5000;
const ORB_START = 300;

const config = f.schema({
  flight: f.number(900).range(300, 1600).step(50).label('Orb flight, ms'),
  hold: f.number(600).range(0, 1500).step(50).label('Tint hold, ms'),
  cut: f.number(DURATION).range(0, DURATION).step(50).suffix('ms').label('Cut the orb at'),
});
type Config = ReturnType<typeof config.defaults>;

function voices(c: Config): VoiceDef<Row, Pose>[] {
  return [
    {
      name: 'orb',
      color: 'v1',
      spec: {
        name: 'orb',
        start: ORB_START,
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
    events: () => (cuts(c) ? [{ at: c.cut, run: (_m, handles) => handles[0]?.fade() }] : []),
  };
}

/** Whether the cut lands before the orb would have landed on its own; at or after that, nothing to cut. */
const cuts = (c: Config) => c.cut < ORB_START + c.flight;

/** The marks the plan holds at time `t`, read off a mix played to it. */
function marksAt(c: Config, t: number): Marked[] {
  // History keeps the voices that have left, so their marks stay listed.
  const m = mix<Row, Pose>(kit<Pose>({ orb: sum(), text: sum(), tint: sum() }), {
    history: { ms: DURATION },
  });
  const handles = voices(c).map((v) => m.cue(v.spec));
  if (cuts(c) && t >= c.cut) {
    // The player runs an event before the first frame at or past it, so the mix last synced a frame earlier.
    const before = Math.ceil(c.cut / FRAME - 1e-6) * FRAME - FRAME;
    if (before >= 0) m.sync(before);
    handles[0]?.fade();
  }
  m.sync(t);
  return m.marks(0, DURATION);
}

const TYPE = '600 22px Archivo, "Helvetica Neue", Arial, sans-serif';

/**
 * The scene the score plays: the orb flies along its arc, the line types in, the tint washes the
 * stage. Each reads its channel off the folded pose; nothing here keeps time of its own.
 */
function stage(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  frame: Frame<Row, Pose>,
  c: Config,
): void {
  const LINE = cuts(c) ? 'The orb was cut short.' : 'The orb has landed.';
  const pose = frame.poses[0];
  const orb = pose?.orb ?? 0;
  const text = pose?.text ?? 0;
  const tint = pose?.tint ?? 0;

  ctx.fillStyle = ink.voice('v3');
  ctx.globalAlpha = 0.32 * Math.max(0, Math.min(1, tint));
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);

  const from = box.x + 48;
  const to = box.x + box.w - 48;
  const ground = box.y + box.h * 0.5;
  const rise = box.h * 0.3;
  const at = (p: number) => ({
    x: from + p * (to - from),
    y: ground - Math.sin(p * Math.PI) * rise,
  });

  ctx.strokeStyle = ink.rule;
  ctx.setLineDash([3, 4]);
  ctx.beginPath();
  for (let i = 0; i <= 40; i++) {
    const { x, y } = at(i / 40);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of [0, 1]) {
    ctx.beginPath();
    ctx.moveTo(at(p).x - 14, ground + 18);
    ctx.lineTo(at(p).x + 14, ground + 18);
    ctx.stroke();
  }

  // The folded orb is its position times the voice's weight, so the weight is split back out to
  // place the orb, and lights it instead: a fade dims the orb rather than dragging it home.
  const handle = frame.handles[0];
  const weight = handle ? handle.weightOf(ROW) : 0;
  if (weight > 0.001) {
    const p = at(Math.max(0, Math.min(1, orb / weight)));
    lamp(ctx, ink, p.x, p.y, 13, weight, ink.voice('v1'));
  } else if (handle?.state !== 'done') {
    lamp(ctx, ink, at(0).x, at(0).y, 13, 0, ink.voice('v1'));
  }

  ctx.font = TYPE;
  ctx.textAlign = 'left';
  const width = ctx.measureText(LINE).width;
  const tx = box.x + (box.w - width) / 2;
  const ty = box.y + box.h - 26;
  ctx.fillStyle = ink.rule;
  ctx.globalAlpha = 0.5;
  ctx.fillText(LINE, tx, ty);
  ctx.globalAlpha = 1;
  const typed = LINE.slice(0, Math.round(Math.max(0, Math.min(1, text)) * LINE.length));
  if (text > 0) {
    ctx.fillStyle = ink.voice('v2');
    ctx.fillText(typed, tx, ty);
    if (text < 1) {
      const cx = tx + ctx.measureText(typed).width + 2;
      ctx.fillRect(cx, ty - 18, 2, 22);
    }
  }
}

const LANES = ['orb', 'text', 'tint'] as const;

export default function Score() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={DURATION}
      aspect={0.8}
      caption="Above, the scene the score plays: the orb flies, the line types in, the tint washes the stage. Below, each lane is one voice. The bar runs from its start to its end, with its fades shaded; the dashed lines are the anchors it hangs from. Drag the cut earlier than the landing and the orb fades out mid-flight there, and everything after it moves up with it; at the right end it is never cut."
      draw={(ctx, frame, size, ink, c) => {
        const box = { x: 12, y: 8, w: size.w - 24, h: Math.round(size.h * 0.46) };
        stage(ctx, box, ink, frame, c);
        const left = 56;
        const right = size.w - 16;
        const top = box.y + box.h + 36;
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

        // Where the cut falls on the orb's lane, so dragging the slider moves a mark you can see.
        const orbY = top + lane / 2;
        if (c.cut >= DURATION) {
          label(ctx, 'never cut', right, orbY - lane * 0.3, ink.soft, 'right');
        } else {
          const cx = Math.round(x(c.cut)) + 0.5;
          ctx.strokeStyle = ink.voice('v1');
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, orbY - lane * 0.4);
          ctx.lineTo(cx, orbY + lane * 0.4);
          ctx.stroke();
          const text = cuts(c) ? 'fade()' : 'fade(): landed already';
          label(ctx, text, cx + 5, orbY - lane * 0.3, ink.voice('v1'), 'left', true);
        }

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
