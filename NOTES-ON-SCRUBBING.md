# Scrubbing a stateful mix: what is left

**Status: partly built, plus an unbuilt draft.** Fixed-interval stepping (`stepMs`), closed-form
motion (`spring`, `glide`), copies of state, the history horizon, recorded input and reading back
(`mix.project`, `MixOptions.history`) are built, and the schema page's Score section describes them.
A mix-level rewind, below, is a draft from 2026-10-04, and history kept through weasel-history was
added to it on 2026-10-06 at weasel's request. None of it is built, and it waits on the decisions it
lists. Delete this file once every item is built or turned down, moving any decision
into `docs/schema.html` first.

**For:** whoever works on reading back next. **Answers:** whether and how the live mix can go back,
what reading at another time still gets wrong, and the measurement that started this.

## Proposed: rewind (draft, unbuilt)

**This is an unbuilt draft that reopens the 2026-10-01 decision** ("Decided against: moving the mix
itself back", which held that mix time is a reading, never a position). Nothing here is in `src/`.
Line references are to `8a1a940`. "(read)" marks a claim from reading the code, "(ran)" one checked
against a build of it.

### Two shapes

- **Rewind from history**: `mix.rewind(t)`. The mix restores itself to `t` from what `history`
  already keeps, and plays on from there.
- **Save and load**: `mix.save()` hands the host an opaque snapshot; `mix.load(snap)` puts it back.
  The host picks when to save and how many to keep, then re-does whatever it did after the save and
  syncs forward to `t`. This is how rollback netcode and video keyframes work. The mix keeps no
  history of its own.

| | Rewind from history | Save and load |
|---|---|---|
| Needs | `history` on the mix | nothing on the mix |
| How far back | `history.ms` | as far back as the host's oldest snapshot |
| What the host re-does afterward | nothing | every call it made after the save: cues, handle writes, `announce`, `mute`, `drop`, `spring.to`/`push`, `level.set`, host fields |
| Handles the host holds | valid for every voice alive at `t` | valid for voices alive at the save; a re-done cue makes a new handle |
| Exact without `stepMs` | no: state steps once across the gap from the nearest copy, as `project` does (`stepped`) | yes, if the host replays the same frames it showed |
| Exact with `stepMs` | yes, the grid lands where it did live (read: `tick`, `fold.ts`) | yes |
| Memory | one copy per stateful subject per `every`, within the horizon | whatever the host keeps |
| Cost on a frame that never rewinds | what `history` costs today | a check per record per probe while any snapshot is held (copy on write, below) |
| New code | a restore in place, built from `project`'s pieces | a copy-on-write layer, a motion-buffer copy, and the same restore |

**Recommendation: rewind from history.** The mix already records everything a rewind needs, so the
host re-does nothing and keeps no second log of its own calls. A host-kept log is a second record of
what the mix did, the same objection that turned down subject registration in the schema page.
Save and load wins only where the horizon or the cost of `history` is the problem, and it can be
added later as a pin on history: `save()` holds history from being pruned past that instant, and
`load` runs the same restore.

### History kept through weasel-history (requested 2026-10-06, unbuilt)

weasel's labkit trial clock seeks and plays backward. It wants an instrument whose state builds up
by running to be scrubbable by blits, with the client choosing where history lives (labkit would
keep it in the trial record). Mike wants this built on weasel-history (`@weasel-js/history`, in
`~/src/weasel/packages/history/src`), not a new interface. Where weasel-history falls short, the
fix goes into weasel-history, not into a parallel shape in blits. The package has no dependencies,
so blits can either match its types structurally or depend on it.

How it maps, read against weasel `cb5b75652` and blits `c441c66`:

| weasel-history | In a mix |
|---|---|
| `Op` with `apply(adapter)` / `invert()`, plus `name` and `args` for persisting | each host call: cue, handle writes, `spring.to`/`push`, `announce`, `mute`, `drop`, `level.set` |
| `createHistory(adapter, { now })` | `now: () => mix.now`, so entry timestamps are mix time |
| a push after an undo drops the redo stack and reports it through `onEvict` | rewind, then new input replaces the old future |
| `serialize()` / `restore()` as `(name, args)`, with `rebuildOp` | persisting; `rebuildOp` resolves voice ids back to voices through the mix |

What weasel-history added for this (weasel `ef2a1b43c`):

| Need | weasel-history |
|---|---|
| Seeking by time | `depthAt(t)`, then `goto(depthAt(t))`; a `goto` that doesn't move is silent, so calling it every frame is cheap |
| Time-based horizon | `prune(t)` evicts undo entries stamped before `t` through `onEvict`, and never touches redo |
| Timestamps that persist | `serialize()` writes `timestamp`; blits passes `coalesceWindowMs: 0` so a stamp stays the time of its one push |
| Replaying on time | `timestampAt(undoDepth())` is the next redo entry's stamp, without allocating; `redo()` once mix time reaches it |

Replaying on time has a catch on blits' side. A host call is stamped with the mix time of the sync
before it, and on a replay frames rarely land on those times. A `redo()` on the first frame past a
stamp would apply the call late. So a sync that crosses a stamp has to step to the stamp, redo, and
step on to the frame. Under `stepMs` the grid absorbs this. Without it, that is one more step per
replayed call. `depthAt` and `goto` both assume stamps never decrease in time order, which holds
while a push drops the redo stack and is open again under Decision 9.

Still open:

| Gap | Why | Where it gets fixed |
|---|---|---|
| State copies | a `History` holds ops, not state. blits copies per voice and subject, on a time cadence and only when a subject is probed (`remember`, `history.ts`), keyed by subject objects in a `WeakMap` | stays in blits. Copies are not per entry, so attaching them to entries does not fit. They are never persisted (Decision 8) |
| Reading back without moving | `project(t)` reads controls at `t` by binary search over each voice's control log (`voice.log`) and over `hostLog`, and never mutates the live mix. An op stack answers "what was in force at `t`" only by undoing to `t` | open: keep the per-voice logs as the index `project` reads and treat the `History` as the persisted record, which risks two records of one fact; or make `project` undo and redo against a throwaway adapter |

`apply` and `invert` themselves suit a mix. The inverse of each host call can be built when the
call is made: a control write inverts to the controls before it, `cue` inverts to retiring the voice,
and a retarget inverts to cutting the stretch. Ops have to name voices by id rather than by object,
so that `rebuildOp` can resolve them after `restore`. A voice that ends on its own, or a subject
faded out of one, is not a host call, so no op covers it. Both are restored from state, as the
table under "What the live mix holds" already does.

**Scrubbing replays; it never cuts (Decision 2, decided 2026-10-06).** Moving back and then
forward again replays what the host did after `t`, such as a participant's responses, and no amount
of scrubbing loses the recorded future. In weasel-history only a push drops the redo stack, and
`goto`, `undo` and `redo` never do. The rule therefore holds as long as a seek or scrub is never
recorded as an op.

**Decision 8: history lives only for the session; it does not survive a page reload (decided
2026-10-06).** Ops can hold voices by reference, so no `rebuildOp` and no voice ids are needed.
State copies stay as they are, keyed by subject objects and allowed to hold non-plain data. blits
never calls `serialize()` or `restore()`. A client may persist its own records, such as labkit's
trial record, but blits cannot scrub a mix rebuilt from them after a reload.

### Why a projection cannot just become the live mix

All read:

- A projection is a separate `Mixer` built with `history: undefined, lanes: false`
  (`project`, `mixer.ts`), holding new `Voice` objects from `Voice.copy` (`voice.ts`). Every handle the
  host holds closes over the original voice (`handle`, `hosts.ts`), so promoting the copy would
  orphan all of them.
- A projection's records are filled lazily, on each subject's first probe, from the live records
  (`Filled` in `voice.ts`, `recall` in `project.ts`). It never has a full set to promote, and its own docs say it
  is valid only until the next sync or cue.
- The copies are made `quiet` and send nothing, so they never settle `done` or `played` and never
  put an event in `drain`.

So a rewind has to restore the live objects in place. It reuses `project`'s pieces: the controls
lookup (`last(log, t, e => e.sync)`), the state picker at the end of `project` (`project.ts`),
`recall` and `copyHeld` for records, and the announced-mark filter.

**Subjects cannot be listed** (read): per-subject records live in a `Store`, a `WeakMap` for object
subjects (`store.ts:12`), and lanes hold subjects only by `WeakRef`. So neither shape can restore or
copy every record at once. A rewind bumps an epoch, and each record is replaced from `recall` the
first time it is touched afterward. Save and load has the same problem the other way round: a record
must be copied into the snapshot the first time it is touched after `save`, which is copy on write.

### The API

```ts
/** Moves the mix back to `timestamp`. Throws where reading back there would. */
rewind(timestamp: number): void;
```

It returns nothing; a host wanting to know how sure the result will be asks `project(t).assess`
first. One-syllable alternatives: `back`, `wind`, `roll`, `jump`. For the other shape: `save`/`load`,
`snap`/`load`, `take`/`put`.

| Method | After `rewind(t)` |
|---|---|
| `project(t')` | reads the rewound mix; a read ahead of `t` plays what is cued from `t` on |
| `sync(h)` | the host keeps passing its own clock; the mix reads `t` plus the host's gap since its last sync (below) |
| `rebase()` | still takes the next gap out, and composes with a rewind, since both only move the offset |

### What the live mix holds after `rewind(t)`

| Part | After the rewind | How |
|---|---|---|
| Voice controls (rate, ramp, weight, fade, seeks, anchored start and out) | as they stood at `t`; later writes are kept and apply again as mix time reaches them | the control log `history` keeps, read at `t` |
| Patch and signal state | the nearest copy at or before `t`, stepped to `t`; fresh state from the voice's start where none was kept | `recall`, `copyHeld`, per subject on first touch |
| Motion patches (`spring`, `glide`, `tween`) | the stretch in force at `t`; later retargets and pushes apply again at their times | new: reading `Motions` at a time, from the earlier stretches it already keeps (`older`, `motion.ts:265`) |
| Voices cued after `t` | out of the mix until mix time reaches their cue again, then back on their original handles | new: a voice parked until its start; `done`/`played` per Decision 4 |
| Voices retired after `t` | back, on their original handles, at the controls they had at `t` | `gone` holds them; re-index, re-hook motion (`retire` unhooks it, `fade.ts`) |
| Subjects faded out of a voice after `t`, or `drop`ped after `t` | back as never seen: their records were forgotten | the gap the schema page's Open section already names |
| Lanes and crowds | thrown away and qualified again on the next probe | a fresh `Lanes`, chains relinked; the first frame after pays a full qualify |
| Undrained events stamped after `t` | discarded | filter `sent` |
| Events already drained | stay with the host; playing on past those times may send them again (decision below) | |
| Announced marks | those announced by `t` | the same filter `project` uses (`a.made < t`) |
| History after `t` | kept: it is the recording that plays again (Decision 9 asks whether a new host call drops it) | |
| `from: 'current'` poses | discarded; a retarget read from them reads as `held` | clear the pose store |
| `level` signals and host fields | the host's own; the mix does not set them | |

### The next sync

The mix clock is the host's reading less an offset (`sync`, `mixer.ts`). A rewind adds the
distance it went back to that offset and moves the mix to `t` at once, so a probe straight after it
reads `t`. The host goes on passing its own monotonic clock, and the next `sync(h)` reads
`t + (h − last h)`. `rebase` works the same way, so the two compose.

### Limits

| Case | Rewind from history | Save and load |
|---|---|---|
| `t` past `history.ms` | throws, as `project` does | no limit but the host's snapshots |
| mix without `history` | throws | works |
| `stepMs` set | exact | exact |
| `stepMs` unset | `stepped`: one step across the gap from the nearest copy | exact only if the host replays every frame |

### Save and load, in detail

- **In a snapshot:** the mix clock, offset and announced marks; each voice's controls and state;
  every record, copied on its first touch after the save; each motion patch's flat buffers (`runs`,
  `pending`, `older`), which can be copied whole since `Motions` numbers its subjects. Not lanes,
  which are rebuilt.
