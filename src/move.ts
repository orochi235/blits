import { settleArcs } from './arcs.js';
import { changed } from './chain.js';
import { elapsedWith } from './clock.js';
import { byId, popDue, schedule } from './due.js';
import { beginFade, part, release, retire, rouse, stay } from './fade.js';
import { expireGone, keepGone } from './gone.js';
import { begin, reorigin } from './held.js';
import { noted } from './history.js';
import type { Mixer } from './mixer.js';
import { leave as leaveClock, startedAt } from './origin.js';
import { descendants, type Holding, ownerReading, plays } from './owner.js';
import { mixAt, place, repin, startAt, startOf } from './place.js';
import { pageVoice } from './revive.js';
import { delist, detour } from './roster.js';
import { scoredLeft, scoredRemove } from './scored.js';
import { type Fitting, lapse, lapses, unfit } from './spans.js';
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
  if (mix.waking) wake(mix, now);
  if (mix.pins !== null && mix.pins.size > 0) repin(mix);
  if (mix.anchored > 0) place(mix);
  if (mix.announced.length > 0) {
    // Kept while still ahead, or while history reaches it; anchors waiting on one were placed above.
    const reach = mix.opts.history === undefined ? now : mix.transport.keepsFrom();
    mix.announced = mix.announced.filter((a) => mixAt(mix, a.at) >= reach);
  }
  // A live mix visits only the voices due by now; a projection, which copies few, visits all.
  const visit = mix.projecting || mix.walkAll ? mix.cued : popDue(mix, now);
  let held: Voice<I, O>[] | null = null;
  for (const voice of visit) {
    if (voice.state === 'done') continue;
    if (visitOne(mix, voice, now, voice.owner !== null && voice.owner.fitting !== null)) {
      held ??= [];
      held.push(voice);
    }
  }
  const back = mix.leapt === null && held === null ? null : turnedBack(mix, held, now);
  mix.leapt = null;
  if (back === null) settle(mix, held, now);
  else ahead(mix, back, held, now);
  if (mix.sharers.length > 0 && !mix.projecting) mix.share?.outgrow(mix);
  mix.stirred = false;
  mix.asleep = false;
  if (mix.retired.length > 0) prune(mix);
  forget(mix);
}

/** Takes the span children waiting their turn, then lets go of spans and arcs that are over. */
function settle<I, O>(mix: Mixer<I, O>, held: Voice<I, O>[] | null, now: number): void {
  if (held !== null) inTurn(mix, held, now);
  if (mix.owners !== null) {
    lapse(mix, now);
    settleArcs(mix, now);
  }
}

/**
 * The owners sought forward since the last frame, or above the span children waiting their turn,
 * whose clocks do not run forward at `now`, with those above them that do not either; null where
 * there are none. An owner a span holds is left out, since its span's fits change its clock.
 */
function turnedBack<I, O>(
  mix: Mixer<I, O>,
  held: Voice<I, O>[] | null,
  now: number,
): Voice<I, O>[] | null {
  let back: Voice<I, O>[] | null = null;
  if (mix.leapt !== null) for (const o of mix.leapt) back = up(o, now, back);
  if (held !== null) for (const v of held) back = up(v.owner, now, back);
  return back;
}

/** Adds to `back` the owners from `from` up that `turnedBack` takes. */
function up<I, O>(
  from: Voice<I, O> | null,
  now: number,
  back: Voice<I, O>[] | null,
): Voice<I, O>[] | null {
  for (let o = from; o !== null; o = o.owner) {
    if (o.state === 'done' || o.owner?.fitting || back?.includes(o)) continue;
    if (o.rateAt(o.owner === null ? now : ownerReading(o.owner, now)) > 0) continue;
    back ??= [];
    back.push(o);
  }
  return back;
}

/**
 * Settles a frame in which a seek took owners whose clocks do not run forward ahead: the span
 * children and spans it passed start and end in order, as played straight through, with those
 * clocks run forward to where they read now, then back on their own.
 */
function ahead<I, O>(
  mix: Mixer<I, O>,
  back: Voice<I, O>[],
  held: Voice<I, O>[] | null,
  now: number,
): void {
  const kept = back.map((o) => {
    const { anchorNow, anchorElapsed, rate, ramp } = o;
    const at = o.owner === null ? now : ownerReading(o.owner, now);
    o.anchorElapsed = elapsedWith(o, at);
    o.anchorNow = at;
    o.rate = 1;
    o.ramp = null;
    return { anchorNow, anchorElapsed, rate, ramp, logged: o.log?.length ?? 0 };
  });
  try {
    settle(mix, held, now);
  } finally {
    back.forEach((o, i) => {
      const { logged, ...clock } = kept[i] as (typeof kept)[number];
      Object.assign(o, clock);
      const log = o.log;
      if (log !== null)
        for (let k = logged; k < log.length; k++) Object.assign(log[k] as object, clock);
    });
  }
  // What was worked out in mix time from the clocks run forward is worked out again on their own.
  mix.frame = nextFrame();
  for (const o of back) {
    if (o.state !== 'done') schedule(mix, o);
    descendants(o, (v) => {
      if (v.state === 'done') return;
      reorigin(mix, v, now);
      schedule(mix, v);
    });
  }
  mix.lanes?.refill();
}

