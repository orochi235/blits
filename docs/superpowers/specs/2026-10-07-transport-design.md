# Transport: one clock for several mixes

**Status: designed 2026-10-07, not built.** No code exists for anything here.

For whoever builds it in blits, and for astv, its first consumer. It answers how mixes with
different kits share one timeline — one sync, rate, seek and tape — and how an anchor in one mix
waits on a voice in another. It also adds `coast`, a mark the shared timeline needs.

A **mix** folds voices into one pose per subject over one **kit**, its set of channels. astv runs
several, each with its own pose type: orb flights, page turns, a scroll glide per document, a text
run per window. Its snapshot rail starts each step at the latest of: the step's start plus
`stepMs`; the end of the step's motion, which lives in the other mixes, plus `restMs`; and the
server finishing the scene. Today anchors see only their own mix, so astv asks for the motion's
end by callback and rebuilds each mix by hand when its clock goes back.

## Decided

| Question | Answer |
|---|---|
| Shape | The mix clock moves out of `Mixer` into a **transport**. Every mix has one: `mix()` alone makes a private one, so a standalone mix runs the same code it does today. |
| Reaching a sibling mix | A query naming a `score` looks in every mix on the transport. A query naming none stays in its own mix, so two windows' bare names never meet. No new `Query` field. |
| A member's own clock calls | `sync`, `rebase`, `seek`, `ramp` and writing `rate` throw on a mix made with a shared transport. Reading `now`, `rate` and `tape` reads the transport's. |
| First cut | Clock, seek and tape, anchors, `announce`, `marks`, `project`, `inert`, and `coast`. Owners and spans holding voices in a sibling mix are a second spec. |
| Names | `transport` and `coast`, Mike's calls. |

Ruled out earlier: one mix over a wide kit (`probe` returns the wide pose for every subject, and
channel names must not collide); child mixes announcing their ends to the rail's mix (`marks` and
`project` cannot see an end ahead of time); mixes nested as voices (a text-run pose and a flight
pose never fold together).

## API

```ts
const t = transport({ history: { ms: 10_000, tape: createHistory } });
const orbs  = mix(FLIGHT, { transport: t, name: 'orbs' });
const runs3 = mix(ROWS,   { transport: t, name: 'runs:w3' });
const rail  = mix(STEP,   { transport: t, name: 'rail' });

orbs.cue({  patch: flight, score: 'step:12', tags: ['motion'] });
runs3.cue({ patch: run,    score: 'step:12', tags: ['motion'], freeze: 'both' });

rail.cue({ patch: step13, score: 'step:13', anchor: { start: { all: [
  { after: { score: 'step:12', name: 'hold' } },
  { of: { score: 'step:12', tag: 'motion', resolver: 'latest' }, mark: 'coast', by: restMs },
  { with: { score: 'step:12', name: 'built' } },
] } } });

t.announce('built', { score: 'step:12' });  // when the server answers
t.sync(now);                                 // once a frame, after the frame's cues
orbs.probe(id, out);                         // probing stays per mix
```

### `transport(opts)`

| Member | Meaning |
|---|---|
| `sync(timestamp)`, `rebase()` | As `Mix` has them today, for every member at once. |
| `rate`, `ramp(rate, over)` | The shared rate, multiplied into every voice in every member. |
| `seek(time)`, `now`, `tape` | As `Mix` has them today, across every member (see Seek). |
| `announce(name, opts)` | Puts a mark on a score. A named score is seen by every member. |
| `marks(from, to)` | Every member's marks and every announced mark, earliest first. |
| `project(time)` | Every member read at `time`; `.of(mix)` gives that mix's `Projection`. |
| `live`, `inert`, `onWake(fn)` | Any member live; every member inert; fires when any member stirs. |
| `drop(mix)` | Takes a member off: it is no longer synced and its recorded calls no longer replay. A seek back past the drop does not bring it back. |

`opts` takes `history: { ms, tape }`. A member's `MixOptions.history` keeps only
`every` and `inputs`. Giving it `ms` or `tape` throws: reach and tape are the transport's.

### `MixOptions`

`transport?: Transport` and `name?: string`. `name` is what `Marked.mix` reports and what errors
say. A mix joins at the transport's `now`, and has nothing before it.

### A member mix

Keeps `cue`, `blend`, `owns`, `span`, `probe`, `pull`, `atRest`, `voices`, `mute`, `drop`, `drain`
and `book`. Its `announce` puts the mark on the transport. Its `marks` lists its own voices'
marks plus announced marks it can see: named scores, and its own unnamed score. `project(time)` is
`t.project(time).of(this)`.

### `Marked`

Gains `mix: string | undefined`, the member's `name`. Voice ids are drawn from the transport, so
`Marked.voice` and the keys `book` uses stay unique across members.

## Score lookup

`timeOf` in `place.ts` today searches `mix.cued` and `mix.gone`. On a shared transport:

- **A query with `score` set** searches every member's voices and the transport's announced marks
  on that score. Resolvers (`last`, `first`, `next`, `earliest`, `latest`) order across members
  by voice id, which the transport hands out in cue order.
