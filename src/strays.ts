import { unpart } from './fade.js';
import type { Mixer } from './mixer.js';
import type { MotionOwner, Motions } from './motion.js';
import { record } from './tape.js';
import type { Voice } from './voice.js';

/** Notes a motion patch that may hold state for a subject no voice playing it reaches. */
export function stray<I, O>(mix: Mixer<I, O>, motion: Motions<I>, subject: I): void {
  const list = mix.strays.get(subject);
  if (list === undefined) mix.strays.set(subject, [motion]);
  else if (!list.includes(motion)) list.push(motion);
}

/** A motion voice left the list: if its patch plays on, its subjects' state there may stray. */
export function unplay<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): void {
  const motion = voice.motion;
  if (motion === undefined) return;
  const left = (mix.playing.get(motion) ?? 1) - 1;
  if (left <= 0) {
    mix.playing.delete(motion);
    mix.strayAll.delete(motion);
    return;
  }
  mix.playing.set(motion, left);
  if (voice.named === null) mix.strayAll.add(motion);
  else for (const subject of voice.named) stray(mix, motion, subject);
}

/**
 * What a motion patch asks of the mix playing it, by its voice's id. It holds the mix weakly, so a
 * patch the host keeps does not keep a mix it has let go of alive; a retired voice's patch no
 * longer asks.
 */
export function motionOwner<I, O>(mix: WeakRef<Mixer<I, O>>): MotionOwner {
  return {
    frame(id, subject) {
      const m = mix.deref();
      const v = m === undefined ? undefined : cuedById(m, id);
      return m === undefined || v === undefined ? Number.NaN : frameOf(m, v, subject as I);
    },
    now() {
      return mix.deref()?.now ?? Number.NaN;
    },
    changed(again) {
      const m = mix.deref();
      if (m !== undefined) record(m, 'motion', again);
    },
    revive(id, subject) {
      const m = mix.deref();
      if (m === undefined) return;
      m.stir();
      const v = cuedById(m, id);
      if (v === undefined) return;
      if (v.motion !== undefined && v.named !== null && !v.named.has(subject as I))
        stray(m, v.motion, subject as I);
      unpart(m, v, subject as I);
    },
  };
}

/** The voice in the list with this id, which is in id order. */
export function cuedById<I, O>(mix: Mixer<I, O>, id: number): Voice<I, O> | undefined {
  const cued = mix.cued;
  let lo = 0;
  let hi = cued.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = cued[mid] as Voice<I, O>;
    if (v.id === id) return v;
    if (v.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/**
 * A subject's voice time at the latest frame, where a motion patch places an untimed change and a
 * `read` with no time; NaN until the voice has started and met the subject, and while the
 * subject's own time is still short of its stagger. A retired voice's patch no longer asks.
 */
export function frameOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, subject: I): number {
  if (Number.isNaN(mix.now) || voice.state === 'pending') return Number.NaN;
  const held = voice.subjects.get(subject);
  if (held === undefined || !held.reaches) return Number.NaN;
  const t = voice.elapsedAt(mix.now) - held.delay;
  return t < 0 ? Number.NaN : t;
}