/**
 * Starts, ends and fades one voice as of `now`; with `wait`, a span's child, it does none of that
 * and answers true where the child `meets` now, to wait its turn.
 */
function visitOne<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, now: number, wait = false): boolean {
  if (Number.isNaN(voice.opened)) voice.opened = now;
  if (voice.earlier !== null || voice.later !== null) unfit(mix, voice, now);
  const t = voice.owner === null ? now : ownerReading(voice.owner, now);
  if (wait && meetsAt(voice, t, now)) return true;
  if (voice.state === 'pending' && starts(voice, t, now)) begin(mix, voice, now);
  // After it starts, so a fade due by now on a voice that started since the last frame begins.
  // Not one set for after its passes run out, where a move across both would begin it first.
  if (
    (voice.state === 'live' || voice.state === 'frozen') &&
    voice.outAt <= now &&
    !(
      voice.state === 'live' &&
      !voice.freezesAfter &&
      !voice.freezesBefore &&
      voice.endsAt() < voice.outAt
    )
  )
    beginFade(
      mix,
      voice,
      { over: Number.isNaN(voice.outOver) ? undefined : voice.outOver },
      Math.max(startedAt(voice), voice.outAt),
    );
  if (voice.state !== 'pending') {
    if (voice.turns) turn(mix, voice, now);
    if (voice.state === 'live' && voice.out !== null && !voice.quietAt(now)) rouse(mix, voice, now);
    // Its passes run out at its end running forward, and at its start running back. A clock
    // standing still at or before its start is where it was: waiting, or frozen there.
    const heads =
      Math.sign(voice.rateAt(t)) * (voice.owner === null ? 1 : heading(voice.owner, now));
    const at = t === Number.NEGATIVE_INFINITY ? t : elapsedWith(voice, t);
    const back = heads < 0;
    const atStart = !voice.beginless && at <= voice.soonest;
    // An owner run back to its start stays for what it holds, and leaves with its last child.
    const holds = voice.holding !== null && plays(voice, now);
    const over = back
      ? atStart && !holds
      : Number.isFinite(voice.span) && at >= voice.span + voice.latest;
    if (over) {
      voice.play(true, now, mix.transport.seq);
      // The fade starts when its passes ran out, not at the frame that noticed, so it plays
      // the same at any frame rate and a read at another time can find it.
      if (voice.state === 'live' && voice.out === null) {
        if (back ? voice.freezesBefore : voice.freezesAfter) voice.state = 'frozen';
        else
          beginFade(
            mix,
            voice,
            { back, stays: voice.owner !== null && mix.opts.history !== undefined },
            Math.max(startOf(voice), Math.min(now, voice.endsAt())),
          );
      }
    } else if (voice.state === 'frozen' && !(atStart && heads === 0)) voice.state = 'live';
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
    } else if (spent >= over) {
      if (voice.out.stays) stay(mix, voice, at + over);
      else retire(mix, voice, at + over);
    }
  }
  if (!mix.projecting) schedule(mix, voice);
  return false;
}

/**
 * Whether a pending voice starts with its owner's clock at `t`: at its very start only on a clock
 * not running back, where it would leave as it starts, as one passed between frames never starts.
 */
function starts<I, O>(voice: Voice<I, O>, t: number, now: number): boolean {
  return (
    t > voice.start ||
    (t === voice.start && (voice.owner === null || heading(voice.owner, now) >= 0))
  );
}

/**
 * Whether a span's child starts, comes back, or reaches the end of its passes by `now`: a fit from
 * an end earlier in the frame can move any of these, so they wait for the ends before them. One
 * kept quiet at its start comes back as its clock passes it. Past its end, or its start, on a clock
 * not running forward, a seek of an owner took it there going forward. Takes first the changes a
 * fit made to it that its owner's clock has come back to, as `visitOne` would.
 */
function meets<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, now: number): boolean {
  if (voice.earlier !== null || voice.later !== null) unfit(mix, voice, now);
  return meetsAt(voice, ownerReading(voice.owner as Voice<I, O>, now), now);
}

/** `meets`, given what its owner's clock reads at `now`, `t`. */
function meetsAt<I, O>(voice: Voice<I, O>, t: number, now: number): boolean {
  if (voice.state === 'pending') return starts(voice, t, now);
  if (voice.state !== 'live') return false;
  const out = voice.out;
  if (voice.fitting !== null) return out === null && lapses(voice, now);
  if (!Number.isFinite(voice.span)) return false;
  if (out !== null && !(out.stays === true && out.back === true)) return false;
  const at = t === Number.NEGATIVE_INFINITY ? t : elapsedWith(voice, t);
  const edge = out === null ? voice.span + voice.latest : voice.soonest;
  return at > edge || (at === edge && heading(voice, now) > 0);
}

/**
 * Visits span children that start, come back or end within the frame in the order those happen,
 * one at a time, since a fit from each end can move the starts and ends after it. A start or a
 * return only does that here; a child a fit moves to meet `now`, or whose span starts, joins them.
 */
