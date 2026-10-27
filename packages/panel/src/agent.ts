import { type Hold, type Watched, type WatchedFrame, watched } from '@msb235/blits';
import { Ids } from './ids.js';
import { marksOf } from './marks.js';
import { offered } from './offer.js';
import type {
  Command,
  Event,
  HoldInfo,
  MixInfo,
  Sample,
  Source,
  SubjectInfo,
  VoiceInfo,
} from './protocol.js';

/** What the page side of the panel can be told about the app; `offer()` tells it the same from afar. */
export interface AgentOptions {
  /** The subject under a point in client coordinates, for scenes the DOM cannot see into. */
  pick?: (x: number, y: number) => unknown;
  /** Where a subject is on screen, in client coordinates; a DOM element's own box otherwise. */
  outline?: (subject: unknown) => DOMRect | undefined;
  /** The panel's own element: picking on the page passes over it. */
  ignore?: Element;
}

/** How far back a newly picked subject's plot is filled from history, ms. */
const BACKFILL_MS = 10_000;
const BACKFILL_STEP_MS = 100;
/** How often the subject list and the voices' weights are sent, ms. */
const LIST_MS = 500;
const VOICES_MS = 250;
const DEPTH = 3;

/** Each numeric part of a pose under a flat key: `x`, `position[1]`, `color.l`. */
export function flatten(pose: unknown, out: Record<string, number> = {}, key = '', depth = 0) {
  if (typeof pose === 'number') {
    if (key !== '') out[key] = pose;
  } else if (Array.isArray(pose) || ArrayBuffer.isView(pose)) {
    if (depth < DEPTH)
      Array.from(pose as ArrayLike<unknown>).forEach((v, i) => {
        flatten(v, out, `${key}[${i}]`, depth + 1);
      });
  } else if (typeof pose === 'object' && pose !== null && depth < DEPTH)
    for (const [k, v] of Object.entries(pose))
      flatten(v, out, key === '' ? k : `${key}.${k}`, depth + 1);
  return out;
}

/**
 * The page side of the panel: finds the mixes, watches the one picked, holds its clock, and picks
 * and outlines subjects on the page. Speaks only in the protocol's plain data.
 */
