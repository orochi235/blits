import { noted } from './history.js';
import { markOf } from './marks.js';
import type { Mixer } from './mixer.js';
import { mixTime, ownerReading } from './owner.js';
import type { Mark, Placement, Query, VoiceSpec } from './types.js';
import { none, type Voice } from './voice.js';

/** What a voice's own owner's clock reads now: the mix clock for a voice no owner holds. */
export function localNow<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number {
  return voice.owner === null ? mix.now : ownerReading(voice.owner, mix.now);
}

/** A voice's start as mix time. */
export function startOf<I, O>(voice: Voice<I, O>): number {
  return voice.owner === null ? voice.start : mixTime(voice.owner, voice.start);
}

/** Mix time at host time `u`, for something pinned there; Infinity while the mix may never get there. */
export function mixAt<I, O>(mix: Mixer<I, O>, u: number): number {
  return mix.pace === null ? u : mix.pace.at(u, mix.u);
}

export function pin<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, u: number): void {
  mix.pins ??= new Map();
  mix.pins.set(voice, u);
}

/** Puts each pending voice's start, given in host time, where the mix's rate now puts it. */
export function repin<I, O>(mix: Mixer<I, O>): void {
  const pins = mix.pins as Map<Voice<I, O>, number>;
  for (const [voice, u] of pins) {
    if (voice.state !== 'pending') pins.delete(voice);
    else startAt(mix, voice, mixAt(mix, u));
  }
}

/** Moves a pending voice's start, its clock with it; false where it is already there. */
function startAt<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, start: number): boolean {
  if (start === voice.start) return false;
  voice.start = start;
  voice.anchorNow = start;
  voice.anchorElapsed = 0;
  noted(mix, voice);
  return true;
}

/** Refuses a placement that names a mark twice on one side, or that waits on itself. */
export function checkPlacement<I, O>(
  mix: Mixer<I, O>,
  spec: VoiceSpec<I, O>,
  anchor: Placement,
  owner: Voice<I, O> | null,
): void {
  if (anchor.start !== undefined && anchor.in !== undefined)
    throw new Error('blits: a placement anchors start or in, not both');
  if (anchor.out !== undefined && anchor.end !== undefined)
    throw new Error('blits: a placement anchors out or end, not both');
  if (spec.start !== undefined && (anchor.start !== undefined || anchor.in !== undefined))
    throw new Error('blits: a voice takes start or an anchored start, not both');
  const name = spec.name;
  if (name === undefined) return;
  // A voice is known by its owner, its score and its name; a bare name in an anchor is in the
  // asker's score under the asker's owner.
  const key = (o: Voice<I, O> | null, score: string | undefined, n: string) =>
    `${o?.id ?? 0}\u0000${score ?? ''}\u0000${n}`;
  const names = (p: Placement, score: string | undefined, o: Voice<I, O> | null): string[] =>
    [p.start, p.in, p.out, p.end].flatMap((a) => {
      if (a === undefined || typeof a === 'number') return [];
      const q = 'of' in a ? a.of : 'after' in a ? a.after : 'with' in a ? a.with : a.before;
      if (typeof q === 'string') return [key(o, score, q)];
      return q.name === undefined ? [] : [key(o, q.score ?? score, q.name)];
    });
  const self = key(owner, spec.score, name);
  const seen = new Set<string>();
  const waits = names(anchor, spec.score, owner);
  while (waits.length > 0) {
    const n = waits.pop() as string;
    if (n === self) throw new Error(`blits: ${name}'s placement waits on itself`);
    if (seen.has(n)) continue;
    seen.add(n);
    for (const v of mix.cued)
      if (
        v.spec.name !== undefined &&
        key(v.owner, v.spec.score, v.spec.name) === n &&
        v.spec.anchor
      )
        waits.push(...names(v.spec.anchor, v.spec.score, v.owner));
  }
}

/**
 * Fixes every anchored voice's start and out from what its anchors answer now. A start is fixed
 * while the voice waits and an out until its fade begins; a target that has left keeps the time it
 * last gave. Repeated so a chain of anchors settles in one sync.
 */