function inTurn<I, O>(mix: Mixer<I, O>, held: Voice<I, O>[], now: number): void {
  // A lone start of a child holding nothing moves nothing else: it starts and is visited.
  const lone = held.length === 1 ? (held[0] as Voice<I, O>) : null;
  if (lone !== null && lone.state === 'pending' && lone.holding === null) {
    begin(mix, lone, now);
    if (!meets(mix, lone, now)) {
      visitOne(mix, lone, now);
      return;
    }
  }
  // `held` is this frame's own list, so it is the one the children waiting their turn join.
  const waiting = held;
  const ended: Voice<I, O>[] = [];
  for (;;) {
    let next: Voice<I, O> | undefined;
    let when = Number.POSITIVE_INFINITY;
    for (let i = 0; i < waiting.length; i++) {
      const v = waiting[i] as Voice<I, O>;
      if (v.state === 'done' || ended.includes(v) || !meets(mix, v, now)) continue;
      const t =
        v.state === 'pending'
          ? startOf(v)
          : v.fitting !== null
            ? lapseOf(v)
            : v.out !== null
              ? v.reaches(v.soonest)
              : v.endsAt();
      // At one time an end comes first, as a fit from it counts a start there as still to come.
      if (next === undefined || t < when || (t === when && rank(v) < rank(next))) {
        next = v;
        when = t;
      }
    }
    if (next === undefined) break;
    if (next.state === 'pending') {
      begin(mix, next, now);
      if (next.holding !== null) join(mix, next, now, waiting, ended);
    } else if (next.out !== null) rouse(mix, next, now);
    else {
      ended.push(next);
      if (next.fitting !== null) release(mix, next, when);
      else visitOne(mix, next, now);
      for (let o = next.owner; o?.fitting; o = o.owner) join(mix, o, now, waiting, ended);
    }
  }
  byId(waiting);
  for (let i = 0; i < waiting.length; i++) {
    const v = waiting[i] as Voice<I, O>;
    if (!ended.includes(v) && v.state !== 'done') visitOne(mix, v, now);
  }
}

/** When a span's budget ran out, mix time. */
function lapseOf<I, O>(span: Voice<I, O>): number {
  return span.timeAt((span.fitting as Fitting).budget);
}

/** Adds to `waiting` the children of `o` that meet `now` and have not yet ended this frame. */
function join<I, O>(
  mix: Mixer<I, O>,
  o: Voice<I, O>,
  now: number,
  waiting: Voice<I, O>[],
  ended: Voice<I, O>[],
): void {
  const children = (o.holding as Holding<Voice<I, O>>).children;
  for (let i = 0; i < children.length; i++) {
    const c = children[i] as Voice<I, O>;
    if (c.state !== 'done' && !ended.includes(c) && !waiting.includes(c) && meets(mix, c, now))
      waiting.push(c);
  }
}

/** Which of two events at one time comes first: an end before a start or return, then cue order. */
function rank<I, O>(v: Voice<I, O>): number {
  return (v.state === 'pending' || v.out !== null ? 2 ** 40 : 0) + v.id;
}

/** Starts each voice cued while the mix slept at `now`, the first sync after its cue. */
function wake<I, O>(mix: Mixer<I, O>, now: number): void {
  mix.waking = false;
  for (const voice of mix.cued) {
    if (!voice.waking) continue;
    voice.waking = false;
    if (voice.state !== 'pending') continue;
    startAt(mix, voice, now);
    // Where a seek back before the cue puts it, so the tape's cue again starts it here.
    const first = voice.first;
    if (first !== null) {
      first.start = now;
      first.anchorNow = now;
    }
    if (!mix.projecting) schedule(mix, voice);
  }
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

/**
 * Past this many voices retiring in one frame, and more than one in `SPARSE` of the list, one pass
 * over the list beats a search for each.
 */
const SEARCHED = 8;
const SPARSE = 32;
/** The most retired voices `prune` splices out one at a time, rather than closing up in one pass. */
const SPLICED = 4;

/**
 * Takes the voices retired since the last prune out of the list, in list order. A few, or a small
 * share of a long list, are found by their id, which the list is in order of, so the voices still
 * in it are not read.
 */
function prune<I, O>(mix: Mixer<I, O>): void {
  const retired = mix.retired;
  mix.retired = [];
  const voices = mix.cued;
  let at: number[] | null = null;
  // A projection's list holds copies of voices gone before it, which only a pass takes out.
  if ((retired.length <= SEARCHED || retired.length * SPARSE <= voices.length) && !mix.projecting) {
    byId(retired);
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
    // A splice moves the tail natively, several times faster than a loop, but once a voice.
    if (at.length <= SPLICED)
      for (let k = at.length - 1; k >= 0; k--) voices.splice(at[k] as number, 1);
    else {
      let kept = at[0] as number;
      let k = 0;
      for (let i = kept; i < voices.length; i++) {
        if (at[k] === i) k++;
        else voices[kept++] = voices[i] as Voice<I, O>;
      }
      voices.length = kept;
    }
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
