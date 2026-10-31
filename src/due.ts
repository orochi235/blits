import type { Mixer } from './mixer.js';
import type { Voice } from './voice.js';

/**
 * Live voices by the earliest mix time `moveTo` would change each, a binary heap. The times sit in
 * one flat array, so a sift reads no voice: at 40,000 voices a stop's sift to the top missed the
 * cache at each of its levels. An entry is stale once its voice has been scheduled again.
 */
export class DueQueue<I, O> {
  size = 0;
  /**
   * The entries due every frame, -Infinity, kept out of the heap in the order they came: an owned
   * voice is filed so each frame, and sifting each to the top and off again cost more than its visit.
   */
  private every: Voice<I, O>[] = [];
  private everyTokens: number[] = [];
  /** The list `takeEvery` last handed out, and its tokens: the next one fills it again. */
  private spare: Voice<I, O>[] = [];
  private spareTokens: number[] = [];
  /** Whether the list `takeEvery` last handed out was in id order. */
  everySorted = true;
  private at = new Float64Array(64);
  private tokens = new Float64Array(64);
  private voices: (Voice<I, O> | undefined)[] = [];
  /** The size past which stale entries are pruned, so a voice rescheduled often cannot grow it. */
  private limit = 64;

  push(at: number, voice: Voice<I, O>, token: number): void {
    if (at === Number.NEGATIVE_INFINITY) {
      if (this.every.length >= this.limit) this.pruneEvery();
      this.every.push(voice);
      this.everyTokens.push(token);
      return;
    }
    if (this.size >= this.limit) this.prune();
    if (this.size === this.at.length) this.grow();
    const ats = this.at;
    let i = this.size++;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if ((ats[up] as number) <= at) break;
      this.move(up, i);
      i = up;
    }
    ats[i] = at;
    this.tokens[i] = token;
    this.voices[i] = voice;
  }

  /** The earliest entry's time, Infinity while empty. */
  first(): number {
    if (this.every.length > 0) return Number.NEGATIVE_INFINITY;
    return this.size > 0 ? (this.at[0] as number) : Number.POSITIVE_INFINITY;
  }

  /**
   * The current entries due every frame, in the order they came, leaving none; `everySorted` says
   * whether that was id order. The list is the queue's own, good until the next call.
   */
  takeEvery(): Voice<I, O>[] {
    const every = this.every;
    const tokens = this.everyTokens;
    let n = 0;
    let sorted = true;
    let last = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < every.length; i++) {
      const voice = every[i] as Voice<I, O>;
      if (tokens[i] !== voice.dueToken || voice.state === 'done') continue;
      // A voice filed twice keeps its last entry, so it is taken once.
      voice.dueToken++;
      if (voice.id < last) sorted = false;
      last = voice.id;
      every[n++] = voice;
    }
    every.length = n;
    tokens.length = 0;
    this.spare.length = 0;
    this.every = this.spare;
    this.everyTokens = this.spareTokens;
    this.spare = every;
    this.spareTokens = tokens;
    this.everySorted = sorted;
    return every;
  }

  /** Takes off the earliest entry, giving its voice where it is current and undefined where stale. */
  pop(): Voice<I, O> | undefined {
    const voice = this.voices[0] as Voice<I, O>;
    const token = this.tokens[0] as number;
    const last = --this.size;
    if (last > 0)
      this.sink(
        0,
        this.at[last] as number,
        this.tokens[last] as number,
        this.voices[last] as Voice<I, O>,
      );
    this.voices[last] = undefined;
    return token === voice.dueToken && voice.state !== 'done' ? voice : undefined;
  }

  clear(): void {
    this.size = 0;
    this.every.length = 0;
    this.everyTokens.length = 0;
    this.spare.length = 0;
    this.spareTokens.length = 0;
    this.voices = [];
    this.limit = 64;
  }

  private move(from: number, to: number): void {
    this.at[to] = this.at[from] as number;
    this.tokens[to] = this.tokens[from] as number;
    this.voices[to] = this.voices[from];
  }

  /** Puts an entry in the hole at `i` and sifts it down to where it belongs. */
  private sink(i: number, at: number, token: number, voice: Voice<I, O>): void {
    const ats = this.at;
    const n = this.size;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      let least = at;
      if (l < n && (ats[l] as number) < least) {
        m = l;
        least = ats[l] as number;
      }
      if (r < n && (ats[r] as number) < least) m = r;
      if (m === i) break;
      this.move(m, i);
      i = m;
    }
    ats[i] = at;
    this.tokens[i] = token;
    this.voices[i] = voice;
  }

  private grow(): void {
    const at = new Float64Array(this.at.length * 2);
    at.set(this.at);
    this.at = at;
    const tokens = new Float64Array(this.tokens.length * 2);
    tokens.set(this.tokens);
    this.tokens = tokens;
  }

  /** Drops the entries due every frame made stale by a later one. */
  private pruneEvery(): void {
    const every = this.every;
    const tokens = this.everyTokens;
    let n = 0;
    for (let i = 0; i < every.length; i++) {
      const voice = every[i] as Voice<I, O>;
      if (tokens[i] !== voice.dueToken) continue;
      every[n] = voice;
      tokens[n++] = tokens[i] as number;
    }
    every.length = n;
    tokens.length = n;
    this.limit = Math.max(this.limit, 2 * n);
  }

  /** Drops the entries made stale by a later one and heapifies what is left. */
  private prune(): void {
    let n = 0;
    for (let k = 0; k < this.size; k++) {
      const voice = this.voices[k] as Voice<I, O>;
      if (this.tokens[k] !== voice.dueToken) continue;
      if (n !== k) this.move(k, n);
      n++;
    }
    for (let k = n; k < this.size; k++) this.voices[k] = undefined;
    this.size = n;
    for (let k = (n >> 1) - 1; k >= 0; k--)
      this.sink(k, this.at[k] as number, this.tokens[k] as number, this.voices[k] as Voice<I, O>);
    this.limit = Math.max(64, 2 * n);
  }
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
  mix.lanes?.voiceChanged(voice);
  const token = ++voice.dueToken;
  const due = dueOf(mix, voice);
  if (due === Number.POSITIVE_INFINITY) return;
  mix.due.push(Number.isNaN(due) ? Number.NEGATIVE_INFINITY : due, voice, token);
}

