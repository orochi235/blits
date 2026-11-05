import type { Doubt, Mix, Run } from '@msb235/blits';
import { type Mixed, SWINGS, type SwingName } from './kit';
import { copied } from './player';
import type { Subject } from './stage';

type Failed = { error: string };

const said = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** One subject's pose at a past mix time, as `project` reads it from history, with how sure it is. */
export type ReadBack = { at: number; pose: Mixed; doubts: { [K in keyof Mixed]: Doubt } } | Failed;

export function readBack(mix: Mix<Subject, Mixed>, subject: Subject, at: number): ReadBack {
  try {
    const p = mix.project(at);
    return {
      at: p.timestamp,
      pose: copied(p.probe(subject)),
      doubts: p.assess(subject),
    };
  } catch (e) {
    return { error: said(e) };
  }
}

export type Traced = { from: number; to: number; runs: Record<SwingName, Run> } | Failed;

/** One subject's one-number channels over the next `ahead` ms of mix time, as `trace` reads them. */
export function traceAhead(mix: Mix<Subject, Mixed>, subject: Subject, ahead: number): Traced {
  try {
    const t = mix.trace(mix.now, mix.now + ahead);
    const runs = Object.fromEntries(SWINGS.map((ch) => [ch, t.of(subject, ch)])) as Record<
      SwingName,
      Run
    >;
    return { from: t.from, to: t.to, runs };
  } catch (e) {
    return { error: said(e) };
  }
}

/** Whether the subject's every channel is at rest this frame, and whether the mix could sleep. */
export function restOf(mix: Mix<Subject, Mixed>, subject: Subject) {
  return { atRest: mix.atRest(subject), inert: mix.inert };
}
