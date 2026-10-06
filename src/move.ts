import { changed, unindex } from './chain.js';
import { popDue, schedule } from './due.js';
import { beginFade, part, retire } from './fade.js';
import { started } from './held.js';
import type { Mixer } from './mixer.js';
import { ownerReading } from './owner.js';
import { mixAt, place, repin, startOf } from './place.js';
import { unplay } from './strays.js';
import type { Voice } from './voice.js';

/** Numbers every mix's frames apart, so a blend's read is never taken for another mix's or frame's. */
let frames = 0;

/** The next frame among every mix's. */
export function nextFrame(): number {
  return ++frames;
}

/** Whether a sync that leaves the mix clock where it was still has something to land. */
export function waits<I, O>(mix: Mixer<I, O>): boolean {
  return mix.stirred || mix.anchored > 0 || (mix.pins !== null && mix.pins.size > 0);
}

/** Moves the mix clock to `now`: voices start, finite loops end, and fades finish. */
export function move<I, O>(mix: Mixer<I, O>, now: number): void {
  mix.moving = true;
  try {
    moveTo(mix, now);
  } finally {
    mix.moving = false;
  }
}

function moveTo<I, O>(mix: Mixer<I, O>, now: number): void {
  mix.now = now;
  mix.frame = nextFrame();
  mix.reducedNow = mix.reduced;
  for (const a of mix.announced) if (Number.isNaN(a.at)) a.at = mix.u;
  if (mix.pins !== null && mix.pins.size > 0) repin(mix);
  if (mix.anchored > 0) place(mix);
  if (mix.announced.length > 0) {
    // Kept while still ahead, or while history reaches it; anchors waiting on one were placed above.
    const reach = now - (mix.opts.history?.ms ?? 0);
    mix.announced = mix.announced.filter((a) => mixAt(mix, a.at) >= reach);
  }
  // A live mix visits only the voices due by now; a projection, which copies few, visits all.
  const visit = mix.projecting || mix.walkAll ? mix.cued : popDue(mix, now);
  for (const voice of visit) {
    if (voice.state === 'done') continue;
    if (Number.isNaN(voice.opened)) voice.opened = now;
    if ((voice.state === 'live' || voice.state === 'frozen') && voice.outAt <= now)
      beginFade(mix, voice, {}, Math.max(startOf(voice), voice.outAt));
    if (
      voice.state === 'pending' &&
      (voice.owner === null ? now : ownerReading(voice.owner, now)) >= voice.start
    ) {
      voice.state = 'live';
      started(mix, voice);
      changed(mix, voice);
    }
    if (voice.state !== 'pending' && Number.isFinite(voice.span)) {
      const end = voice.span + voice.latest;
      if (voice.elapsedAt(now) >= end) {
        voice.play(true, now);
        // The fade starts when the last pass ended, not at the frame that noticed, so it plays
        // the same at any frame rate and a read at another time can find it.
        if (voice.state === 'live') {
          if (voice.freezesAfter) voice.state = 'frozen';
          else
            beginFade(mix, voice, {}, Math.max(startOf(voice), Math.min(now, voice.timeAt(end))));
        }
      } else if (voice.state === 'frozen') voice.state = 'live';
    }
    // A projection reads a finished ramp as weight 0, and leaves the live voice's subjects be.
    if (voice.parts !== null && !mix.projecting)
      for (const [subject, r] of voice.parts)
        if (now - r.at >= r.over) part(mix, voice, subject, r.at + r.over);
    if (voice.state === 'fading' && voice.out) {
      const { at, over, rest, deadline } = voice.out;
      const spent = now - at;
      if (rest) {
        const out = deadline !== undefined && spent >= deadline;
        const settled = voice.seen > 0 && voice.restedCount >= voice.seen;
        if (out) retire(mix, voice, at + (deadline as number));
        else if (settled) retire(mix, voice);
      } else if (spent >= over) retire(mix, voice, at + over);
    }
    if (!mix.projecting) schedule(mix, voice);
  }
  mix.stirred = false;
  if (mix.retired.length > 0) prune(mix);
  forget(mix, now);
}

/** Past this many voices retiring in one frame, one pass over the list beats a search for each. */
const SEARCHED = 8;

/**
 * Takes the voices retired since the last prune out of the list, in list order. A few are found by
 * their id, which the list is in order of, so the voices still in it are not read.
 */
function prune<I, O>(mix: Mixer<I, O>): void {
  const retired = mix.retired;
  mix.retired = [];
  const voices = mix.cued;
  let at: number[] | null = null;
  // A projection's list holds copies of voices gone before it, which only a pass takes out.
  if (retired.length <= SEARCHED && !mix.projecting) {
    if (retired.length > 1) retired.sort((a, b) => a.id - b.id);
    at = [];
    for (let k = 0; k < retired.length; k++) {
      const voice = retired[k] as Voice<I, O>;
      const i = voice === retired[k - 1] ? -1 : indexOf(voices, voice);
      if (i < 0) {
        at = null;
        break;
      }
      at.push(i);
    }
  }
  let pruned = false;
  if (at !== null) {
    for (const voice of retired) pruned = leave(mix, voice) || pruned;
    for (let k = at.length - 1; k >= 0; k--) voices.splice(at[k] as number, 1);
  } else {
    let kept = 0;
    for (let i = 0; i < voices.length; i++) {
      const voice = voices[i] as Voice<I, O>;
      if (voice.state !== 'done') voices[kept++] = voice;
      else pruned = leave(mix, voice) || pruned;
    }
    voices.length = kept;
  }
  if (pruned) mix.general = mix.general.filter((v) => v.state !== 'done');
}

/** The voice's place in a list in id order, or -1 where it is not there. */
function indexOf<I, O>(voices: readonly Voice<I, O>[], voice: Voice<I, O>): number {
  let lo = 0;
  let hi = voices.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const id = (voices[mid] as Voice<I, O>).id;
    if (id === voice.id) return voices[mid] === voice ? mid : -1;
    if (id < voice.id) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}

/** Lets go of a retired voice's place in the mix; whether it was among the voices naming no subject. */
function leave<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): boolean {
  if (mix.opts.history) mix.gone.push(voice);
  else mix.parters.delete(voice);
  unplay(mix, voice);
  changed(mix, voice);
  if (voice.named !== null) unindex(mix, voice);
  if (voice.holding !== null && mix.owners !== null)
    mix.owners = mix.owners.filter((v) => v !== voice);
  if (voice.spec.locus !== undefined) mix.loci--;
  if (voice.spec.anchor !== undefined) mix.anchored--;
  return voice.named === null;
}

/** Lets go of the voices that have left and that history no longer reaches. */
export function forget<I, O>(mix: Mixer<I, O>, now: number): void {
  const history = mix.opts.history;
  if (history && mix.gone.length > 0) {
    const reach = now - history.ms;
    mix.gone = mix.gone.filter((v) => v.doneAt >= reach);
  }
}
