import { type Kit, kit, mix, sum, tween } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { useEffect, useRef, useState } from 'react';
import type { Frame } from './scene';
import { SETTLE } from './settle-ms';

interface Shown {
  shown: number;
}

const HELD = {};

/**
 * How much of a held frame shows, 1 playing and 0 at rest, on a mix of its own: an explainer
 * settles over the frame it stopped on, so the run its player replays stays as it was played.
 */
export class Settle {
  readonly mix;
  private readonly move;

  constructor(name: string, now: number) {
    this.move = tween<object, Shown>('shown', { from: 1, to: 1, ms: SETTLE });
    this.mix = mix<object, Shown>(kit<Shown>({ shown: sum() }), {
      name,
      history: { ms: 2 * SETTLE, tape: createHistory },
    });
    this.mix.sync(now);
    this.mix.cue({ patch: this.move, subjects: [HELD], name: 'shown' });
  }

  /** Heads to rest, or back up, from wherever it stands; the time it stood still is not its own. */
  go(rest: boolean): void {
    this.mix.rebase();
    this.move.to(HELD, rest ? 0 : 1);
  }

  /** How much of the held frame shows at frame time `now`. */
  at(now: number): number {
    this.mix.sync(now);
    return this.mix.probe(HELD).shown;
  }

  /** Where it has nowhere left to go, so nothing need sync it. */
  get still(): boolean {
    return this.mix.inert;
  }

  close(): void {
    this.mix.close();
  }
}

/**
 * How much of the frame shows while `rest` holds and after: it settles to rest over `SETTLE` as
 * `rest` turns on, and rises as it turns off. Its mix, `name`, is made in the browser.
 */
export function useSettle(name: string, rest: boolean): number {
  const settle = useRef<Settle | null>(null);
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const s = new Settle(name, performance.now());
    settle.current = s;
    return () => {
      s.close();
      settle.current = null;
    };
  }, [name]);
  useEffect(() => {
    const s = settle.current;
    if (s === null) return;
    s.go(rest);
    let id = requestAnimationFrame(function tick(now) {
      setShown(s.at(now));
      if (!s.still) id = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(id);
  }, [name, rest]);
  return shown;
}

/** `frame` with each pose weighed toward rest by `w`, through each channel's own `scale`. */
export function settled<I, O>(kitOf: Kit<O>, frame: Frame<I, O>, w: number): Frame<I, O> {
  if (w >= 1) return frame;
  const channels = kitOf as Record<string, { scale?(v: unknown, w: number): unknown }>;
  const poses = frame.poses.map((pose) => {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(pose as Record<string, unknown>)) {
      const scale = channels[key]?.scale;
      out[key] = scale === undefined || v === undefined ? v : scale(v, w);
    }
    return out as O;
  });
  return { ...frame, poses };
}
