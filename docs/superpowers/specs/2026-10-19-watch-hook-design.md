# Watch hook — design

**Unbuilt (2026-10-19).** Nothing here exists in the code yet.

**For:** whoever builds the engine side of blits debugging tools. **Answers:** how a debugger finds
every mix on a page and reads it, and how it pauses and scrubs a mix, all at no cost to a mix
nobody is watching.

## Why

There are no tools for watching a running mix. The playground's `Inspector.tsx` plots a subject's
channels and voice weights, but it reads the playground's own `Player`, not anything the engine
exports, so magicsmoke and every other host have nothing to look at. Two tools are planned on top
of this hook: an in-page panel package, and a Chrome DevTools extension that hosts the same panel.
This document covers only the engine side they share. Neither tool is part of this work.

## Goals

- A debugger finds every mix on the page, including mixes from different blits copies (the
  playground loads two today) and mixes made before the debugger loaded.
- It sees what the host actually read each frame: poses, events, voices and their weights.
- It can hold a mix's clock: pause, step, scrub, change the rate, and then let go.
- A mix nobody watches pays nothing per frame. blits aims at maximum speed (HANDOFF), so the bench
  must show no regression with the hook built in and nothing attached.

## Non-goals

- The panel and the extension. The hook hands over live objects; serializing them for the
  extension is the extension's job.
- Editing voices from the debugger (fading, cueing, reweighting). Holding the clock is the only
  write.
- Storing frames. Each frame goes to the watcher as it happens, and the watcher keeps what it wants.

## Anti-goals

- **Watching changes what plays.** The debugger never calls `probe` itself, because a `slew`
  starts where a probe first meets its subject, so an extra probe would change the output. Reads
  of subjects the host doesn't probe go through `project`, which moves nothing.
- **Debugger calls on the app's tape.** The debugger's own calls are never recorded. Its `seek`
  moves the tape the way any `seek` does, and `free` puts the app's branch back (see Branches).

## Design (decided in conversation)

### Registry

The engine has one registry, shared by every blits copy in the realm through `Symbol.for`, the
way `shared()` in `src/shared.ts` already works. The registry's key carries a protocol version,
which is bumped whenever the protocol's shape changes.

- Every mix and transport registers itself at creation, whether or not a debugger is present. The
  registry holds it through a `WeakRef`, so it never keeps a mix alive, and a
  `FinalizationRegistry` reports when one is gone. That costs one registration per mix created
  and nothing per frame.
- Each entry is an object built by the copy that made the mix, carrying that copy's `release`.
  The debugger only ever calls those entries' methods, so it works across copies of different
  releases without knowing their internals.
- The debugger can subscribe to entries being added and removed.

### Watching: tap the host's reads

When a debugger starts watching a mix, the hook swaps `probe`, `pull` and `drain` on that one
`Mixer` instance for versions that call the originals and record what they returned. Unwatching
puts the originals back. A mix nobody watches runs exactly the code it runs today.

- Each frame (keyed by `seq`, along with `now` and `timestamp`), the watcher gets:
  - every subject the host probed, with the pose it got
  - what `pull` wrote
  - a copy of what `drain` handed the host (the host still gets every event)
  - the voices, through the public `voices()`, `state`, `weightOf` and `marks`
- For a subject the host never reads, the watcher passes the subject object itself, and the hook
  reads it through `project(now)`. The hook lists those subjects by walking each voice's subjects.
- A watcher sees a frame only once the host has read it. For a mix on lanes, a frame closes at the
  next `sync`.

### Naming subjects

`MixOptions.labelOf?(subject): string` is a new option beside `keyOf`. Where it is not given, or
returns nothing, the hook guesses:

| Subject | Label |
|---|---|
| String or number | Itself |
| DOM element | `div#hero.card` |
| Object with a non-empty `.name` or `.id` | That value |
| Any other object | Class name plus a counter: `Object3D #4` |

Registry entries expose the label function, so the panel never guesses on its own.

### Holding the clock

`hold()` on an entry takes the clock from the app. Scrubbing moves the page itself: going back is a
real `seek`, so the scene on the page jumps back and plays again.

