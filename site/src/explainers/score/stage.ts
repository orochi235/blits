import type { Ink } from '../kit/ink';
import type { Frame } from '../kit/scene';
import { LINES, type Line, type Part, type Pose, type Syllable } from './song';

const TYPE = '600 22px Archivo, "Helvetica Neue", Arial, sans-serif';
const ROWS: { part: Part; label: string }[] = [
  { part: 'lead', label: 'lead' },
  { part: 'chorus', label: 'chorus' },
];

/** Where each syllable of a line is set: its left edge and width, a hyphen joining it to the next. */
function layout(ctx: CanvasRenderingContext2D, l: Line, x0: number) {
  const space = ctx.measureText(' ').width;
  let x = x0;
  return l.syllables.map((s) => {
    const w = ctx.measureText(s.text).width;
    const at = { s, x, w };
    x += w + (s.text.endsWith('-') ? 2 : space);
    return at;
  });
}

/**
 * The part's line to show: the one singing, else the next one waiting, else the last one sung. The
 * handle's state says which; the voices keep the time.
 */
function lineOf(part: Part, frame: Frame<Syllable, Pose>): { line: Line; index: number } | null {
  let next: number | null = null;
  let last: number | null = null;
  for (let i = 0; i < LINES.length; i++) {
    if (LINES[i]?.part !== part) continue;
    const state = frame.handles[i]?.state;
    if (state === 'live' || state === 'fading') return { line: LINES[i] as Line, index: i };
    if (state === 'pending' && next === null) next = i;
    if (state === 'done') last = i;
  }
  const i = next ?? last;
  return i === null ? null : { line: LINES[i] as Line, index: i };
}

/** The stage: each part's line, lit as it is sung, with a ball bouncing over it. */
export function stage(
  ctx: CanvasRenderingContext2D,
  box: { x: number; y: number; w: number; h: number },
  ink: Ink,
  frame: Frame<Syllable, Pose>,
): void {
  ctx.strokeStyle = ink.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  const pose = new Map(frame.subjects.map((s, i) => [s, frame.poses[i]]));
  ctx.font = TYPE;
  ctx.textBaseline = 'alphabetic';

  ROWS.forEach(({ part, label }, r) => {
    const y = box.y + box.h * (r === 0 ? 0.42 : 0.84);
    const color = ink.voice(part === 'lead' ? 'v1' : 'v2');
    ctx.font = '600 12px Archivo, "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(label, box.x + 14, y);
    const shown = lineOf(part, frame);
    if (!shown) return;
    ctx.font = TYPE;
    const set = layout(ctx, shown.line, box.x + 84);
    let ball: { from: number; to: number; p: number; lit: number } | null = null;
    set.forEach(({ s, x, w }, i) => {
      const lit = pose.get(s)?.lit ?? 0;
      ctx.globalAlpha = 1;
      ctx.fillStyle = ink.rule;
      ctx.fillText(s.text, x, y);
      if (lit > 0.001) {
        ctx.globalAlpha = Math.min(1, lit);
        ctx.fillStyle = color;
        ctx.fillText(s.text, x, y);
        const next = set[i + 1] ?? set[i];
        const hop = (pose.get(s)?.hop ?? 0) / lit;
        // The last syllable lit is the one the ball is leaving.
        ball = { from: x + w / 2, to: next ? next.x + next.w / 2 : x + w / 2, p: hop, lit };
      }
    });
    ctx.globalAlpha = 1;
    if (ball) {
      const { from, to, p, lit } = ball as { from: number; to: number; p: number; lit: number };
      const bx = from + (to - from) * p;
      const by = y - 30 - Math.sin(p * Math.PI) * 26;
      ctx.globalAlpha = Math.min(1, lit);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  });
}
