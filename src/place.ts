import { same } from './clock.js';
import { departedMatches } from './departed.js';
import { reorigin } from './held.js';
import { noted } from './history.js';
import { markOf } from './marks.js';
import type { Mixer } from './mixer.js';
import { mixTime, ownerReading } from './owner.js';
import { holders, scored, scoredGone, scoreVersion, unhold } from './scored.js';
import { refloor } from './spans.js';
import type { Anchor, MarkName, Placement, Query, VoiceSpec } from './types.js';
import { none, type Voice } from './voice.js';
import { warnOnce } from './warn.js';

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
  voice.pinned = u;
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
export function startAt<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, start: number): boolean {
  if (start === voice.start) return false;
  voice.start = start;
  voice.anchorNow = start;
  voice.clocks = null;
  // A clock moved outright, as a seek moves it: what a record computed at this mix time is stale.
  voice.seeks++;
  reorigin(mix, voice, mix.now);
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
  const self: Placed<I, O> = {
    id: mix.nextId,
    spec,
    owner,
    slot: mix.slot,
    writes: spec.patch?.writes ?? none,
  };
  const voices: Placed<I, O>[] = [self];
  for (const m of mix.transport.members)
    for (const list of [m.gone, m.cued] as Voice<I, O>[][])
      for (const v of list)
        voices.push({
          id: v.id,
          spec: v.spec,
          owner: v.owner,
          slot: m.slot,
          writes: v.patch.writes,
        });
  const refuse = (): never => {
    throw new Error(`blits: ${spec.name ?? 'a voice'}'s placement waits on itself`);
  };
  // Where the marks a query asks for are fixed: a voice's start, in, coast and inner marks by its
  // start's anchors, its out and end by its out's anchors and its start.
  const targets = (asker: Placed<I, O>, a: Anchor): Wait<I, O>[] => {
    if ('all' in a) return a.all.flatMap((m) => targets(asker, m));
    if ('any' in a) return a.any.flatMap((m) => targets(asker, m));
    const given = 'of' in a ? a.of : 'after' in a ? a.after : 'with' in a ? a.with : a.before;
    const mark = 'of' in a ? a.mark : 'after' in a ? 'end' : 'start';
    const q = typeof given === 'string' ? { name: given } : given;
    const score = q.score ?? asker.spec.score;
    const anywhere = q.score !== undefined;
    if (asker === self && q.name !== undefined && q.name === spec.name && score === spec.score)
      refuse();
    const met = voices.filter(
      (v) =>
        v !== asker &&
        v.spec.score === score &&
        (anywhere || (v.owner === asker.owner && v.slot === asker.slot)) &&
        (q.name === undefined || v.spec.name === q.name) &&
        (q.tag === undefined || (v.spec.tags ?? none).includes(q.tag)) &&
        (q.writes === undefined || (v.writes as readonly unknown[]).includes(q.writes)),
    );
    const resolver = q.resolver ?? 'last';
    const picked =
      met.length > 1 && (resolver === 'first' || resolver === 'last')
        ? [met.reduce((p, v) => ((resolver === 'last' ? v.id > p.id : v.id < p.id) ? v : p))]
        : met;
    const side: Side = mark === 'out' || mark === 'end' ? 'out' : 'start';
    return picked.map((v) => ({ voice: v, side }));
  };
  const waitsOf = (p: Placed<I, O>, side: Side): Wait<I, O>[] => {
    const a = p.spec.anchor;
    const by = side === 'start' ? [a?.start, a?.in] : [a?.out, a?.end];
    const out: Wait<I, O>[] = side === 'out' ? [{ voice: p, side: 'start' }] : [];
    for (const b of by) if (b !== undefined && typeof b !== 'number') out.push(...targets(p, b));
    return out;
  };
  for (const from of ['start', 'out'] as const) {
    const seen = { start: new Set<Placed<I, O>>(), out: new Set<Placed<I, O>>() };
    const stack = waitsOf(self, from);
    while (stack.length > 0) {
      const { voice, side } = stack.pop() as Wait<I, O>;
      if (voice === self && side === from) refuse();
      if (seen[side].has(voice)) continue;
      seen[side].add(voice);
      stack.push(...waitsOf(voice, side));
    }
  }
}