- **Copying state:** `copyHeld` (`history.ts`) uses `patch.clone` where given, else `clone`, a
  fast path for plain objects two deep that falls back to `structuredClone`. The schema page measured
  a projection's first probe at about 3 ms for 1000 subjects under three voices.
- **Exactness:** under `stepMs` the grid restores with the record (`since`, `ticks`). Without it, a
  `step` handed the frame's gap answers differently at a different spacing (the table under The
  measurement), so only a frame-for-frame replay matches.
- **Re-done cues** get new ids and new handles. Restoring the id counter would hand an old handle's id
  to a new voice.
- **Releasing:** the mix copies on write while any snapshot is held, so it has to learn when the host
  lets one go, through an explicit `free` or a `FinalizationRegistry`.

### Decisions

1. **Which shape: does the mix go back by itself, from the history it keeps, or does the host save
   snapshots and re-do its own calls after loading one?** Turns on whether a host has to keep a log
   of its own calls, whether rewinding needs `history`, and how far back it can reach. Recommended:
   the mix goes back by itself.
2. **After going back, does what happened after `t` vanish, or play again as it was recorded?**
   Vanishing is undo: the future is cut and the mix plays on fresh. Playing again is a tape: voices
   cued after `t` come back at their times, retargets replay. A tape makes mix time a position,
   which is the 2026-09-27 decision overturned rather than bent. **Decided 2026-10-06: play again.**
   Mike: "we can't have a situation where just scrubbing cuts off a branch of redo history."
