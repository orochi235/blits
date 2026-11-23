import type { MixOptions } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { type LoopOptions, loop } from './loop';

/** How far back a demo's mixes can seek unless it says otherwise, ms. */
export const KEPT = 10_000;

/** What a demo is handed to set itself up with; everything it registers is undone when it stops. */
export interface Demo {
  readonly root: HTMLElement;
  /**
   * A mix's options: its name, history to seek back `ms`, and `more`. A mix on a transport takes
   * the transport's history, so it gets none of its own.
   */
  options<H = unknown>(name: string, more?: MixOptions<H>, ms?: number): MixOptions<H>;
  /** History for a transport or a mix: `ms` of it, with a tape, so it can seek back. */
  history(ms?: number): NonNullable<MixOptions['history']>;
  /** Adds a listener, taken off when the demo stops. */
  on<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window,
    type: K,
    fn: (e: HTMLElementEventMap[K]) => void,
  ): void;
  /** Runs `frame` on every animation frame through `loop`, with `clock` its mix or transport. */
  frame(clock: { rebase(): void }, frame: (now: number) => void, opts?: LoopOptions): void;
  /** Closes each mix when the demo stops, so the debug panel no longer lists it. */
  closes(...mixes: { close(): void }[]): void;
  /** Runs `fn` when the demo stops. */
  stops(fn: () => void): void;
}

/** A live demo: `setup` builds it in `root`, and the function returned stops it and undoes it all. */
export function demo(setup: (d: Demo) => void): (root: HTMLElement) => () => void {
  return (root) => {
    const undo: (() => void)[] = [];
    const history = (ms = KEPT) => ({ ms, tape: createHistory });
    const d: Demo = {
      root,
      history,
      options: (name, more = {}, ms = KEPT) => ({
        name,
        ...(more.transport ? {} : { history: history(ms) }),
        ...more,
      }),
      on: (target, type, fn) => {
        target.addEventListener(type, fn as EventListener);
        undo.push(() => target.removeEventListener(type, fn as EventListener));
      },
      frame: (clock, frame, opts) => {
        undo.push(loop(clock, root, frame, opts));
      },
      closes: (...mixes) => {
        for (const m of mixes) undo.push(() => m.close());
      },
      stops: (fn) => {
        undo.push(fn);
      },
    };
    setup(d);
    return () => {
      for (const fn of undo.reverse()) fn();
    };
  };
}
