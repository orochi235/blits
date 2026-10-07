import type { Mixer } from './mixer.js';
import type { Transport } from './transport.js';
import type { HistoryStore, Paged, PagedStream } from './types.js';

/**
 * A `seek` or `project` reached past memory into records `prepare` had not loaded. Thrown before
 * anything moves, so a restore is never partial: `await prepare(at)` and ask again.
 *
 * @category mix
 */
export class HistoryMiss extends Error {
  constructor(
    /** The mix whose records were missing, by `name`. */
    readonly mix: string,
    readonly stream: string,
    /** The mix time asked for. */
    readonly at: number,
  ) {
    super(
      `blits: ${at} reaches past memory into ${stream} records of ${mix === '' ? 'the mix' : mix} that were not loaded; await prepare(${at}) first`,
    );
    this.name = 'HistoryMiss';
  }
}

/** A transport's history store: what left memory, and what `prepare` loaded back. */
export class Pager {
  /** What the last `prepare` loaded, and every record paged since, until a seek or read takes it. */
  loaded: { t: number; records: Paged[] } | null = null;
  /** The latest record paged, which a miss names. */
  last: { mix: string; stream: PagedStream } | null = null;

  constructor(readonly store: HistoryStore) {}
}

/** A subject's key in history records; undefined for the unit subject. */
export type Key = string | number | undefined;

/**
 * Object subjects by key, for a mix with a store, held weakly: a subject the host has let go of
 * can never be probed again, so nothing it kept is put back.
 */
export class Keys {
  private readonly refs = new Map<string | number, WeakRef<object>>();
  private readonly gone = new FinalizationRegistry<string | number>((key) => {
    const ref = this.refs.get(key);
    if (ref !== undefined && ref.deref() === undefined) this.refs.delete(key);
  });

  constructor(private readonly of: ((subject: never) => string | number) | undefined) {}

  /** The key a subject is paged under; throws for an object subject without `keyOf`. */
  key(subject: unknown): Key {
    if (subject === undefined || typeof subject === 'string' || typeof subject === 'number')
      return subject;
    const of = this.of;
    if (of === undefined || typeof subject !== 'object' || subject === null)
      throw new Error(
        'blits: a mix whose history has a store pages its subjects by key; give it keyOf for subjects that are not strings or numbers',
      );
    const key = of(subject as never);
    if (this.refs.get(key)?.deref() !== subject) {
      this.refs.set(key, new WeakRef(subject));
      this.gone.register(subject, key);
    }
    return key;
  }

  /** The subject a key stands for: an object the mix met under it, else the key itself. */
  subject(key: Key): unknown {
    if (key === undefined) return undefined;
    return this.refs.get(key)?.deref() ?? key;
  }
}

/**
 * Hands records leaving memory to the store, the last of any that share a time, which is the one
 * a read finds. `reach` is how far back memory still reaches.
 */
export function pageOut<I, O, E extends { at: number }>(
  mix: Mixer<I, O>,
  stream: PagedStream,
  voice: number | undefined,
  subject: Key,
  out: readonly E[],
  data: (e: E) => unknown,
  reach: number,
): void {
  const pager = mix.transport.pager;
  if (pager === null || out.length === 0) return;
  const name = mix.name ?? '';
  const records: Paged[] = [];
  for (let i = 0; i < out.length; i++) {
    const e = out[i] as E;
    if (i + 1 < out.length && (out[i + 1] as E).at === e.at) continue;
    const r: Paged = { mix: name, stream, at: e.at, data: data(e) };
    if (voice !== undefined) r.voice = voice;
    if (subject !== undefined) r.subject = subject;
    records.push(r);
  }
  page(mix.transport, records, reach);
}

/** Gives records to the store; memory now reaches back no further than `reach`. */
export function page(transport: Transport, records: Paged[], reach: number): void {
  const pager = transport.pager as Pager;
  pager.store.page(records);
  pager.loaded?.records.push(...records);
  const last = records[records.length - 1] as Paged;
  pager.last = { mix: last.mix, stream: last.stream };
  if (reach > transport.floor) transport.floor = reach;
}

/** Loads what a seek or read to `t` needs where it reaches past memory. */
export async function prepare(transport: Transport, t: number): Promise<void> {
  const pager = transport.pager;
  if (pager === null || transport.reaches(t)) return;
  const records = await pager.store.load(t);
  pager.loaded = { t, records: [...records] };
}
