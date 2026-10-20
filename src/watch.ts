import type { Mixer } from './mixer.js';
import { seek } from './seek.js';
import { release } from './shared.js';
import { hostAhead } from './tape.js';
import type { Transport } from './transport.js';
import type {
  Handle,
  Hold,
  MixOptions,
  Registry,
  Sent,
  Tape,
  Watched,
  WatchedFrame,
} from './types.js';

type Change = Parameters<Parameters<Registry['on']>[0]>[0];
type Any = Mixer<unknown, unknown>;

/** The registry as every copy keeps it: its shape is protocol 1, which the key names. */
interface Shared extends Registry {
  readonly refs: Map<number, WeakRef<object>>;
  readonly entries_: WeakMap<object, Watched>;
  readonly fns: Set<(change: Change) => void>;
  readonly gone: FinalizationRegistry<number>;
  readonly labels: WeakMap<object, string>;
  next: number;
  counted: number;
}

const KEY = Symbol.for('@msb235/blits/watch/1');
const slot = globalThis as unknown as Record<symbol, Shared | undefined>;

/**
 * Every mix made on the page, shared by every copy of blits loaded: what a debugger reads to find
 * them. See `Registry`.
 *
 * @category mix
 */
export function watched(): Registry {
  return registry();
}

function registry(): Shared {
  let r = slot[KEY];
  if (r !== undefined) return r;
  const refs = new Map<number, WeakRef<object>>();
  const fns = new Set<(change: Change) => void>();
  const entries_ = new WeakMap<object, Watched>();
  r = {
    refs,
    entries_,
    fns,
    labels: new WeakMap(),
    next: 1,
    counted: 0,
    history: undefined,
    gone: new FinalizationRegistry((id) => {
      refs.delete(id);
      for (const fn of [...fns]) fn({ kind: 'gone', id });
    }),
    entries() {
      const out: Watched[] = [];
      for (const ref of refs.values()) {
        const mix = ref.deref();
        const entry = mix === undefined ? undefined : entries_.get(mix);
        if (entry !== undefined) out.push(entry);
      }
      return out;
    },
    on(fn) {
      fns.add(fn);
      return () => {
        fns.delete(fn);
      };
    },
  };
  slot[KEY] = r;
  return r;
}

/** The transports whose history the registry's default gave. */
const added = new WeakSet<object>();

/**
 * The history a mix or transport made with `opts` keeps: its own, or with none named and no
 * transport, the registry's default. Reads the registry only where one was made.
 */
export function historyFor(opts: { history?: MixOptions['history']; transport?: unknown }): {
  history: MixOptions['history'];
  added: boolean;
} {
  const fallback = slot[KEY]?.history;
  if (opts.history !== undefined || opts.transport !== undefined || fallback === undefined)
    return { history: opts.history, added: false };
  return { history: fallback, added: true };
}

/** Marks a transport whose history the registry's default gave. */
export function gave(transport: object): void {
  added.add(transport);
}

/** Lists a mix the host made, under an entry this copy builds. */
export function register(mix: Any): void {
  const r = registry();
  const id = r.next++;
  const transport = mix.transport;
  const entry: Watched = {
    id,
    release,
    name: mix.name,
    mix,
    get history() {
      const h = transport.history;
      return h === undefined
        ? undefined
        : { ms: h.ms, tape: transport.tape !== undefined, added: added.has(transport) };
    },
    get reach() {
      return reachOf(transport, false);
    },
    channels: mix.names as string[],
    voice: (handle) => {
      const v =
        mix.cued.find((c) => c.handle === handle) ?? mix.gone.find((c) => c.handle === handle);
      return v === undefined ? undefined : { name: v.spec.name, tags: v.spec.tags ?? [] };
    },
    label: (subject) => labelOf(mix, subject),
    watch: (fn) => tap(mix, fn),
    subjects: () => subjectsOf(mix),
    read: (subject, at = mix.now) => mix.project(at).probe(subject),
    hold: () => hold(transport),
  };
  r.entries_.set(mix, entry);
  r.refs.set(id, new WeakRef(mix));
  r.gone.register(mix, id);
  for (const fn of [...r.fns]) fn({ kind: 'add', entry });
}

function labelOf(mix: Any, subject: unknown): string {
  const own = (mix.opts.labelOf as ((s: unknown) => string | undefined) | undefined)?.(subject);
  return own ?? guess(subject);
}

interface DomLike {
  id: string;
  tagName: string;
  classList: Iterable<string>;
}

/** A name for a subject from the subject itself, numbered by class where nothing names it. */
function guess(subject: unknown): string {
  if (typeof subject !== 'object' || subject === null)
    return typeof subject === 'function' ? subject.name || 'function' : String(subject);
  const Element = (globalThis as { Element?: new () => DomLike }).Element;
  if (Element !== undefined && subject instanceof Element) {
    const id = subject.id ? `#${subject.id}` : '';
    const classes = [...subject.classList].map((c) => `.${c}`).join('');
    return `${subject.tagName.toLowerCase()}${id}${classes}`;
  }
  const o = subject as Record<string, unknown>;
  for (const k of ['name', 'id']) {
    const v = o[k];
    if ((typeof v === 'string' && v !== '') || typeof v === 'number') return String(v);
  }
  const r = registry();
  let label = r.labels.get(subject);
  if (label === undefined) {
    label = `${subject.constructor?.name || 'Object'} #${++r.counted}`;
    r.labels.set(subject, label);
  }
  return label;
}