export function agent(opts: AgentOptions = {}): Source & { dispose(): void } {
  const fns = new Set<(event: Event) => void>();
  const ids = new Ids();
  const registry = watched();
  // The picked mix by id, looked up each time: holding its entry would keep it alive.
  let curId: number | null = null;
  let subject: unknown;
  let unwatch: (() => void) | null = null;
  let hold: Hold | null = null;
  let elsewhere = false;
  let lastList = '';
  let voicesAt = Number.NEGATIVE_INFINITY;
  let lastMarks = '';
  let owners = new Map<unknown, number>();
  /** What each voice was cued with, by handle id; a voice's name and tags never change. */
  const named = new Map<number, { name: string | null; tags: string[] }>();

  const emit = (event: Event) => {
    for (const fn of [...fns]) fn(event);
  };
  const entries = () => registry.entries();
  const byId = (id: number) => entries().find((e) => e.id === id);
  const current = (): Watched | null => (curId === null ? null : (byId(curId) ?? null));

  const mixInfo = (e: Watched): MixInfo => ({
    id: e.id,
    name: e.name ?? `mix ${e.id}`,
    release: e.release,
    channels: [...e.channels],
    history: e.history === undefined ? null : { ...e.history },
  });
  const sendMixes = () => emit({ kind: 'mixes', mixes: entries().map(mixInfo) });

  const holdInfo = (): HoldInfo => {
    if (hold !== null) return { state: 'held', rate: hold.rate, now: hold.now, reach: hold.reach };
    const now = current()?.mix.now ?? Number.NaN;
    return { state: elsewhere ? 'elsewhere' : 'free', rate: 1, now, reach: now };
  };
  const sendHold = () => emit({ kind: 'hold', hold: holdInfo() });

  const voices = (): VoiceInfo[] => {
    const e = current();
    if (e === null) return [];
    const handles = e.mix.voices();
    const live = new Set(handles.map((h) => h.id));
    for (const id of named.keys()) if (!live.has(id)) named.delete(id);
    return handles.map((h) => {
      let v = named.get(h.id);
      if (v === undefined) {
        const cued = e.voice(h);
        v = { name: cued?.name ?? null, tags: [...(cued?.tags ?? [])] };
        named.set(h.id, v);
      }
      let weight = Number.NaN;
      if (subject !== undefined)
        try {
          weight = h.weightOf(subject);
        } catch {}
      return {
        id: h.id,
        name: v.name,
        tags: v.tags,
        state: h.state,
        weight,
      };
    });
  };
  const sendVoices = () => {
    voicesAt = Date.now();
    emit({ kind: 'voices', voices: voices() });
    sendMarks();
  };

  const sendMarks = () => {
    const e = current();
    const list = e === null ? [] : marksOf(e, BACKFILL_MS);
    const text = JSON.stringify(list);
    if (text === lastMarks) return;
    lastMarks = text;
    emit({ kind: 'marks', marks: list });
  };

  /** Sends the subject list where it changed, and notes which mix lists each subject. */
  const sendSubjects = () => {
    const next = new Map<unknown, number>();
    const e = current();
    for (const x of entries()) for (const s of x.subjects()) if (!next.has(s)) next.set(s, x.id);
    if (e !== null) for (const s of e.subjects()) next.set(s, e.id);
    owners = next;
    ids.prune();
    if (e === null) return;
    const list: SubjectInfo[] = e.subjects().map((s) => ({ id: ids.of(s), label: e.label(s) }));
    const text = JSON.stringify(list);
    if (text === lastList) return;
    lastList = text;
    emit({ kind: 'subjects', subjects: list });
  };

  const sampleOf = (e: Watched, frame: WatchedFrame<unknown, unknown>): Sample | null => {
    let pose: unknown;
    for (const p of frame.probed) if (p.subject === subject) pose = p.pose;
    const read = pose === undefined;
    if (read)
      try {
        pose = e.read(subject);
      } catch {
        return null;
      }
    const weights: Record<number, number> = {};
    for (const h of frame.voices)
      try {
        weights[h.id] = h.weightOf(subject);
      } catch {}
    return { now: frame.now, values: flatten(pose), weights, read };
  };

  const backfill = (e: Watched): Sample[] => {
    const h = e.history;
    const now = e.mix.now;
    if (h === undefined || !Number.isFinite(now)) return [];
    const out: Sample[] = [];
    const from = Math.max(e.reach, now - Math.min(BACKFILL_MS, h.ms));
    for (let t = from; t < now; t += BACKFILL_STEP_MS)
      try {
        out.push({ now: t, values: flatten(e.read(subject, t)), weights: {}, read: true });
      } catch {}
    return out;
  };

  const onFrame = (frame: WatchedFrame<unknown, unknown>) => {
    const e = current();
    if (e === null) return;
    if (subject !== undefined) {
      const s = sampleOf(e, frame);
      if (s !== null) emit({ kind: 'samples', samples: [s], reset: false });
    }
    if (Date.now() - voicesAt >= VOICES_MS) sendVoices();
    sendHold();
  };

  const freeHold = () => {
    hold?.free();
    hold = null;
  };

  const pickMix = (id: number | null) => {
    const e = id === null ? undefined : byId(id);
    if (hold !== null && (e === undefined || !hold.mixes.includes(e.mix))) freeHold();
    unwatch?.();
    unwatch = null;
    curId = e?.id ?? null;
    subject = undefined;
    lastList = '';
    lastMarks = '';
    elsewhere = false;
    named.clear();
    if (e !== undefined) unwatch = e.watch(onFrame);
    emit({ kind: 'picked', mix: curId, subject: null });
    emit({ kind: 'samples', samples: [], reset: true });
    sendSubjects();
    sendVoices();
    sendHold();
  };

  const pickSubject = (id: number | null) => {
    subject = id === null ? undefined : ids.get(id);
    const e = current();
    emit({ kind: 'picked', mix: e?.id ?? null, subject: subject === undefined ? null : id });
    emit({
      kind: 'samples',
      samples: e !== null && subject !== undefined ? backfill(e) : [],
      reset: true,
    });
    sendVoices();
  };

  // On-page picking and the outline over the page.
  let overlay: HTMLDivElement | null = null;
  const outline = (s: unknown) => {
    let rect: DOMRect | undefined;
    if (s !== undefined)
      rect =
        (opts.outline ?? offered().outline)?.(s) ??
        (s instanceof Element ? s.getBoundingClientRect() : undefined);
    if (rect === undefined) {
      overlay?.remove();
      overlay = null;
      return;
    }
    if (overlay === null) {
      overlay = document.createElement('div');
      overlay.setAttribute('data-blits-panel', 'outline');
      Object.assign(overlay.style, {
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: '2147483647',
        border: '2px solid #e0457b',
        borderRadius: '2px',
        boxSizing: 'border-box',
      });
      document.body.appendChild(overlay);
    }
    Object.assign(overlay.style, {
      left: `${rect.left}px`,
      top: `${rect.top}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
  };

  const inPanel = (ev: globalThis.Event) =>
    opts.ignore !== undefined && ev.composedPath().includes(opts.ignore);

  /** The subject under a point, and the mix that lists it. */
  const at = (x: number, y: number): [unknown, number] | undefined => {
    const custom = (opts.pick ?? offered().pick)?.(x, y);
    if (custom !== undefined) {
      const e = owners.get(custom);
      if (e !== undefined) return [custom, e];
    }
    const els =
      typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : [document.elementFromPoint(x, y)].filter((el): el is Element => el !== null);
    for (const el of els) {
      if (el === overlay || opts.ignore?.contains(el)) continue;
      for (let n: Element | null = el; n !== null; n = n.parentElement) {
        const e = owners.get(n);
        if (e !== undefined) return [n, e];
      }
    }
    return undefined;
  };

  const onMove = (ev: PointerEvent) => {
    if (inPanel(ev)) return;
    outline(at(ev.clientX, ev.clientY)?.[0]);
  };
  const onClick = (ev: MouseEvent) => {
    if (inPanel(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    const hit = at(ev.clientX, ev.clientY);
    arm(false);
    if (hit === undefined) return;
    const [s, e] = hit;
    if (curId !== e) pickMix(e);
    sendSubjects();
    pickSubject(ids.of(s));
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') arm(false);
  };
  let armed = false;
  const arm = (on: boolean) => {
    if (on === armed) return;
    armed = on;
    if (on) {
      sendSubjects();
      document.addEventListener('pointermove', onMove, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKey, true);
    } else {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      outline(undefined);
    }
    emit({ kind: 'arming', on });
  };

  const send = (c: Command) => {
    switch (c.kind) {
      case 'mix':
        pickMix(c.id);
        return;
      case 'subject':
        pickSubject(c.id);
        return;
      case 'hold':
        if (!c.on) freeHold();
        else if (hold === null && current() !== null)
          try {
            hold = (current() as Watched).hold();
            elsewhere = false;
          } catch {
            elsewhere = true;
          }
        sendHold();
        return;
      case 'rate':
        if (hold !== null) hold.rate = c.rate;
        sendHold();
        return;
      case 'step':
        try {
          hold?.step(c.ms);
        } catch {}
        sendHold();
        return;
      case 'seek':
        try {
          hold?.seek(c.to);
        } catch {}
        sendHold();
        return;
      case 'arm':
        arm(c.on);
        return;
      case 'outline':
        outline(c.subject === null ? undefined : ids.get(c.subject));
        return;
    }
  };

  /** With nothing picked and one mix on the page, there is nothing to choose: pick it. */
  const pickOnly = () => {
    const [only, ...rest] = entries();
    if (curId === null && only !== undefined && rest.length === 0) pickMix(only.id);
  };

  const offRegistry = registry.on((change) => {
    sendMixes();
    if (change.kind === 'gone' && curId === change.id) pickMix(null);
    pickOnly();
  });
  pickOnly();
  const timer = setInterval(sendSubjects, LIST_MS);

  return {
    subscribe(fn) {
      fns.add(fn);
      fn({ kind: 'mixes', mixes: entries().map(mixInfo) });
      fn({
        kind: 'picked',
        mix: curId,
        subject: subject === undefined ? null : ids.of(subject),
      });
      fn({ kind: 'hold', hold: holdInfo() });
      const e = current();
      fn({ kind: 'marks', marks: e === null ? [] : marksOf(e, BACKFILL_MS) });
      return () => {
        fns.delete(fn);
      };
    },
    send,
    dispose() {
      arm(false);
      freeHold();
      unwatch?.();
      unwatch = null;
      clearInterval(timer);
      offRegistry();
      outline(undefined);
      fns.clear();
    },
  };
}
