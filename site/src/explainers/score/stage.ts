import type { Ink } from '../kit/ink';
import type { Frame } from '../kit/scene';
import {
  chordName,
  LINES,
  type Line,
  type Part,
  type Pose,
  type SongConfig,
  type Syllable,
} from './song';

const TYPE = '600 22px Archivo, "Helvetica Neue", Arial, sans-serif';
const ROWS: { part: Part; color: string; at: number }[] = [
  { part: 'lead', color: 'v1', at: 0.34 },
  { part: 'chorus', color: 'v2', at: 0.66 },
  { part: 'chords', color: 'v4', at: 0.9 },
];

/** Where each syllable of a line is set: its left edge and width, a hyphen joining it to the next. */
function layout(ctx: CanvasRenderingContext2D, l: Line, x0: number, text: (s: Syllable) => string) {
  const space = ctx.measureText(' ').width * (l.part === 'chords' ? 3 : 1);
  let x = x0;
  return l.syllables.map((s) => {
    const w = ctx.measureText(text(s)).width;
    const at = { s, x, w };
    x += w + (s.text.endsWith('-') ? 2 : space);
    return at;
  });
}

/**
 * The part's line to show: the one sounding, else the next one waiting, else the last one done. The
 * handle's state says which; the voices keep the time.
 */
function lineOf(part: Part, frame: Frame<Syllable, Pose>): Line | null {
  const mine = frame.voices.flatMap((v, i) => {
    const line = LINES.find((o) => o.name === v.name);
    return line?.part === part ? [{ line, state: frame.handles[i]?.state }] : [];
  });
  const now = mine.find((m) => m.state === 'live' || m.state === 'fading' || m.state === 'frozen');
  const next = mine.find((m) => m.state === 'pending');
  const done = mine.filter((m) => m.state === 'done').at(-1);
  return (now ?? next ?? done)?.line ?? null;
}

/** The stage: each part's line, lit as it is sung, with a ball bouncing over the sung ones. */
export function stage(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  frame: Frame<Syllable, Pose>,
  c: SongConfig,
): void {
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  const pose = new Map(frame.subjects.map((s, i) => [s, frame.poses[i]]));
  ctx.textBaseline = 'alphabetic';

  for (const { part, color: slot, at } of ROWS) {
    const y = box.y + box.h * at;
    const color = ink.voice(slot);
    ctx.font = '600 12px Archivo, "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(part, box.x + 14, y);
    const shown = lineOf(part, frame);
    if (!shown) continue;
    ctx.font = TYPE;
    const text = (s: Syllable) => (part === 'chords' ? chordName(s.step, c) : s.text);
    const set = layout(ctx, shown, box.x + 84, text);
    let ball: { from: number; to: number; p: number; lit: number } | null = null;
    set.forEach(({ s, x, w }, i) => {
      const lit = pose.get(s)?.lit ?? 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink.rule;
      ctx.fillText(text(s), x, y);
      if (lit <= 0.001) return;
      ctx.globalAlpha = Math.min(1, lit);
      ctx.fillStyle = color;
      ctx.fillText(text(s), x, y);
      const next = set[i + 1] ?? set[i];
      // The last syllable lit is the one the ball is leaving.
      const hop = (pose.get(s)?.hop ?? 0) / lit;
      ball = { from: x + w / 2, to: next ? next.x + next.w / 2 : x + w / 2, p: hop, lit };
    });
    ctx.globalAlpha = 1;
    if (ball && part !== 'chords') {
      const { from, to, p, lit } = ball as { from: number; to: number; p: number; lit: number };
      ctx.globalAlpha = Math.min(1, lit);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(from + (to - from) * p, y - 30 - Math.sin(p * Math.PI) * 22, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}