- **Scope.** A mix plays on its transport, either its own or a shared one. A mix on a shared
  transport is held through that transport, so holding it holds every mix on it, and the debugger
  is told which mixes those are.
- **The app while held.**
  - The app's `sync` calls are swallowed. Each one still counts as a frame: the held mix advances
    by that frame's gap times the debugger's rate. Rate 0 is paused.
  - The app's other clock calls (`seek`, `rate`, `ramp`, `rebase`) are queued and applied on
    `free`, in order.
  - The app's other calls (`cue`, `fade` and so on) land at the held time and go on the tape, as
    they are the app's own.
- **The debugger's calls.**
  - `seek`, `step(ms)` and `rate` are never recorded on the tape.
  - Each one fires `onWake`, so an app that sleeps on `inert` still redraws. That changes when the
    app draws, not what it draws.
- **Going back** is `seek`, which needs `history` with a tape (`src/seek.ts` throws without one).
  - Without both, a held mix can only pause and step forward.
  - The entry says how far back it reaches, so the panel can grey out going back.
- **Branches.** A `seek` back moves the tape. An app call made while held at an earlier time
  starts a branch, and the app's later calls stay on the old one. On `free`, the hook switches
  the tape back to the branch the app was on when the hold began (`Tape.switchBranch`), and
  seeks forward to where the debugger left the clock, so the mix doesn't lose what the app cued
  before the hold.
- **Letting go.**
  - The mix resumes from wherever the debugger left it. Held time is taken out of the clock the
    way `rebase` takes time out, so the app's next `sync` carries on from there rather than
    jumping to the app's clock.
  - The app's rate comes back, then its queued calls are applied.

### History added by the debugger

If a debugger is present before mixes are made, it can put a history default on the registry,
for example `{ ms: 10000, tape }`.

- `tape` is a `TapeMaker` the debugger supplies (weasel's `createHistory`), so the engine gains
  no dependency.
- `mix()` and `transport()` use the default only when their options name no `history` and no
  `transport`.
- A mix that got its history this way says so on its entry, so the panel can show
  "history: 10 s, added by the debugger".

### Where registration happens

In the `Mixer` and `Transport` constructors, so mixes from `lean` register too. The `Mixer`s and
`Transport`s that a projection builds for itself (`src/project.ts`) do not register. Custom
engines can register through the same protocol later, but nothing in this work does that for
them.

### Speed

- A mix that has never been watched pays nothing per frame.
- A mix that was watched and then unwatched may stay slower, since V8 can leave an object on a
  slower path after its methods are swapped. That is acceptable for a debugging tool.
- The bench measures both cases. The probe's hot path relies on prototype methods
  (`src/mixer.ts`, "up to 9%"), so the tap must not add a check on the unwatched path.

## Left to the builder

- The protocol's exact type names, which become public types exported from the engine, and its
  method names. **My call, Mike's to overturn:** `watch`, `hold`, and `free` to let go.
- How the hold swallows calls and keeps the debugger's calls off the tape. The likely route is an
  instance swap on the `Transport` plus an internal flag the recorder checks.
- How a frame hands over `pull` columns: copied, or as views that are valid only during the
  callback.
- Bookings during a hold. A `book` booker has already scheduled things against its own clock (the
  blits-tone driver does this), and those still play. Document it; don't try to cancel them.
- Tests:
  - the tap returns exactly what the host got
  - unwatching restores the original methods
  - a held mix ignores the app's `sync` and plays at the debugger's rate
  - the app's clock calls are applied on `free`
  - a `seek` back and then `free` puts the app's later calls back
  - letting go resumes where the debugger left the mix
  - the debugger's calls are not on the tape
  - an entry from a second copy is found
  - a mix that is collected leaves the registry
  - the bench, both with nothing attached and after unwatching

## Where things are

- `src/mixer.ts`: `Mixer`, and `mix()` at the bottom. `own()` sends clock calls to the transport.
- `src/transport.ts`: `Transport` and `transport()`.
- `src/shared.ts`: `release`, and the `Symbol.for` pattern.
- `src/types/mix.ts`: `MixOptions`, where `labelOf` goes.
- `apps/playground/src/app/Inspector.tsx`: the plots the panel will reuse.