3. **When the mix plays past a time again, does it send the events it already sent there?** The host
   drained them once, so sending again duplicates them; not sending means a patch's `send` is no
   longer a record of what played. Recommended: send again, and say so on `rewind`, since the host
   knows it rewound.
4. **When a voice that had finished comes back, do `done` and `played` start over?** They already
   resolved and cannot un-resolve. Starting over gives a later `await` a fresh promise; anyone already
   awaiting saw the old one resolve. Recommended: start over.
5. **Do `rewind(t)` and `project(t)` take the host's clock or the mix clock?** Host time is what a host
   has, but once a rewind or a `rebase` has moved the offset, one host time no longer names one
   moment (see Found while drafting). Recommended: host time, with the mix keeping a log of offsets
   so each host time maps to exactly one mix time.
6. **Should `sync` with an earlier timestamp throw once `rewind` exists?** Today it is accepted and
   half works (below). Recommended: throw, and point at `rewind`.
7. **Without `stepMs`, does a rewind step once across the gap or replay each recorded frame?**
   Replaying is exact but needs a log of sync timestamps and costs a frame's work per frame replayed.
   Recommended: step once and report `stepped`, as `project` does.
8. **Does history have to survive a page reload?** **Decided 2026-10-06: no,** session only; see
   the weasel-history section above.