/** Takes every current entry due by `now` off the queue, in cue order. */
export function popDue<I, O>(mix: Mixer<I, O>, now: number): Voice<I, O>[] {
  const queue = mix.due;
  const out = queue.takeEvery();
  const sorted = queue.everySorted;
  const every = out.length;
  while (queue.first() <= now) {
    const voice = queue.pop();
    if (voice === undefined) continue;
    voice.dueToken++;
    out.push(voice);
  }
  if (every === 0 || !sorted) return byId(out);
  return every === out.length ? out : merged(out, every);
}

/** `list` in id order, its first `n` already so and the rest few: those sorted, then merged in. */
function merged<V extends { readonly id: number }>(list: V[], n: number): V[] {
  const rest = byId(list.slice(n));
  const out: V[] = [];
  let i = 0;
  let k = 0;
  while (i < n && k < rest.length) {
    const a = list[i] as V;
    const b = rest[k] as V;
    if (b.id < a.id) {
      out.push(b);
      k++;
    } else {
      out.push(a);
      i++;
    }
  }
  while (i < n) out.push(list[i++] as V);
  while (k < rest.length) out.push(rest[k++] as V);
  return out;
}

/** Past this many voices the built-in sort, which makes working arrays however few it is given. */
const SHORT = 8;

/** Puts voices in id order in place, those of one id left in the order they had; returns `list`. */
export function byId<V extends { readonly id: number }>(list: V[]): V[] {
  if (list.length > SHORT) return list.sort((a, b) => a.id - b.id);
  for (let i = 1; i < list.length; i++) {
    const v = list[i] as V;
    let k = i;
    for (; k > 0 && (list[k - 1] as V).id > v.id; k--) list[k] = list[k - 1] as V;
    list[k] = v;
  }
  return list;
}
