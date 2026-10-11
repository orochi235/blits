import type { Listed } from './book.js';
import type { Mixer } from './mixer.js';
import { startOf } from './place.js';
import type { Transport } from './transport.js';
import type { Mark } from './types.js';
import { none, type Voice } from './voice.js';

/** The host timestamp the mix clock reads mix time `t` at; Infinity where it never will. */
export function hostOf<I, O>(mix: Mixer<I, O>, t: number): number {
  return (mix.pace === null ? t : mix.pace.timeOf(t)) + mix.offset;
}

/** What the mix clock reads at host time `u`, by the clock in force then. */
export function readingAt<I, O>(mix: Mixer<I, O>, u: number): number {
  return mix.pace === null ? u : mix.pace.reading(u);
}

/** Every mark between two host timestamps, earliest first, with the order that tells each apart. */
export function listed<I, O>(mix: Mixer<I, O>, from: number, to: number): Listed[] {
  const out = voiceMarks(mix, from, to);
  for (const a of announcedMarks(mix.transport, from, to))
    if (a.score !== undefined || a.slot === mix.slot) out.push(a.listed);
  return sorted(out);
}

/** Every mark of every mix on a transport and every one announced on it, earliest first. */
export function listedAll(transport: Transport, from: number, to: number): Listed[] {
  const out: Listed[] = [];
  for (const m of transport.members) out.push(...voiceMarks(m, from, to));
  for (const a of announcedMarks(transport, from, to)) out.push(a.listed);
  return sorted(out);
}

function sorted(out: Listed[]): Listed[] {
  return out.sort((a, b) => a.timestamp - b.timestamp || a.order - b.order);
}

function announcedMarks(
  transport: Transport,
  from: number,
  to: number,
): { score: string | undefined; slot: number; listed: Listed }[] {
  const lo = from - transport.offset;
  const hi = to - transport.offset;
  const out: { score: string | undefined; slot: number; listed: Listed }[] = [];
  for (const a of transport.announced)
    if (a.at >= lo && a.at <= hi)
      out.push({
        score: a.score,
        slot: a.slot,
        listed: {
          timestamp: a.at + transport.offset,
          mark: undefined,
          voice: undefined,
          score: a.score,
          name: a.name,
          tags: a.tags,
          mix: a.mix,
          order: a.order,
        },
      });
  return out;
}

function voiceMarks<I, O>(mix: Mixer<I, O>, from: number, to: number): Listed[] {
  const lo = from - mix.offset;
  const hi = to - mix.offset;
  const out: Listed[] = [];
  for (const voice of [...mix.cued, ...mix.gone]) {
    for (const mark of ['start', 'in', 'coast', 'out', 'end'] as const) {
      const m = markOf(mix, voice, mark);
      const t = m === undefined ? m : hostOf(mix, m) - mix.offset;
      if (t === undefined || t < lo || t > hi) continue;
      out.push({
        timestamp: t + mix.offset,
        mark,
        voice: voice.id,
        score: voice.spec.score,
        name: voice.spec.name,
        tags: voice.spec.tags ?? none,
        mix: mix.name,
        order: voice.id,
      });
    }
  }
  return out;
}

/** When a voice reaches a mark, mix time, or undefined while nothing has fixed it. */
export function markOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, mark: Mark): number | undefined {
  if (!Number.isFinite(voice.start)) return undefined;
  // A mark is known only while every clock above it is fixed.
  const start = startOf(voice);
  if (!Number.isFinite(start)) return undefined;
  if (mark === 'start') return start;
  if (mark === 'in') return start + (voice.fade.in ?? 0);
  if (mark === 'coast') return coastOf(mix, voice, start);
  const out = voice.out;
  let outAt: number | undefined;
  if (out !== null) outAt = out.at;
  else if (Number.isFinite(voice.outAt)) outAt = voice.outAt;
  else if (voice.fitting !== null) {
    const t = voice.timeAt(voice.fitting.end);
    if (Number.isFinite(t)) outAt = Math.max(start, t);
  } else if (!(voice.backs ? voice.freezesBefore : voice.freezesAfter)) {
    const t = voice.endsAt();
    if (Number.isFinite(t)) outAt = Math.max(start, t);
  }
  if (mark === 'out') return voice.state === 'done' && outAt === undefined ? voice.doneAt : outAt;
  if (voice.state === 'done') return voice.doneAt;
  if (out !== null) {
    if (out.rest) return out.deadline === undefined ? undefined : out.at + out.deadline;
    return out.at + out.over;
  }
  const over = Number.isNaN(voice.outOver) ? (voice.fade.out ?? 0) : voice.outOver;
  return outAt === undefined ? undefined : outAt + (mix.reduced ? 0 : over);
}

/**
 * When a voice's last pass ends, mix time: an owner's when its fit ends, or its last child's. None
 * for a voice that never ends its passes, or that leaves or begins to fade before they end.
 */
function coastOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, start: number): number | undefined {
  if (voice.unplayed) return undefined;
  let t: number | undefined;
  if (voice.fitting !== null) t = voice.timeAt(voice.fitting.end);
  else if (voice.holding !== null) {
    const children = voice.holding.children;
    if (children.length === 0) return undefined;
    t = Number.NEGATIVE_INFINITY;
    for (const child of children) {
      const c = markOf(mix, child, 'coast');
      if (c === undefined) return undefined;
      t = Math.max(t, c);
    }
  } else t = voice.endsAt();
  if (t === undefined || !Number.isFinite(t)) return undefined;
  t = Math.max(start, t);
  const cut =
    voice.out !== null ? voice.out.at : voice.state === 'done' ? voice.doneAt : voice.outAt;
  return cut < t ? undefined : t;
}