function subjectsOf(mix: Any): unknown[] {
  const out = new Set<unknown>(taps.get(mix)?.seen);
  for (const v of mix.cued) for (const s of v.spec.subjects ?? []) out.add(s);
  return [...out];
}

/** What one transport has swapped while watched or held. */
interface Ctl {
  tapped: number;
  held: Held | null;
  /** Puts `sync` back; null while it is the prototype's. */
  unsync: (() => void) | null;
}

const ctls = new WeakMap<Transport, Ctl>();

function ctlOf(t: Transport): Ctl {
  let c = ctls.get(t);
  if (c === undefined) {
    c = { tapped: 0, held: null, unsync: null };
    ctls.set(t, c);
  }
  return c;
}

/** Puts `sync` on the transport while anything needs it, and takes it off when nothing does. */
function fit(t: Transport): void {
  const c = ctlOf(t);
  const wants = c.tapped > 0 || c.held !== null;
  if (wants && c.unsync === null) {
    const sync = proto(t).sync as (ts: number) => void;
    c.unsync = swap(t, 'sync', (ts: number) => {
      for (const m of t.members) flush(m);
      const held = c.held;
      if (held === null) sync.call(t, ts);
      else held.sync(ts);
    });
  } else if (!wants && c.unsync !== null) {
    c.unsync();
    c.unsync = null;
  }
}

/** Sets `key` on `on` itself, and returns what puts it back as it was. */
function swap(on: object, key: string, fn: unknown): () => void {
  const o = on as Record<string, unknown>;
  const own = Object.hasOwn(o, key);
  const was = o[key];
  o[key] = fn;
  return () => {
    if (own) o[key] = was;
    else delete o[key];
  };
}

function proto(o: object): Record<string, unknown> {
  return Object.getPrototypeOf(o) as Record<string, unknown>;
}

interface Tap {
  fns: Set<(frame: WatchedFrame<unknown, unknown>) => void>;
  frame: WatchedFrame<unknown, unknown> | null;
  seen: Set<unknown>;
  untap: () => void;
}

const taps = new WeakMap<object, Tap>();

function tap(mix: Any, fn: (frame: WatchedFrame<unknown, unknown>) => void): () => void {
  let t = taps.get(mix);
  if (t === undefined) {
    const p = proto(mix);
    const probe = p.probe as Any['probe'];
    const pull = p.pull as Any['pull'];
    const drain = p.drain as Any['drain'];
    const puts = [
      swap(mix, 'probe', (subject: unknown, out?: unknown) => {
        const pose = probe.call(mix, subject, out);
        const f = frameOf(mix);
        f.probed.push({ subject, pose: copy(pose) });
        (taps.get(mix) as Tap).seen.add(subject);
        return pose;
      }),
      swap(mix, 'pull', (subjects: Iterable<unknown>, into: Record<string, Float64Array>) => {
        const list = Array.isArray(subjects) ? subjects : [...subjects];
        pull.call(mix, list, into);
        const columns: Record<string, Float64Array> = {};
        for (const [k, v] of Object.entries(into)) if (v !== undefined) columns[k] = v.slice();
        frameOf(mix).pulled.push({ subjects: [...list], columns });
        const seen = (taps.get(mix) as Tap).seen;
        for (const s of list) seen.add(s);
      }),
      swap(mix, 'drain', (tag?: string) => {
        const out = drain.call(mix, tag);
        if (out.length > 0) frameOf(mix).sent.push(...(out as Sent<unknown, unknown>[]));
        return out;
      }),
    ];
    t = {
      fns: new Set(),
      frame: null,
      seen: new Set(),
      untap: () => {
        for (const put of puts) put();
      },
    };
    taps.set(mix, t);
    ctlOf(mix.transport).tapped++;
    fit(mix.transport);
  }
  const own = t;
  own.fns.add(fn);
  return () => {
    if (!own.fns.delete(fn) || own.fns.size > 0) return;
    own.untap();
    taps.delete(mix);
    ctlOf(mix.transport).tapped--;
    fit(mix.transport);
  };
}

/** The frame a read lands in, handing the last one over where the mix has moved on since. */
function frameOf(mix: Any): WatchedFrame<unknown, unknown> {
  const t = taps.get(mix) as Tap;
  if (t.frame !== null && t.frame.seq === mix.transport.seq) return t.frame;
  flush(mix);
  t.frame = {
    seq: mix.transport.seq,
    now: mix.now,
    timestamp: mix.timestamp,
    probed: [],
    pulled: [],
    sent: [],
    voices: mix.voices() as Handle<unknown>[],
  };
  return t.frame;
}