/** A side of a placement: its start (`start` or `in`) or its out (`out` or `end`). */
type Side = 'start' | 'out';

/** What a placement check knows of a voice, cued or about to be. */
interface Placed<I, O> {
  id: number;
  spec: VoiceSpec<I, O>;
  owner: Voice<I, O> | null;
  slot: number;
  writes: readonly unknown[];
}

/** A side of a voice's placement that another waits on. */
interface Wait<I, O> {
  voice: Placed<I, O>;
  side: Side;
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
      if (voice.state !== 'fading' && !voice.outSet) {
        const by = anchor.out ?? anchor.end;
        const t = by === undefined ? undefined : resolve(mix, by, voice);
        if (t !== undefined) {
          const m = voice.owner === null ? t : mixTime(voice.owner, t);
          const start = startOf(voice);
          let at = anchor.out !== undefined ? m : m - (voice.fade.out ?? 0);
          let over = Number.NaN;
          // A fade out begins no earlier than its voice starts, and one that has to end by `m`
          // is shortened to; an end before the start leaves the voice an instant at its start.
          if (at < start && Number.isFinite(start)) {
            at = start;
            if (anchor.end !== undefined) {
              over = m > start ? m - start : 0;
              if (m < start && !mix.projecting)
                warnOnce(
                  voice,
                  `${voice.spec.name ?? `voice ${voice.id}`}'s placement ends before it starts, so it plays as an instant`,
                );
            }
          }
          if (at !== voice.outAt || !same(over, voice.outOver)) {
            voice.outAt = at;
            voice.outOver = over;
            noted(mix, voice);
            moved = true;
          }
        }
      }
    }
    if (!moved) break;
  }
  refloor(mix);
}

/**
 * The time an anchor answers on its voice's owner's clock, or undefined while its target has none.
 * A time before the owner starts answers `before`: undefined, so a start waits, or -Infinity for a
 * floor, which is no bound at all.
 */
export function resolve<I, O>(
  mix: Mixer<I, O>,
  a: number | NonNullable<Placement['start']>,
  self: Voice<I, O>,
  before?: number,
): number | undefined {
  const o = self.owner;
  if (typeof a === 'number') return o === null ? mixAt(mix, a - self.offset) : a;
  if ('all' in a) {
    let latest = Number.NEGATIVE_INFINITY;
    for (const m of a.all) {
      const t = member(mix, m, self, before);
      if (t === undefined) return undefined;
      latest = Math.max(latest, t);
    }
    return a.all.length === 0 ? undefined : latest;
  }
  if ('any' in a) {
    // A member still unknown may yet answer earlier than every known one, until one has passed.
    const now = Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : localNow(mix, self);
    let earliest = Number.POSITIVE_INFINITY;
    let unknown = false;
    for (const m of a.any) {
      const t = member(mix, m, self, before);
      if (t === undefined) unknown = true;
      else earliest = Math.min(earliest, t);
    }
    if (earliest === Number.POSITIVE_INFINITY) return undefined;
    return unknown && earliest > now ? undefined : earliest;
  }
  let query: string | Query;
  let mark: MarkName;
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
  const t = timeOf(mix, query, mark, self);
  if (t === undefined) return undefined;
  if (o === null) return t + by;
  const local = ownerReading(o, t);
  if (local === Number.NEGATIVE_INFINITY) return before;
  return Number.isFinite(local) ? local + by : undefined;
}

/**
 * What one member of a join answers, or the time it last gave once its target has left, as a lone
 * anchor keeps its voice where its target last put it.
 */
function member<I, O>(
  mix: Mixer<I, O>,
  a: Anchor,
  self: Voice<I, O>,
  before?: number,
): number | undefined {
  const t = resolve(mix, a, self, before);
  if (t === undefined) return self.answers?.get(a);
  if (!mix.projecting) {
    self.answers ??= new Map();
    self.answers.set(a, t);
  }
  return t;
}

