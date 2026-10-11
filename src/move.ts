import { changed } from './chain.js';
import { elapsedWith } from './clock.js';
import { popDue, schedule } from './due.js';
import { detour } from './everyone.js';
import { beginFade, part, retire } from './fade.js';
import { expireGone, keepGone } from './gone.js';
import { begin } from './held.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import { leave as leaveClock } from './origin.js';
import { ownerReading } from './owner.js';
import { mixAt, place, repin, startOf } from './place.js';
import { pageVoice } from './revive.js';
import { delist } from './roster.js';
import { scoredLeft, scoredRemove } from './scored.js';
import { lapse } from './spans.js';
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
  mix.looked = false;
  if (mix.unshared) {
    mix.unshared = false;
    detour(mix);
  }
  mix.frame = nextFrame();
  mix.reducedNow = mix.reduced;
  for (const a of mix.announced) if (Number.isNaN(a.at)) a.at = mix.u;
  if (mix.pins !== null && mix.pins.size > 0) repin(mix);
  if (mix.anchored > 0) place(mix);
  if (mix.announced.length > 0) {
    // Kept while still ahead, or while history reaches it; anchors waiting on one were placed above.
    const reach = mix.opts.history === undefined ? now : mix.transport.keepsFrom();
    mix.announced = mix.announced.filter((a) => mixAt(mix, a.at) >= reach);
  }
  // A live mix visits only the voices due by now; a projection, which copies few, visits all.
  const visit = mix.projecting || mix.walkAll ? mix.cued : popDue(mix, now);
  for (const voice of visit) {
    if (voice.state === 'done') continue;
    if (Number.isNaN(voice.opened)) voice.opened = now;
    if (
      voice.state === 'pending' &&
      (voice.owner === null ? now : ownerReading(voice.owner, now)) >= voice.start
    )
      begin(mix, voice, now);
    // After it starts, so a fade due by now on a voice that started since the last frame begins.
    if ((voice.state === 'live' || voice.state === 'frozen') && voice.outAt <= now)
      beginFade(
        mix,
        voice,
        { over: Number.isNaN(voice.outOver) ? undefined : voice.outOver },
        Math.max(startOf(voice), voice.outAt),
      );
    if (voice.state !== 'pending') {
      if (voice.turns) turn(mix, voice, now);
      // Its passes run out at its end running forward, and at its start running back. A clock
      // standing still at or before its start is where it was: waiting, or frozen there.
      const way = heading(voice, now);
      const at = voice.elapsedAt(now);
      const back = way < 0;
      const atStart = !voice.beginless && at <= voice.soonest;
      const over = back ? atStart : Number.isFinite(voice.span) && at >= voice.span + voice.latest;
      if (over) {
        voice.play(true, now, mix.transport.seq);
        // The fade starts when its passes ran out, not at the frame that noticed, so it plays
        // the same at any frame rate and a read at another time can find it.
        if (voice.state === 'live') {
          if (back ? voice.freezesBefore : voice.freezesAfter) voice.state = 'frozen';
          else
            beginFade(
              mix,
              voice,
              { back },
              Math.max(startOf(voice), Math.min(now, voice.endsAt())),
            );
        }
      } else if (voice.state === 'frozen' && !(atStart && way === 0)) voice.state = 'live';
    }
    // A projection reads a finished ramp as weight 0, and leaves the live voice's subjects be.
    if (voice.parts !== null && !mix.projecting)
      for (const [subject, r] of voice.parts)
        if (now - r.at >= r.over) part(mix, voice, subject, r.at + r.over);
    const back = voice.back;
    if (back !== null && now >= back.at + (1 - back.from) * back.over && !mix.projecting) {
      voice.back = null;
      mix.lanes?.refill();
    }
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
  if (mix.owners !== null) lapse(mix, now);
  mix.stirred = false;
  if (mix.retired.length > 0) prune(mix);
  forget(mix);
}

/**
 * Which way a voice's clock is running at mix time `now`, through every owner above it: above 0
 * forward, below 0 back, 0 standing still.
 */
function heading<I, O>(voice: Voice<I, O>, now: number): number {
  let way = 1;
  for (let v: Voice<I, O> | null = voice; v !== null; v = v.owner)
    way *= Math.sign(v.rateAt(v.owner === null ? now : ownerReading(v.owner, now)));
  return way;
}

/**
 * A ramp through 0 has turned a voice's clock around by `now`: the clock is anchored again where
 * it turned, so it runs one way from there and the time it reads any position is one time.
 */
function turn<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, now: number): void {
  const r = voice.ramp as NonNullable<Voice<I, O>['ramp']>;
  const at = voice.anchorNow + (r.over * r.from) / (r.from - r.to);
  if ((voice.owner === null ? now : ownerReading(voice.owner, now)) < at) return;
  leaveClock(voice, at);
  voice.anchorElapsed = elapsedWith(voice, at);
  voice.ramp = { from: 0, to: r.to, over: voice.anchorNow + r.over - at };
  voice.anchorNow = at;
  noted(mix, voice);
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
  if (pruned) {
    mix.general = mix.general.filter((v) => v.state !== 'done');
    if (mix.sharers.length > 0) mix.sharers = mix.sharers.filter((v) => v.state !== 'done');
    detour(mix);
  }
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
  scoredRemove(mix, [voice]);
  if (mix.opts.history) {
    mix.gone.push(voice);
    scoredLeft(mix, voice);
  } else {
    mix.parters.delete(voice);
    mix.departed.add(mix, voice);
  }
  unplay(mix, voice);
  changed(mix, voice);
  delist(mix, voice);
  return voice.named === null;
}

/** Lets go of the voices that have left and that history no longer reaches. */
export function forget<I, O>(mix: Mixer<I, O>): void {
  const history = mix.opts.history;
  if (history && mix.gone.length > 0) {
    // With a store a voice that has left pages out where it can, and stays where it cannot.
    if (mix.transport.pager !== null) {
      const reach = mix.now - history.ms;
      keepGone(mix, (v) => v.reachedTo >= reach || !pageVoice(mix, v, reach));
    } else {
      expireGone(mix, mix.transport.keepsFrom());
    }
  }
}