- **A query without `score`** searches its own mix, under its own owner, as today.
- **`checkPlacement`'s check for an anchor that waits on itself** follows named scores across
  members.

A pending voice's anchor is resolved again at every sync until it starts (measured on blits
`main`: a flight cued after the rail's step was placed moved the step's start from 500 to 1350).
Motion cued while a step waits is counted. Motion cued after the step has started is not.

**Order within a frame:** cue the frame's voices before `t.sync(now)`. In a test with a flight cued
at exactly the time a pending start resolves to, cue-then-sync held the step back (start moved to
800); sync-then-cue had already started it at 300. A cue after the sync is a cue after the step
started.

## The `coast` mark

`Mark` becomes `'start' | 'in' | 'coast' | 'out' | 'end'`. A voice **coasts** when its last pass
ends, for its latest-staggered subject: the moment `handle.played` resolves true.

| Voice | `coast` |
|---|---|
| Finite passes, no freeze | the same moment as `out`, unless an anchored `out` or a fade comes first |
| `freeze: 'after'` or `'both'` | where the hold on the last frame begins; `out` and `end` come only when it is faded |
| `loop: true` | none, so an anchor on it never answers |
| Faded before its last pass | none; `played` resolves false |

It is known once the start is fixed and the passes are finite, the condition `out` has today
(`markOf` in `marks.ts` already computes this time as `out` for a voice that does not freeze). So
`marks`, `project`, `book` and anchors see it ahead of time. It moves with the voice's and the
transport's rates like every other mark. No sugar form: anchors write `{ of, mark: 'coast' }`.

The rail needs it because astv freezes its text runs and progress clocks (`freeze: 'both'`), and a
frozen voice's `end` comes only when it is faded.

## Seek

The transport holds the one tape. Each recorded call carries the transport time and the member it
was made on.

**Back to `t`:** each member restores itself from its own history, as `back()` in `seek.ts` does
today: voices, controls, records, state copies and marks as they stood at `t`. The transport then
cuts its pace and its announced marks back to `t`.

**Forward:** the tape replays in time order across members, moving every member to each call's
time before making the call. A cross-mix anchor therefore resolves during replay as it did live.

**A host call while recorded calls lie ahead** starts a new branch for the whole transport, never
for one member, since the transport has one future. `tape.branches` and `tape.switchBranch` work as
they do today.

A member that joined after `t` has nothing from before it; its voices are parked until the tape
cues them again. `seek` throws for a time older than the transport's history reaches.

## Inside blits

The fields that make a mix's clock — `now`, `u`, `offset`, `last`, `born`, `rebasing`, `pace`,
`tape`, `replaying`, `announced`, the voice-id counter — move to a `Transport` class in a new
`transport.ts`. `Mixer` reads them through `this.transport`. `move`, `seek`, `tape`, `place`,
`marks`, `project` and `pace` change to match; `back()` splits into the part each member does and
the part the transport does.

A standalone `mix()` gets a private transport holding only itself, so the whole existing suite
runs through the new code and has to stay green unchanged. `Engine.create(kit, opts)` receives
`opts.transport`; an engine that cannot join one throws for it.

Breaking for consumers: `Mark` gains a value, so a `switch` over it that checks exhaustively stops
compiling; `Marked` gains `mix`. Nothing changes for a mix with no shared transport.

## Build order

1. **`coast`**, on a standalone mix. astv's rail can wait on frozen runs within one mix as soon as
   this ships.
2. **Private transport:** move the clock out of `Mixer` with no behavior change; the suite is the
   test.
3. **Shared transport:** members, the cross-member score lookup, `marks`/`project`/`inert`/`onWake`
   on the transport, one tape across members, `drop`.
4. `docs/schema.html` (a Transport section, `coast` in Marks), `docs/vocabulary.json` (both words),
   `CHANGELOG.md`, and the site's reference.

## Tests

- `coast` for each row of its table, with stagger, under a rate, read ahead by `marks` and
  `project`, and as an anchor target.
- A standalone mix behaves exactly as before: the existing suite, unchanged.
- An anchor in one member on a named score waits on a voice in another member, and on a mark
  announced on the transport.
- An unnamed-score anchor does not see a same-named voice in another member.
- Seek back across calls interleaved between two members, then play forward: every anchor
  resolves to the time it did live, and `marks` lists the same marks.
- A host call after a seek back branches the transport's tape; neither member replays the old
  future.
- A member's `sync`, `seek`, `rebase`, `ramp` and `rate` write throw.
- `inert` holds only while every member is inert, and `onWake` fires on a cue in any member.
- Cue before sync at the moment an anchored start resolves holds the start back.

## Later

- **Owners and spans across members:** an owner's handle from one mix holding voices cued in
  another. A second spec; the rail does not need it.
- **Submix:** members with the same kit folding into a parent as voices. Its members would share
  its transport, so nothing here is in its way.
- **`book` on the transport**, booking every member's marks against one clock.