9. **Does a host call made while the mix is rewound drop the recorded future after it, join it, or
   branch?** **Decided 2026-10-06: branch,** with weasel-history's `branching: true` (weasel
   `d1d12e741`). The displaced future becomes a sibling that `branches()` lists and
   `switchBranch(id)` restores. State copies stamped after the fork are dropped at the fork, not
   tagged per branch, so memory stays bounded by the horizon. Forking and switching back at the fork
   cost nothing, since both futures share the state there. A later jump forward on a revived branch
   steps from the fork, as a first jump into unplayed time does: exact under `stepMs`, `stepped`
   without it. blits' own logs (voice controls, recorded inputs, host fields, motion stretches)
   would each have to follow the current branch, which favors reading the past from the `History`
   over keeping them beside it (the "Reading back without moving" gap).

### Build plan

Sizes are estimates, not measurements.

| Step | Reuses | New |
|---|---|---|
| Restore controls and voice state at `t` | the control log, `project`'s state picker | moving the state picker into a function both call |
| Restore records lazily | `recall`, `copyHeld` | an epoch on the mix and a check where a record is fetched |
| Bring back voices that left after `t`, park those cued after | `gone`, `retire`, `index` | un-retiring: re-hook motion, reset `done`/`played`; parking until the cue comes due |
| Read motion stretches at `t` | `older` | a lookup per subject in `Motions` by time |
| Replay host calls after `t` as mix time reaches them; drop undrained events after `t` | the control log, recorded inputs, host fields | a cursor per list, advanced on sync |
| Lanes | `Lanes` construction | none beyond discarding it |
| Offset log, refusing a backward `sync` | | both |
| Tests | the read-back suite's "equals the pose the mix showed under `stepMs`" | the same against `rewind`, and handles held across it |

