import type { Blend } from './blend.js';
import { resight } from './everyone.js';
import { goneIndex } from './gone.js';
import { Per } from './lane.js';
import type { Lanes } from './lanes.js';
import type { Mixer } from './mixer.js';
import type { Subject } from './subject.js';
import { reunreach } from './unreached.js';
import type { Voice } from './voice.js';

/**
 * Gives a subject the free number `to` in place of its own, carrying everything kept under the old
 * one, so `pull` can keep a list's numbers in its order: a list kept dense by swap-remove moves its
 * last subject into the place a dropped one left, whose number the drop just freed. Says whether it
 * did; it does not where some store it would have to carry is in use: while a fill runs, under
 * history, in a read ahead, or with roles, a bound or anything owed on the lanes.
 */
export function renumber<I, O>(
  mix: Mixer<I, O>,
  subject: I,
  head: Subject<unknown>,
  to: number,
): boolean {
  const lanes = mix.lanes as Lanes<I, O>;
  const from = head.slot;
  if (
    from < 0 ||
    lanes.filling ||
    lanes.host.keeps ||
    mix.projecting ||
    lanes.roles.length > 0 ||
    lanes.owed.any() ||
    lanes.lanes.some((lane) => lane.voice.bound !== null) ||
    !lanes.numbers.move(from, to)
  )
    return false;
  for (const lane of lanes.lanes) lane.renumber(from, to);
  const placed = lanes.placed;
  for (const id of placed.all(from)) {
    placed.remove(from, id);
    const c = lanes.crowdOf.get(id);
    const p = c?.rowOf.get(id);
    if (c === undefined || p === undefined || c.list[p] !== from) continue;
    c.list[p] = to;
    placed.add(to, id);
  }
  const per = lanes.per;
  per.copyWithin(to * Per.SLOT, from * Per.SLOT, (from + 1) * Per.SLOT);
  per[from * Per.SLOT + Per.FILLED] = lanes.fills;
  lanes.unlinked[to] = lanes.unlinked[from] as number;
  lanes.subjects[to] = lanes.subjects[from];
  lanes.subjects[from] = undefined;
  for (const ch of lanes.laned)
    ch.values.copyWithin(to * ch.axes, from * ch.axes, (from + 1) * ch.axes);
  mix.places?.forgot(from);
  mix.places?.number(subject, to);
  const cap = lanes.cap;
  for (const voice of mix.general) {
    reunreach(voice, from, to);
    resight(voice, from, to, cap);
    reblend(mix, voice, from, to);
  }
  for (const voice of goneIndex(mix).general) reunreach(voice, from, to);
  for (let held: Subject<unknown> | null = head; held !== null; held = held.next)
    if (held.voice !== null) reblend(mix, held.voice as Voice<I, O>, from, to);
  head.slot = to;
  return true;
}

/** Moves a blend's read for the subject this frame, if it has made one, to its new number. */
function reblend<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, from: number, to: number): void {
  const of = voice.blend?.of as Blend<I, O> | undefined;
  if (of === undefined || from >= of.frames.length || of.frames[from] !== mix.frame) return;
  if (to >= of.frames.length) {
    const size = Math.max(to + 1, of.frames.length * 2, 64);
    const frames = new Float64Array(size);
    const values = new Float64Array(size);
    frames.set(of.frames);
    values.set(of.values);
    of.frames = frames;
    of.values = values;
  }
  of.frames[to] = mix.frame;
  of.values[to] = of.values[from] as number;
  of.frames[from] = Number.NaN;
}