export function place<I, O>(mix: Mixer<I, O>): void {
  for (let round = 0; round <= mix.cued.length; round++) {
    let moved = false;
    for (const voice of mix.cued) {
      const anchor = voice.spec.anchor;
      if (anchor === undefined || voice.state === 'done') continue;
      if (voice.placing && voice.state === 'pending') {
        const by = anchor.start ?? anchor.in;
        const t = by === undefined ? undefined : resolve(mix, by, voice);
        if (t !== undefined) {
          const o = voice.owner;
          const fadeIn = voice.fade.in ?? 0;
          const start =
            anchor.start !== undefined
              ? t
              : o === null
                ? t - fadeIn
                : ownerReading(o, mixTime(o, t) - fadeIn);
          if (Number.isFinite(start) && startAt(mix, voice, start)) moved = true;
        }
      }
      if (voice.state !== 'fading') {
        const by = anchor.out ?? anchor.end;
        const t = by === undefined ? undefined : resolve(mix, by, voice);
        if (t !== undefined) {
          const m = voice.owner === null ? t : mixTime(voice.owner, t);
          const at = anchor.out !== undefined ? m : m - (voice.fade.out ?? 0);
          if (at !== voice.outAt) {
            voice.outAt = at;
            noted(mix, voice);
            moved = true;
          }
        }
      }
    }
    if (!moved) return;
  }
}

/** The time an anchor answers on its voice's owner's clock, or undefined while its target has none. */
function resolve<I, O>(
  mix: Mixer<I, O>,
  a: number | NonNullable<Placement['start']>,
  self: Voice<I, O>,
): number | undefined {
  const o = self.owner;
  if (typeof a === 'number') return o === null ? mixAt(mix, a - mix.offset) : a;
  let query: string | Query;
  let mark: Mark;
  let by = a.by ?? 0;
  if ('of' in a) {
    query = a.of;
    mark = a.mark;
  } else if ('after' in a) {
    query = a.after;
    mark = 'end';
  } else if ('with' in a) {
    query = a.with;
    mark = 'start';
  } else {
    query = a.before;
    mark = 'start';
    by = -by;
  }
  const t = timeOf(mix, typeof query === 'string' ? { name: query } : query, mark, self);
  if (t === undefined) return undefined;
  if (o === null) return t + by;
  const local = ownerReading(o, t);
  return Number.isFinite(local) ? local + by : undefined;
}

/**
 * The mix time a query answers: `mark` of the voice it picks, among those cued and those that have
 * left, never the asker; or a mark the host announced on the score, which is the same time for
 * any of the four. Undefined while what it picks has no such time. A query naming no score looks
 * among the asker's siblings, the voices its owner holds.
 */
function timeOf<I, O>(
  mix: Mixer<I, O>,
  q: Query,
  mark: Mark,
  self: Voice<I, O>,
): number | undefined {
  const score = q.score ?? self.spec.score;
  const anywhere = q.score !== undefined;
  const found: { order: number; t: number | undefined }[] = [];
  for (const v of [...mix.gone, ...mix.cued])
    if (
      v !== self &&
      v.spec.score === score &&
      (anywhere || v.owner === self.owner) &&
      (q.name === undefined || v.spec.name === q.name) &&
      (q.tag === undefined || (v.spec.tags ?? none).includes(q.tag)) &&
      (q.writes === undefined || (v.patch.writes as readonly unknown[]).includes(q.writes))
    )
      found.push({ order: v.id, t: markOf(mix, v, mark) });
  if (q.writes === undefined && (anywhere || self.owner === null))
    for (const a of mix.announced)
      if (
        a.score === score &&
        (q.name === undefined || a.name === q.name) &&
        (q.tag === undefined || a.tags.includes(q.tag))
      )
        found.push({ order: a.order, t: Number.isNaN(a.at) ? undefined : mixAt(mix, a.at) });
  if (found.length === 0) return undefined;
  found.sort((x, y) => x.order - y.order);
  const resolver = q.resolver ?? 'last';
  if (resolver === 'first') return found[0]?.t;
  if (resolver === 'last') return found[found.length - 1]?.t;
  const times = found.flatMap((e) => (e.t === undefined ? [] : [e.t])).sort((x, y) => x - y);
  if (resolver === 'next') {
    const now = Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now;
    return times.find((t) => t >= now);
  }
  return resolver === 'earliest' ? times[0] : times[times.length - 1];
}