/** Picks among the times a query meets, as its resolver says, in the order they are met. */
class Pick {
  any = false;
  firstOrder = Number.POSITIVE_INFINITY;
  lastOrder = Number.NEGATIVE_INFINITY;
  first: number | undefined;
  last: number | undefined;
  pick: number | undefined;
  constructor(
    readonly resolver: NonNullable<Query['resolver']>,
    readonly now: number,
  ) {}
  take(order: number, t: number | undefined): void {
    this.any = true;
    if (order < this.firstOrder) {
      this.firstOrder = order;
      this.first = t;
    }
    if (order > this.lastOrder) {
      this.lastOrder = order;
      this.last = t;
    }
    if (t !== undefined) this.consider(t);
  }
  /** Takes what `o` picked as though its times had been met here. */
  merge(o: Pick): void {
    if (!o.any) return;
    this.any = true;
    if (o.firstOrder < this.firstOrder) {
      this.firstOrder = o.firstOrder;
      this.first = o.first;
    }
    if (o.lastOrder > this.lastOrder) {
      this.lastOrder = o.lastOrder;
      this.last = o.last;
    }
    if (o.pick !== undefined) this.consider(o.pick);
  }
  private consider(t: number): void {
    const p = this.pick;
    if (
      this.resolver === 'earliest'
        ? p === undefined || t < p
        : this.resolver === 'latest'
          ? p === undefined || t > p
          : this.resolver === 'next' && t >= this.now && (p === undefined || t < p)
    )
      this.pick = t;
  }
  answer(): number | undefined {
    if (!this.any) return undefined;
    if (this.resolver === 'first') return this.first;
    if (this.resolver === 'last') return this.last;
    return this.pick;
  }
}

/**
 * What one anchor has read of one mix's gone voices on its score. A gone voice's marks no longer
 * move, so each is read once as it arrives at the end of the list; a list replaced, by a seek or by
 * history letting go of some, starts the read over. A gone voice an owner still holds reads on that
 * owner's clock, so it is read again each time.
 */
interface Fold<I, O> {
  list: readonly Voice<I, O>[];
  mark: MarkName;
  seen: number;
  pick: Pick;
  owned: Voice<I, O>[];
  /**
   * What the cued voices on the score answered, kept while no voice on it has been cued, retimed,
   * retired or has left since, the cued list is the one it read, and reduced motion is as it was.
   * Not kept where one of them reads another voice's clock (an owner's, a fit's, its children's).
   */
  live: Pick | null;
  liveOf: readonly Voice<I, O>[] | null;
  liveVersion: number;
  liveReduced: boolean;
}

/**
 * The mix time a query answers: `mark` of the voice it picks, among those cued and those that have
 * left, never the asker; or a mark the host announced on the score, which is the same time for
 * any mark. Undefined while what it picks has no such time. A query naming no score looks
 * among the asker's siblings, the voices its owner holds.
 */