Largest risk: every place that caches per-subject state outside a record (`pulled` heads, lane
slots, `strays`) has to be cleared too, or a rewind shows a stale value.

### Found while drafting

- **`sync` going backward is not refused** (ran). The schema page and `Mix.sync` say the reading only
  goes forward, but `sync` takes any timestamp (`sync`, `mixer.ts`). Stateless voices move back; a
  stateful patch without `stepMs` is handed a negative `dt`: a `step` that adds `dt` saw `[300, -200]`
  for syncs at 0, 300 and 100. Under `stepMs` state holds still until the clock passes where it was.
- **`project` across a `rebase` misreads host times** (ran). It converts with today's offset
  (`project.ts`), so a host time from before a rebase reads at the wrong moment. A 1000 ms loop
  rising 0 to 100, synced at 0 and 200, rebased, then synced at 10200: live reads 20; `project(200)`
  reads 0, where the host saw 20.

## Left to build

1. **`handle.seek` on a stateful voice.** Seek moves the voice clock and leaves state where it was,
   so a stepped patch carries state from the old position to the new one. Measured against
   `ec5c6f6`: the spring below, played to 300 ms at 60 fps and then `seek(0)`, reads
   `x = 111.165` on the next frame, where a fresh voice reads about 0. With history the mix could
   restore the copy nearest the new position, the same way a read back does; without it, the
   proposal was to reset state and say so on the handle. Not decided.

## The measurement

`step` handed the frame's gap gives a different answer at a different frame rate, which is why
`stepMs` exists. A spring from 0 toward 100, written as semi-implicit Euler in `step` (stiffness
180, damping 12), read at 300 ms against `ec5c6f6`:

| Frame rate | `x` at 300 ms |
|---:|---:|
| 144 fps | 116.916 |
| 120 fps | 116.384 |
|  60 fps | 114.089 |
|  30 fps | 108.951 |

`test/frame.test.ts` keeps the same integrator. To reproduce, compile `src/` to a scratch directory
(`npx tsc -p tsconfig.json --outDir <dir> --tsBuildInfoFile <dir>/.tsbi`) and run from there:

```js
import { kit, mix, sum, patch } from './index.js';
const spring = patch(0, (_ph, _s, st) => ({ x: st.state.x }), {
  writes: ['x'],
  state: () => ({ x: 0, v: 0 }),
  step: (s, dt) => { const h = dt / 1000; s.v += (180 * (100 - s.x) - 12 * s.v) * h; s.x += s.v * h; },
});
function at(frameMs, until) {
  const m = mix(kit({ x: sum() })); m.cue({ patch: spring, start: 0 });
  const subj = {}; let x;
  for (let t = 0; t <= until + 1e-9; t += frameMs) { m.sync(t); x = m.probe(subj).x; }
  return x;
}
for (const ms of [1000 / 144, 1000 / 120, 1000 / 60, 1000 / 30])
  console.log(`${(1000 / ms).toFixed(0).padStart(3)} fps  x at 300 ms = ${at(ms, 300).toFixed(3).padStart(8)}`);
const m = mix(kit({ x: sum() })); const h = m.cue({ patch: spring, start: 0 }); const s = {};
for (let t = 0; t <= 300; t += 1000 / 60) { m.sync(t); m.probe(s); }
h.seek(0); m.sync(320);
console.log(`after seek(0): x = ${m.probe(s).x.toFixed(3)}`);
```
