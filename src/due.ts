import type { Mixer } from './mixer.js';
import type { Voice } from './voice.js';

/** One entry in a mix's due queue; stale once its voice has been scheduled again. */
export interface Due<I, O> {
  at: number;
  voice: Voice<I, O>;
  token: number;
}

/**
 * The earliest mix time `moveTo` would change a voice: its start, its anchored out, the end of
 * its last pass, the end of its fade or of a subject's ramp out; -Infinity where it must be
 * visited every frame, Infinity where nothing will happen until a handle or anchor changes it.
 * Early is safe, since a visit that finds nothing due schedules again; late is not, so anything
 * that can bring it earlier calls `schedule`.
 */
function dueOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number {
  if (voice.state === 'done') return Number.POSITIVE_INFINITY;
  // An owner and the voices it holds run on clocks that move with it, so each is visited every frame.
  if (Number.isNaN(voice.opened) || voice.owner !== null || voice.holding !== null)
    return Number.NEGATIVE_INFINITY;
  let due = Number.POSITIVE_INFINITY;
  if (voice.parts !== null)
    for (const r of voice.parts.values()) due = Math.min(due, r.at + r.over);
  const back = voice.back;
  if (back !== null) due = Math.min(due, back.at + (1 - back.from) * back.over);
  if (voice.state === 'pending')
    return Math.min(due, Number.isNaN(voice.start) ? due : voice.start);
  // A ramp through 0 turns the clock around, which is looked for each frame until it has.
  if (voice.turns) return Number.NEGATIVE_INFINITY;
  if (voice.state === 'fading') {
    const out = voice.out;
    if (out === null || out.rest) return Number.NEGATIVE_INFINITY;
    return Math.min(due, out.at + out.over);
  }
  due = Math.min(due, voice.outAt);
  if (voice.state === 'frozen') {
    const at = Number.isNaN(mix.now) ? Number.NaN : voice.elapsedAt(mix.now);
    // Frozen at its start, having run back to it, it stays while its rate is never above 0,
    // until a handle or a subject staggered ahead of every other moves it.
    const r = voice.ramp;
    const never = r === null ? voice.rate <= 0 : r.from <= 0 && r.to <= 0;
    if (never && !voice.beginless && at <= voice.soonest) return due;
    // Frozen at its end, it goes live again once its clock is back before it: by a seek, by a
    // subject staggered later than any before, or by running back, which is checked each frame
    // while it can.
    if (voice.rate <= 0 || r !== null) return Number.NEGATIVE_INFINITY;
    if (at < voice.span + voice.latest) return Number.NEGATIVE_INFINITY;
  }
  if (voice.state === 'live') due = Math.min(due, voice.endsAt());
  return due;
}

/** Files a voice in the due queue at its current due, replacing any entry it had. */
export function schedule<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  if (mix.projecting) return;
  mix.lanes?.voiceChanged(voice.id);
  const token = ++voice.dueToken;
  const due = dueOf(mix, voice);
  if (due === Number.POSITIVE_INFINITY) return;
  const heap = mix.due;
  heap.push({ at: Number.isNaN(due) ? Number.NEGATIVE_INFINITY : due, voice, token });
  let i = heap.length - 1;
  while (i > 0) {
    const up = (i - 1) >> 1;
    if ((heap[up] as Due<I, O>).at <= (heap[i] as Due<I, O>).at) break;
    [heap[up], heap[i]] = [heap[i] as Due<I, O>, heap[up] as Due<I, O>];
    i = up;
  }
}

/** Takes every current entry due by `now` off the queue, in cue order. */
export function popDue<I, O>(mix: Mixer<I, O>, now: number): Voice<I, O>[] {
  const heap = mix.due;
  const at = (k: number): number =>
    k < heap.length ? (heap[k] as Due<I, O>).at : Number.POSITIVE_INFINITY;
  const out: Voice<I, O>[] = [];
  while (heap.length > 0 && (heap[0] as Due<I, O>).at <= now) {
    const top = heap[0] as Due<I, O>;
    const last = heap.pop() as Due<I, O>;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        const m0 = at(l) < at(i) ? l : i;
        const m = at(r) < at(m0) ? r : m0;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i] as Due<I, O>, heap[m] as Due<I, O>];
        i = m;
      }
    }
    if (top.token === top.voice.dueToken && top.voice.state !== 'done') {
      top.voice.dueToken++;
      out.push(top.voice);
    }
  }
  if (out.length > 1) out.sort((a, b) => a.id - b.id);
  return out;
}