function timeOf<I, O>(
  mix: Mixer<I, O>,
  key: string | Query,
  mark: MarkName,
  self: Voice<I, O>,
): number | undefined {
  const q = typeof key === 'string' ? { name: key } : key;
  const score = q.score ?? self.spec.score;
  const anywhere = q.score !== undefined;
  const resolver = q.resolver ?? 'last';
  const now = Number.isNaN(mix.now) ? Number.NEGATIVE_INFINITY : mix.now;
  const picked = new Pick(resolver, now);
  const matches = (v: Voice<I, O>) =>
    v !== self &&
    v.spec.score === score &&
    (anywhere || v.owner === self.owner) &&
    (q.name === undefined || v.spec.name === q.name) &&
    (q.tag === undefined || (v.spec.tags ?? none).includes(q.tag)) &&
    (q.writes === undefined || (v.patch.writes as readonly unknown[]).includes(q.writes));
  // A query naming a score looks in every mix on the transport that holds a voice on it; one
  // naming none, in its own.
  const listed = anywhere && score !== undefined && !mix.projecting;
  const mixes = !anywhere
    ? [mix]
    : listed
      ? holders(mix, score)
      : (mix.transport.members as unknown as Mixer<I, O>[]);
  // Voices forgotten on leaving answer only where no voice the mix still knows does.
  const owner = self.owner?.id ?? -1;
  const forgotten = new Pick(resolver, now);
  for (let i = 0; i < mixes.length; i++) {
    const m = mixes[i] as Mixer<I, O>;
    let departed = false;
    for (const d of m.departed.all)
      if (departedMatches(d, q, score, anywhere, owner)) {
        forgotten.take(d.id, d.marks[mark]);
        departed = true;
      }
    if (score === undefined || m.projecting || mix.projecting) {
      for (const v of [...m.gone, ...m.cued]) if (matches(v)) picked.take(v.id, markOf(m, v, mark));
      continue;
    }
    const cued = scored(m, score);
    const list = scoredGone(m, score);
    if (cued.size === 0 && list.length === 0 && !departed) {
      if (listed) {
        unhold(m, score);
        i--;
      }
      continue;
    }
    // `next` asks what is still ahead of now, which a running pick cannot keep.
    if (resolver === 'next') {
      for (const v of cued) if (matches(v)) picked.take(v.id, markOf(m, v, mark));
      for (const v of list) if (matches(v)) picked.take(v.id, markOf(m, v, mark));
      continue;
    }
    const fold = foldOf(m, list, key, mark, self, resolver);
    const version = scoreVersion(m, score);
    const reduced = m.reduced;
    if (
      fold.live === null ||
      fold.liveOf !== m.cued ||
      fold.liveVersion !== version ||
      fold.liveReduced !== reduced
    ) {
      const live = new Pick(resolver, Number.NEGATIVE_INFINITY);
      let keeps = true;
      for (const v of cued) {
        if (!matches(v)) continue;
        if (v.owner !== null || v.holding !== null || v.fitting !== null) keeps = false;
        live.take(v.id, markOf(m, v, mark));
      }
      fold.live = live;
      fold.liveOf = keeps ? m.cued : null;
      fold.liveVersion = version;
      fold.liveReduced = reduced;
    }
    picked.merge(fold.live);
    for (; fold.seen < list.length; fold.seen++) {
      const v = list[fold.seen] as Voice<I, O>;
      if (!matches(v)) continue;
      if (v.owner === null) fold.pick.take(v.id, markOf(m, v, mark));
      else fold.owned.push(v);
    }
    picked.merge(fold.pick);
    for (const v of fold.owned) picked.take(v.id, markOf(m, v, mark));
  }
  if (q.writes === undefined && (anywhere || self.owner === null))
    for (const a of mix.announced)
      if (
        a.score === score &&
        (score !== undefined || a.slot === mix.slot) &&
        (q.name === undefined || a.name === q.name) &&
        (q.tag === undefined || a.tags.includes(q.tag))
      )
        picked.take(a.order, Number.isNaN(a.at) ? undefined : mixAt(mix, a.at));
  return (picked.any ? picked : forgotten).answer();
}

/** `self`'s read of `m`'s gone voices for one query, started over where the list has changed under it. */
function foldOf<I, O>(
  m: Mixer<I, O>,
  list: readonly Voice<I, O>[],
  key: string | Query,
  mark: MarkName,
  self: Voice<I, O>,
  resolver: NonNullable<Query['resolver']>,
): Fold<I, O> {
  self.folds ??= new Map();
  let byMix = self.folds.get(key) as Map<Mixer<I, O>, Fold<I, O>> | undefined;
  if (byMix === undefined) {
    byMix = new Map();
    self.folds.set(key, byMix as Map<unknown, unknown>);
  }
  let fold = byMix.get(m);
  if (fold === undefined || fold.list !== list || fold.mark !== mark) {
    fold = {
      list,
      mark,
      seen: 0,
      pick: new Pick(resolver, Number.NEGATIVE_INFINITY),
      owned: [],
      live: null,
      liveOf: null,
      liveVersion: -1,
      liveReduced: false,
    };
    byMix.set(m, fold);
  }
  return fold;
}
