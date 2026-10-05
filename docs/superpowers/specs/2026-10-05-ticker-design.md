# A ticker for blits

**Status: unbuilt** (approved 2026-10-05, branch `ticker`). Delete this file once the ticker is
merged; the schema page and the doc comments are the durable record.

**For:** whoever builds it. **Answers:** what the ticker is, what the mix gains for it, and what
it leaves to the host.

## Why

The mix is pull-based: the host owns the frame loop and calls `sync`. Every browser host has
written the same loop — wod's `src/clock/ticker.ts`, klieg's `RafClock`, magicsmoke's canvas
`wake`/`tick`, weasel's `useVisibleRaf`. blits ships one, opt-in, beside the mix. The mix itself
still runs no loop.

## The mix: `onStir`

```ts
mix.onStir(fn: () => void): () => void   // returns unsubscribe
```

Calls `fn` when a host call makes the mix need frames again: the internal `stirred` flag going
from false to true. Every path that already calls `stir()` counts — `cue`, a fade, `mute`, a
handle's controls, `mix.ramp`/`rate`, `drop`, a motion patch's `to`/`push` on a landed subject.
It fires once per flip, so 10k cues in one frame call it once, and never while `sync` runs: a stir
made inside a sync leaves `inert` false, which the frame's end reads anyway. A mix with no listener
pays one branch per `stir`.

The schema page's "the mix never calls back into the host" becomes "never calls back while
syncing"; `live`'s doc points at `onStir` instead of telling the host to restart its loop by hand.

## The ticker

```ts
ticker(opts?: {
  fps?: number;                 // cap; default none under rAF, 60 under a timer
  via?: 'frame' | 'timer';      // default: 'frame' where requestAnimationFrame exists, else 'timer'
  now?: () => number;           // default: the rAF timestamp, or performance.now() under a timer
  raf?: (cb: (t: number) => void) => number;
  caf?: (id: number) => void;
}): Ticker

interface Ticker {
  add(mix: { sync(t: number): void; readonly inert: boolean; onStir(fn: () => void): () => void }): () => void;
  each(fn: (t: number) => void): () => void;   // runs after every mix has synced
  stay(): () => void;                          // keeps frames coming until released
  stop(): void;                                // cancels the waiting frame
  now(): number;
}
```

Exported from the main entry. It reads `requestAnimationFrame`, `setTimeout` and `performance`
from `globalThis` only when it runs, so the package keeps `lib: ES2022` and imports cleanly in Node.

**A frame:** one timestamp; `sync` on every added mix in the order added; each `each` subscriber.
Then it schedules the next frame while any `stay` is held or any mix is not `inert`, and otherwise
sleeps until a mix's `onStir`, a `stay`, or an `add` wakes it. A mix or subscriber that throws does
not stop the loop or the others: the error is rethrown on a microtask.

**The cap, `fps`:** under rAF, a frame arriving less than one interval (less 1 ms of slack) after
the last frame that ran is skipped, with no sync, and the next is requested. The interval is kept
on a grid, so a 60 Hz display capped at 30 runs every other frame rather than drifting.

**Workers, `via`:** where there is no `requestAnimationFrame` (a worker without one, Node), or with
`via: 'timer'`, frames come from `setTimeout` at `fps` (60 by default), timed by
`performance.now()`. A worker's `performance.now()` has its own origin, not the page's, so a host
syncing in a worker gives every `start` on the worker's clock.

**Left to the host:** hidden-tab handling (`rebase` on `visibilitychange`, as the schema page says),
and which clock wod's WAAPI rotor shares (wod passes `now`).

## Tests

A fake `raf`/`caf` and `now`, and fake timers for `via: 'timer'`: a cue wakes a sleeping loop; an
inert mix lets it sleep; `stay` holds it awake; a throw doesn't stop the loop; `fps` skips frames
on its grid; the timer path runs without rAF. `onStir` fires once per flip and not during `sync`.

## After

wod's `ticker.ts` can become this with `now` set to `document.timeline.currentTime` — a follow-up
in wod's repo, filed there.