function flush(mix: Any): void {
  const t = taps.get(mix);
  const frame = t?.frame;
  if (t === undefined || frame == null) return;
  t.frame = null;
  for (const fn of [...t.fns]) fn(frame);
}

function copy<T>(pose: T): T {
  try {
    return (globalThis as unknown as { structuredClone: <V>(v: V) => V }).structuredClone(pose);
  } catch {
    return { ...pose };
  }
}

interface Held {
  sync(ts: number): void;
}

/** The earliest mix time history reaches back to; a seek needs a tape besides. */
function reachOf(t: Transport, seeking: boolean): number {
  const h = t.history;
  if (h === undefined || (seeking && t.tape === undefined)) return t.now;
  const kept = t.pager !== null ? Number.NEGATIVE_INFINITY : t.now - h.ms;
  return Math.max(t.born, t.floor, kept);
}

function hold(t: Transport): Hold {
  const c = ctlOf(t);
  if (c.held !== null) throw new Error('blits: that mix is held already; free it first');
  const p = proto(t);
  const ramp = p.ramp as Transport['ramp'];
  const rebase = p.rebase as Transport['rebase'];
  const sync = p.sync as Transport['sync'];
  const seekT = p.seek as Transport['seek'];
  const queue: (() => void)[] = [];
  let rate = 0;
  let quiet = false;
  let freed = false;
  // The host time the hold syncs the transport at, moved by the host's gaps at `rate`; the
  // transport's own rate is left alone, so nothing the hold does lands in its history.
  let line = t.last;
  let host = t.last;

  const hushed = (fn: () => void) => {
    const was = quiet;
    quiet = true;
    try {
      fn();
    } finally {
      quiet = was;
    }
  };
  const later = (fn: () => void) => {
    if (t.replaying || quiet) fn();
    else queue.push(fn);
  };
  /** Syncs at `line`, where a rebase the host asked for before the hold takes out no time of it. */
  const at = () => {
    if (t.rebasing && !Number.isNaN(t.last)) sync.call(t, t.last);
    sync.call(t, line);
  };

  const puts: (() => void)[] = [];
  const tape = t.tape as (Tape & Record<string, unknown>) | undefined;
  if (tape !== undefined) {
    const record = tape.recordEntry;
    // Behind the tape's last call, a call the host makes would cut the calls after it; it acts
    // on the mix but goes unrecorded, so they play on.
    puts.push(
      swap(tape, 'recordEntry', (...args: Parameters<Tape['recordEntry']>) => {
        if (quiet || tape.timestampAt(tape.undoDepth()) !== undefined) return;
        record.apply(tape, args);
      }),
    );
  }
  puts.push(
    swap(t, 'ramp', (r: number, over: number) => {
      if (!(r >= 0 && r < Number.POSITIVE_INFINITY))
        throw new RangeError(`blits: a mix's rate is a finite number, 0 or more, not ${r}`);
      later(() => ramp.call(t, r, over));
    }),
    swap(t, 'rebase', () => later(() => rebase.call(t))),
    swap(t, 'seek', (to: number | { readonly frame: number }) => later(() => seekT.call(t, to))),
  );
  for (const m of t.members) {
    const mixSeek = proto(m).seek as Any['seek'];
    puts.push(
      swap(m, 'seek', (to: number | { readonly frame: number }) => {
        if (t.shared) mixSeek.call(m, to);
        else later(() => mixSeek.call(m, to));
      }),
    );
  }

  c.held = {
    sync(ts) {
      if (Number.isNaN(line)) line = ts;
      else if (!Number.isNaN(host) && ts > host) line += (ts - host) * rate;
      host = ts;
      at();
    },
  };
  fit(t);
  t.woke();

  const live = () => {
    if (freed) throw new Error('blits: that hold was freed');
  };
  return {
    get mixes() {
      return [...t.members] as Hold['mixes'];
    },
    get now() {
      return t.now;
    },
    get reach() {
      return reachOf(t, true);
    },
    get rate() {
      return rate;
    },
    set rate(r: number) {
      live();
      if (!(r >= 0 && r < Number.POSITIVE_INFINITY))
        throw new RangeError(`blits: a hold's rate is a finite number, 0 or more, not ${r}`);
      rate = r;
    },
    seek(to) {
      live();
      hushed(() => seek(t, to));
    },
    step(ms) {
      live();
      if (!(ms > 0)) return;
      if (Number.isNaN(line))
        throw new Error('blits: a mix that has never synced has nothing to step');
      const u = hostAhead(t, t.now + ms);
      if (!Number.isFinite(u))
        throw new RangeError("blits: the mix's own rate is 0, so it never moves");
      line = Math.max(line, u + t.offset);
      at();
      for (const m of t.members) m.stir();
    },
    free() {
      if (freed) return;
      freed = true;
      try {
        rebase.call(t);
        // Still behind the guard on the tape, so a call made behind its last one cuts nothing.
        for (const fn of queue) fn();
      } finally {
        for (const put of puts.reverse()) put();
        c.held = null;
        fit(t);
        t.woke();
      }
    },
  };
}
