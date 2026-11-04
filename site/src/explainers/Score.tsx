import type { Mark, Marked } from '@msb235/blits';
import { mix } from '@msb235/blits';
import { f } from '@weasel-js/labkit';
import { label } from './kit/draw';
import { Explainer } from './kit/Explainer';
import { FRAME, type Scene } from './kit/scene';
import { choir, primeOn, type Singers, soundWanted } from './score/sing';
import {
  K,
  KEYS,
  type Key,
  LINES,
  MODES,
  type Mode,
  type Part,
  type Pose,
  SUBJECTS,
  type Syllable,
  songMs,
  voices,
} from './score/song';
import { stage } from './score/stage';

/** The longest the song runs, at the slowest tempo and the latest answers; the cut can fall anywhere in it. */
const LONGEST = songMs({ tempo: 140, lag: 1 });
/** The voice the cut fades. */
const CUT = 'line 2';

const SOUND = 'Sound';
primeOn(SOUND);

const config = f.schema({
  sound: f.boolean(soundWanted()).label(SOUND),
  tempo: f.number(160).range(140, 200).step(5).label('Tempo, beats a minute'),
  lag: f.number(0).range(0, 1).step(0.25).label('Chorus answers late by, beats'),
  key: f.enum<Key>('D', [...KEYS]).label('Key'),
  mode: f.enum<Mode>('dorian', Object.keys(MODES) as Mode[]).label('Mode'),
  chords: f.boolean(true).label('Chords'),
  singers: f.enum<Singers>('dogs', ['dogs', 'choir']).label('Chorus sung by'),
  cut: f
    .number(Number.POSITIVE_INFINITY)
    .range(0, LONGEST)
    .step(50)
    .suffix('ms')
    .endless('never')
    .label('Cut line 2 at'),
});
type Config = ReturnType<typeof config.defaults>;

function scene(c: Config): Scene<Syllable, Pose, Config> {
  return {
    kit: K,
    subjects: () => SUBJECTS,
    voices: () => voices(c),
    attach: (m) => (c.sound ? choir(m, c.singers) : { close() {} }),
    events: () => {
      if (!Number.isFinite(c.cut)) return [];
      const i = voices(c).findIndex((v) => v.name === CUT);
      return [{ at: c.cut, run: (_m, handles) => handles[i]?.fade() }];
    },
  };
}

/** The marks the plan holds at time `t`, read off a mix played to it. */
function marksAt(c: Config, t: number): Marked[] {
  // History keeps the voices that have left, so their marks stay listed.
  const m = mix<Syllable, Pose>(K, { history: { ms: songMs(c) } });
  const handles = voices(c).map((v) => m.cue(v.spec));
  if (Number.isFinite(c.cut) && t >= c.cut) {
    // The player runs an event before the first frame at or past it, so the mix last synced a frame earlier.
    const before = Math.ceil(c.cut / FRAME - 1e-6) * FRAME - FRAME;
    if (before >= 0) m.sync(before);
    handles[voices(c).findIndex((v) => v.name === CUT)]?.fade();
  }
  m.sync(t);
  const marks = m.marks(0, songMs(c));
  m.close();
  return marks;
}

const LANES: { part: Part; color: string }[] = [
  { part: 'count', color: 'v3' },
  { part: 'lead', color: 'v1' },
  { part: 'chorus', color: 'v2' },
  { part: 'chords', color: 'v4' },
];

export default function Score() {
  return (
    <Explainer
      scene={scene}
      schema={config}
      duration={songMs}
      aspect={0.7}
      caption={
        <>
          Above, the lead sings a line and the chorus answers it, a ball bouncing over each, over
          the chords. Below, one lane per part, and each bar on it is one voice: one line, from its{' '}
          <code>start</code> to its <code>end</code>. Each answer hangs from its line's{' '}
          <code>end</code>, each line from the answer before it, and each run of chords starts{' '}
          <code>with</code> what it plays under; the dashed lines are those anchors. Cut line 2
          short and it fades out there with <code>fade()</code>, and its answer, its chords, and
          everything after come in early.
        </>
      }
      draw={(ctx, frame, size, ink, c) => {
        const box = { x: 12, y: 8, w: size.w - 24, h: Math.round(size.h * 0.5) };
        stage(ctx, box, ink, frame, c);
        const left = 76;
        const right = size.w - 16;
        const top = box.y + box.h + 28;
        const lane = (size.h - top - 30) / LANES.length;
        const span = songMs(c);
        const x = (t: number) => left + (t / span) * (right - left);
        const laneY = (part: Part) =>
          top + lane * LANES.findIndex((l) => l.part === part) + lane / 2;
        const marks = marksAt(c, frame.t);
        const markOf = (name: string, mark: Mark) =>
          marks.find((e) => e.name === name && e.mark === mark)?.timestamp;
        const h = Math.min(22, lane * 0.5);

        for (const { part } of LANES) {
          const y = laneY(part);
          ctx.strokeStyle = ink.rule;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(left, y);
          ctx.lineTo(right, y);
          ctx.stroke();
          label(ctx, part === 'count' ? 'count-in' : part, 12, y + 4, ink.soft, 'left');
        }

        const handleOf = (name: string) =>
          frame.handles[frame.voices.findIndex((v) => v.name === name)];
        for (const l of LINES) {
          const s = markOf(l.name, 'start');
          if (s === undefined) continue;
          const y = laneY(l.part);
          const end = markOf(l.name, 'end') ?? span;
          const color = ink.voice(LANES.find((n) => n.part === l.part)?.color ?? 'v1');
          ctx.fillStyle = color;
          ctx.globalAlpha = handleOf(l.name)?.state === 'pending' ? 0.35 : 0.85;
          ctx.fillRect(x(s) + 1, y - h / 2, Math.max(1, x(end) - x(s) - 2), h);
          ctx.globalAlpha = 1;
          // The anchor this voice hangs from: down or up from the lane of the voice it names.
          const from = LINES.find((o) => o.name === (l.with ?? l.after));
          if (from) {
            ctx.strokeStyle = ink.soft;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            const y0 = laneY(from.part);
            const d = y > y0 ? 1 : -1;
            ctx.moveTo(x(s) + 0.5, y0 + (d * h) / 2);
            ctx.lineTo(x(s) + 0.5, y - (d * h) / 2);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }

        // Where the cut falls on the lead's lane, so dragging the slider moves a mark you can see.
        const leadY = laneY('lead');
        if (Number.isFinite(c.cut)) {
          const cx = Math.round(x(c.cut)) + 0.5;
          ctx.strokeStyle = ink.voice('v1');
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx, leadY - lane * 0.4);
          ctx.lineTo(cx, leadY + lane * 0.4);
          ctx.stroke();
          label(ctx, 'fade()', cx + 5, leadY - lane * 0.3, ink.voice('v1'), 'left', true);
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
