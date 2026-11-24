# blits TODO

What is still open in blits and its companions, for whoever picks the work up. Shipped work is in
`CHANGELOG.md`; the design and the calls behind it are in `docs/schema.html` ("Chosen while
building", "Decided against", "Open") and `docs/decisions.md`. How to measure, and what was tried
and backed out, is in `bench/README.md`; raw runs are in `bench/runs/`, named by date.

When work merges, retire its entry here in the same change.

Owner tags:
- **[agent]** — an agent can take it alone
- **[maintainer]** — needs a call from the owner first
- **[waiting]** — nothing to do until something outside happens

---

## Engine

- **[maintainer] A read ahead cannot see a resting frame it skips** (2026-11-23, replay fuzz
  program 98): `fade({ at: 'rest' })` takes a subject out at the first frame its delta equals rest,
  and a looping keys patch rests at each pass start, so play takes it out only where a frame lands
  exactly there. A read ahead past that frame reads at known events and the time read, never at
  the frame, so it still shows the voice. Matching play needs the frames it will play, which a read
  ahead does not know; decide whether a read ahead should treat every pass start as a frame, or
  whether this stays a stated limit of the fuzz.
- **[agent] A motion `set` never shows while rate 0 holds the clock, though a seek there shows
  it** (2026-11-23, replay fuzz programs 364, 470, 639, 783, 809, 824 and 918): a
  probe keeps the delta it read at the mix's time (`held.probed === now` in `contribution`, and a
  lane's `settle`), which `signals.test`'s "set between two probes of one frame" pins within a
  frame. Under rate 0 every later frame stands at that time too, so a spring `set` while held
  shows its old place until the clock moves, and `project(now)` and a seek to a later frame there
  show the new one. One route: let go of the record's delta for the changed subject at the next
  frame, a sync rate 0 holds included, not at once; a set made before anything read that frame
  shows in it. Making it show at once (tried and backed out, 2026-11-23) breaks the within-frame
  rule.
- **[agent] A seek holds back events a put-back record sends after the moment sought, stamped at
  or before it** (2026-11-23, replay fuzz programs 553, 737, 754, 888 and 986): a
  record a seek put back stays in `mix.resent` for good, and `heldTo` drops every event its steps
  stamp at or before `sentTo`, taking them for ones sent the first time. A voice turned to run
  back (handle `rate = -1`), a handle `ramp`, or a `rise` after a fade at rest makes a later step
  stamp a time before the moment sought, which play sent and the seek's replay drops. One route:
  hold back only up to where the record had stepped by the moment sought, and take it out of
  `resent` once it steps past there.
- **[agent] A read ahead across a cue joining a span reads its children off** (2026-11-23, replay
  fuzz program 463): a span (`duration: 600`, `order: 'together'`) holds a staggered `turn` child,
  and a second child is cued at frame 10 anchored after the first by −20. Sought back to frame 9,
  a read ahead to frame 10's time reads the angles 7–18° off what play showed, though playing
  on from that seek matches. One route: compare the copies' refit at the cue with the live mix's, step by step.
- **[agent] A seek past memory with a store loses a voice cued while rate 0 held the clock**
  (2026-11-23, replay fuzz program 964, store only): a `pick` voice of a role, `rate: 0`,
  `freeze: 'both'`, is cued at frame 6 in the frame the mix's rate goes to 0, and frame 7 ramps
  the rate to 2. After `prepare` and a seek back to frame 2, replaying to frame 8 shows nothing
  of it where play showed it; without a store, or without either rate call, it matches. One
  route: diff the pace and frames `unpage` puts back against what the run held at frame 2.
- **[agent] A seek back does not put back a rest-less channel's band state** (2026-11-23,
  reproduced): under a band of the host's own, `{ on: 0.6, off: 0.4 }`, a `last()` channel whose
  weight goes 1, then 0.5 (still shown), then 0, then 0.5 again (not shown) still shows nothing
  after a `seek` back into the first stretch at 0.5. A record keeps only its latest band state,
  which `restore` (`src/seek.ts`) leaves as the live record has it, and a role keeps its own on the
  chain head (`head.roles`), which a seek drops, so the role decides as if met afresh. Under the
  stock band nothing holds between on and off, so no default mix shows it. One route: under
  history, log each record's band changes by time as `inputs` are, a role's on its first member's
  record, put back the state as of the time sought, and page the log with the record.
- **[agent] A seek back within memory may miss an announced mark a later one displaced as an end**
  (2026-11-23, reasoned, not reproduced): with a store, memory keeps only the ends of the marks it
  has paged (`endMarks` in `src/paging.ts`) and lets go of one once another takes its place. A mark
  announced already behind memory displaces one at the next sync, so a seek back within memory to
  before it was announced finds neither, and an anchor cued after that seek picks wrongly. One
  route: raise the transport's `floor` to the displacing mark's frame, so such a seek loads.
- **[agent] A retarget's departure speed across the wrap on an angle channel blits did not make**
  (2026-11-23): `slopeFor` takes the short way only on a channel vouched with a `turn`. A
  `{ ...angle(), lerp }` copy wraps its pose through the copied `scale`, so a subject crossing
  180° just before a `from: 'current'` takeover reads a speed of about −360° per frame, and the
  voice swings the long way (rotation.test's takeover from 153° on such a channel). One route:
  read the speed through the channel's own lerp, which knows the short way.
- **[agent] A seek back makes an untimed retarget or push replay at the wrong time** (2026-11-23,
  reproduced, lanes on and off): a change made before any frame met its subject waits for the
  subject's first read (`change` in `src/changes.ts`). A seek back to before that first read keeps
  the voice's record for the subject, with `probed` NaN, and `frameOf` (`src/strays.ts`) reads
  any record as met, so the tape's replay of the change, and a read ahead of it, stamp it at its
  own frame instead. A spring cued at 0, `push(a, 300)` at 32 with `a` first probed at 64 (history
  with a tape, `stepMs: 4`), then `seek(16)`: play shows 20.389 at 64, a read ahead 19.148 and the
  replay 19.148. Met at or before the moment sought, all three agree. The replay and the read
  ahead also differ from each other by about 1e-5 in that case. One route: a seek back drops, or
  marks unmet, a record its voice first met after the moment sought.
- **[agent] A motion voice sought back into a subject's stagger may go `inert` before the subject
  is read again** (2026-11-23, unconfirmed whether it is a bug): after a handle `seek` sends a
  record back before its start, `inert` reads true about 12 ms after the delay runs out, though no
  probe has read the subject since; the record still showed `since` 100 and `probed` 1600. It
  behaves the same on main before the 2026-11-23 inert fix. Decide what `inert` should say there,
  then test it beside "goes inert past the stagger" in `test/motion-edges.test.ts`.
- **[maintainer] A probe of one role's blend alone** (2026-11-23), for rapier's hand-back: a held
  body is placed at its whole shown pose, so voices outside `sim.role` count twice once physics
  takes it back (`packages/rapier/README.md` says so, and a test pins it). Placing it at the role's
  blend needs a public read of one role, such as `probe(subject, out, { role })`; a public
  addition, so it ships in a minor.
- **[maintainer] A child still to start under an owner whose clock runs back: wait, or leave?**
  (2026-11-23) Today it waits, so an owner sought forward later still plays it
  (`test/place-edges.test.ts`, "a child cued into a span running back plays when the span is sought
  into it"), but the owner and mix then stay live for good and `inert` never reads true, though
  `marks` lists both as ended and `docs/schema.html` says the owner "leaves with its last child".
  Leaving fixes the sleep and loses the later seek. Reverted try: `b67c2209` (left where the
  owner's clock reached 0, once the owner had started). A middle way: leave, and let an owner
  seek or rate write that brings its clock back past the child's start revive it.
- **[maintainer] Public renames the 2026-11-09 audit asked about:** `timestamp` on mix-clock
  fields (`Setting`, `Sent`, `Projection`); `Mix.played` (a number) beside `Handle.played` (a
  Promise); glide's `ms` (a time constant) beside tween's (a duration); `lag`'s `floor` beside the
  motions' `settle`; `SpanSpec.share` beside the `share` signal; `SpanSpec.priority` meaning two
  things on a nested span; `blendMode()` returning CSS names; `Ticker.now()` a method where every
  other `now` is a property; `Ticker.hold()` returning a function where `Watched.hold()` returns a
  `Hold`; the teardown verbs (tone's `cancel`, the panel's `dispose`, quarks' driver with none);
  rapier's `Body.drop`/`Body.drive` against quarks' and tone's; the panel's `Source` and `wire`
  colliding with quarks'.
- **[maintainer] A staggered subject that finished its passes: does it show its last frame while
  its voice waits for the others?** Forward it does (staggers 0 and 200 on a 100 ms pass show the
  first subject's last frame from 100 to 300); backward the mirror case shows nothing ("waits for a
  subject staggered ahead of it" in `test/backward.test.ts`). Either hold both ways, or show
  nothing both ways, which would snap each subject of a staggered entrance back as it finishes.
- **[waiting] `plot(subjects, xy, cell)`, `cell` as a third argument, stays deprecated until a
  major release made for other reasons** (no 2.0.0 for it alone, 2026-11-21). The removal then:
  the overload in `src/types/mix.ts`, the warning in `src/plot.ts` (a number there throws instead),
  its test in `test/plot-axes.test.ts`, the line in `docs/schema.html`, and `{ cell }` in
  `bench/frame.mjs`, `bench/recaddr.mjs` and `bench/plotleak.mjs`.
- **[maintainer] A ticker has no single teardown** (filed 2026-11-15 from automated review).
  `ticker()` (`src/ticker.ts`) gives a remover per `add`, `after` and `hold`, and `stop()` only
  cancels the waiting frame: every mix's `onWake` subscription stays, so a mix waking restarts the
  loop. A component that unmounts has to collect every remover itself. And `add` of a mix already
  held shares the one registration, so either caller's remover takes it away from both. Wanted: an
  idempotent `dispose()` that cancels the frame and drops every subscription, or a scoped owner
  that collects removers, and a call on whether a second `add` counts. Either is a public addition,
  so it ships in a minor.

- **[agent] Unconfirmed suspicions from the 2026-11-24 review pass**, each read from the code, not
  reproduced; confirm with a failing test before fixing, and drop the line if it does not fail.
  - `wave` takes `cycles` of `NaN` or `±Infinity`, or a `depth` key set to `undefined`, and writes
    NaN rather than refusing at cue; `glide` takes bounds with min above max.
  - A pending voice cued backward and then given `rate = 1` keeps `anchorElapsed` at its end and
    `beginless` as fixed at cue, so it may end at once; the docs do not say which is meant.
  - `unpackHeld` (`src/pack.ts`) puts a packed record's `kept` array and `state` into the live
    record uncopied, and `setting.keep` empties `unkept` with `shift()`, so two revives from one
    descriptor object may share the first's changes.
  - The `Along` store (`src/store.ts`) may lose a delete once a later copy sets that key again, so
    an earlier copy asked afterwards rebuilds the record from the live mix.

## Speed

Measure every change on the fleet before the next starts; `bench/README.md` has the method.

- **[agent] `redo` at 1,000 subjects and 32 voices: an audit slowdown that did not reproduce.**
  Three runs read the end of the 2026-11-09 audit (`41628a3b`) slower than its base (`efc4950`):
  +4.8%, +2.4% and +3.7% (`bench/runs/2026-11-11-audit-redo-quiet.txt`). Three later solo runs did
  not: +1.5% on keiei, −1.5% on studio, −0.6% on teitou
  (`bench/runs/2026-11-11-redo-bisect-*.txt`, 2026-11-12). Each audit branch tip alone, and each
  merge on main, read within spread of the base, so no commit carries it. Any real effect is under
  about 2%, less than one build's run-to-run spread on this row (7–11 ms). Reopen only if a new
  run reads it above 3% again.
- **[agent] A host probing into its own object under `retargets: true`** keeps two poses a
  subject in `Probes` (`src/trail.ts`), costing a 10,000-subject probe frame 8–22%, about 14 ns a
  probe: `keys` 1.033 against 1.172 ms, `tweens` 0.608 against 0.745 (measured: teitou, 7 rounds,
  `RETARGETS=1`, `bench/runs/2026-11-21-probes-retargets-after.txt`; 18–57% before the per-kit
  noter). What is left is finding the row and turning its halves over; no hot spot (inferred).
- **[agent] Steady `tweens^`/`weasel^` frame** (10k one-voice-per-subject tweens by `pull`, and
  one tween voice over 10k subjects): 0.225 and 0.236 ms on msb-uai in flight, 0.175 for `tweens^`
  landed, against 0.03–0.05 for a hand loop (measured, 2026-11-21, `FRAMES=5000`,
  `runs/2026-11-21-steady-tweens-retime.txt`), from 0.271, 0.297 and 0.203 by folding a bare tween's
  sum inline and weighing a lane flat once every fade in is over. What is left, from profiles before
  that change (`runs/2026-11-21-steady-tweens-prof{,-inflight}/`, measured): `bareRows` 45% of
  `tweens^` in flight, of it about a fifth the fold line; `pullRun` 17–21%, spread over its
  per-subject checks and stamps, which `bench/README.md` lists as tried; `Trail.record` 6%, copying
  the list and every column for a retarget that may never come; `runMotion` 49% of `weasel^`, no line
  over 8%. The other `foldNumber` call sites were taken up the same day (`foldAxes`, and
  `foldNumber` written out): `keys^` 18% faster (U 0), `springs^` 7% (U 2), `frozen^` 18% (U 5, at
  the edge of p < 0.05 for 6 rounds); `keyses^`, `role`, `keys-` 3–11% but within spread, and
  `tweens^`, `weasel^`, `fn^` unmoved (teitou, 6 rounds, `runs/2026-11-21-fold-sites.txt`).
- **[agent] A voice over every subject cued among a crowd** (`swap`, 1.97 ms on msb-uai,
  2026-11-21). Measured, a profile's share of the probe loop (`runs/2026-11-21-swap-lines.txt`):
  the fill's `one`/`call` 28%, the bench's own patch among it 8%; the chain lookup and relink 25%,
  of which the `chains` WeakMap 6% and `sight` 4%; placing every subject on the new voice's lane 5%;
  `meet` 6%; the fold 10%, its copy out 3%. A host's `{}` out costs 5% over `mix.pose()` (studio,
  `runs/2026-11-21-swap-baseline.txt`), a host's cost. No one part leads, and each left is 1–3%
  a line, under the row's run-to-run spread (inferred from the profile, not timed apart).
- **[agent] A role costs about 20% over its voices played apart, a blend about 33%** (teitou,
  2026-10-26). Both bench rows already run inline (`runRole`). A profile of `fn:10000:3`, `role`,
  `signal` and `blend` (msb-uai, 2026-11-21, 3 runs each, `bench/runs/2026-11-21-role-prof.txt`)
  puts the role's extra time in gathering and folding (`runRole`, `gatherScalar`, `meetRole`,
  `foldAt`, together about 19% of its samples) and in more samples landing in the patch itself
  (22% against 18%; why is not found). A blend costs what `signal` does: its extra over three
  plain voices is the signal (`by`, `signalled`, `base`), which the host writes. Running inline past
  a member yet to start was backed out (bench/README.md), and clearing `taken` once and dropping
  `meetRole` from the inline route had been (2026-10-26).
- **[agent] Starting 10k one-subject tweens** takes a 28–31 ms first frame against 12–12.5 for fn
  voices (msb-uai, 2026-11-21, three processes of `node bench/start.mjs 10000 9 tweens fns`,
  `bench/runs/2026-11-21-row-alloc-start.txt`), and no one cost leads. The first frame allocates
  34 MB against 17. What tweens spend that fns don't, in a round's profile (teitou, 2026-11-21,
  `runs/2026-11-21-row-alloc-start-tree.txt`): rebuilding the crowd (`regroup` 3.1 ms, of it
  `join` 2.4) and `requalify`'s own share of it, the general path's first sample of each subject
  (`moved` 2.7 against 1.3 for fns' `contribution`, of it `Motions.fresh` 0.9), and collection
  5.0 against 3.2. Allocation that dies young is not the lever, measured three ways: cutting
  `join`'s and `regroup`'s, a 64 MB young generation (`runs/2026-11-12-tween-start-semispace.txt`),
  and writing the first stretch straight into its run with no stretch object (31.8 against 31.7 ms,
  `runs/2026-11-21-row-alloc-fresh-direct-ab.txt`; its bytes only moved to `moved`). Left: the
  rebuild's work itself, and what survives per row (crowd arrays, `Seat`, the `seats` entry),
  which a scavenge copies; the second is inferred, not measured. `Voice`'s boxed doubles are made
  at cue, outside this frame.
- **[agent] Cueing a staggered voice naming 1M subjects takes 35 ms on the stock mixer, 41 on
  the gpu engine** (teitou, Chromium, 60 cues a row, `bench/runs/2026-11-21-named-places.txt`,
  2026-11-21), and about 80 in node (`bench/cue-wide.mjs`). Nearly all of it is `Named` building
  its map of places, with collection after: the "rest of `cue`, inlined" a third earlier read off
  a profile was one sample carrying the profiler's start-up (`bench/README.md`, Traps; measured).
  The map is what finds two subjects named twice, so a cue cannot skip it for a list it has not
  seen. A later voice of the mix naming an equal list shares it since 2026-11-21: three such cues
  on one mix, as gpu-reach's `MIX=owned` makes, take 5.7 ms for each after the first, from 126
  (orochi, shared, `bench/runs/2026-11-21-cue-wide-share-ab.txt`, measured). A Set builds no
  faster and the stagger calls are 1.4 ms (`runs/2026-11-21-cue-wide-places.txt`). Left: the
  first such cue, and a list named for the first time in a mix. The gpu row is not re-timed;
  nothing it runs changed. The frame after such a cue costs 30 times the cue (next entry).
- **[agent] The first frame after one voice of 1M subjects takes 1.15 s, after three 1.9–2.3 s**
  (teitou, quiet, node, `CUES=1|3 FIRST=1 bench/cue-wide.mjs`: a sync and a probe of every
  subject, `bench/runs/2026-11-22-cue-wide-numbers-ab.txt`, 2026-11-22). It is mostly per subject,
  not per voice, and linear from 100k up (`runs/2026-11-22-cue-wide-first-scale.txt`). The profile
  (`runs/2026-11-22-cue-wide-first-prof-tree/`) puts it in holding each subject weakly in many
  places at once: the lanes numbering it (`Numbers.take`, a `WeakRef` and a registry cell, 16%),
  a voice's `subjects` WeakMap (11%), `Filed`'s list entry, the chain store, plus the long group's
  `has` and collection (9%). A cell's unregister token cost 0.17 µs a subject and was dropped on
  2026-11-22 (1.35 s to 1.15 at one voice, measured). A `WeakRef` alone costs 0.12 µs and a WeakMap
  entry 0.06 (`runs/2026-11-22-weakcost.txt`, measured). `Filed`'s `seen` entry left the first read
  on 2026-11-22: the count is read off the subject's list, 164 to 148 ms at 200k subjects (teitou,
  12 rounds, U 29 of 144, `runs/2026-11-22-filed-seen-ab.txt`). `bench/firstmaps.mjs` counts what a
  first read enters. Left: the `WeakRef` and cell, which find a subject by its number; a voice's
  `subjects` entry, one per voice, which finding records through the subject's chain could replace
  (not tried); the chain store and `Filed`'s list.
- **[agent] A stop grows with N** (0.52 µs at 1,000 subjects, 1.46 at 10,000, 2.41 at 40,000;
  msb-uai, 2026-11-21, `bench/runs/2026-11-21-row-alloc-restart.txt`) though nothing walks more.
  Every part of it grows (`bench/stopparts.mjs`, `runs/2026-11-21-row-alloc-stopparts.txt`;
  `bench/stopprof.sh`, `runs/2026-11-21-row-alloc-stopprof.txt`), and so does the bench's own
  two-array swap-remove, so the growth is read as cold memory (inferred). Counted with
  `bench/stopmaps.mjs` (`runs/2026-11-21-stop-maps-count.txt`, measured): a stop touches three maps
  holding an entry per subject or voice, `chains`, `named`'s lists and the lanes' `seats`, and a
  steady frame none. `lastPoses`, `restStamps` and `strays` are empty in this shape, so folding them
  into `chains` would save it nothing. One or two more such maps cost a stop 0.3–0.45 µs at 40,000
  (teitou, 8 rounds, `runs/2026-11-21-stop-maps-extra.txt`; noisy, two read less than one). `seats` left the stop on 2026-11-21: a
  stop reads a crowd voice's seat off the voice, 2.765 against 3.040 µs at 40,000 (msb-uai,
  `--quiet` on a loaded node, 16 rounds, U 74.5 of 256, `runs/2026-11-21-stop-seat-ab3.txt`;
  2.825 against 3.035 on teitou, `-stop-seat-ab2.txt`); steady frames did not move
  (`-stop-seat-ab.txt`). Left: `named`'s list. Sharing one entry with the chain head was tried and backed out
  (2026-11-21): a stop at 40,000 read 7% less, but `churn` 19% and `tween-` 4% more, as every
  general-path probe reads the head through one more object (studio, `runs/2026-11-21-stop-kept-ab.txt`).
  Moving the list onto the head itself would avoid that load but has to follow the head through
  every relink (not tried). The fade's growth (0.36 to 1.03 µs) touches no map: it is
  the voice, its handle and its patch read cold (inferred).
- **[agent] A voice leaving the general path still requalifies every voice where a voice still
  present writes one of its channels, and so does a role member leaving a lane.** A requalify
  costs 1.4 to 2.9 ms at 10,000 crowded voices (`bench/requalify.mjs` `direct`, teitou, a shared
  node's spread). One ending alone on its channels has skipped it since 2026-11-21: a frame one
  ends reads 0.52 ms, from 3.74 (`bench/runs/2026-11-21-requalify-reorder-ab.txt`, measured).
  Where its channel stays written, a channel it closed may open, so skipping needs the remaining
  writers shown off lanes for reasons of their own. Not built.
- **[agent] While a voice naming no subjects and bounded by nothing plays off lanes, every subject
  reads one at a time.** A stateful one over 10,000 crowded tweens reads 1.56 ms a frame steady
  against 0.17 with none (teitou, shared, `bench/runs/2026-11-21-offlane-unnamed-prof.txt`,
  measured). The profile puts 41% of the frame in reading the voice itself (`contribution`, which
  any path pays) and most of the rest in the per-subject walk around it: `readAll`, `foldWith`'s
  copy and chain walk, `prepare`, `writeValue`. A path that wrote the laned columns in runs and
  folded only the off-lane voice's channels per subject could save part of that walk, under half a
  millisecond here (inferred from the profile, not built). Its cue and end frames cost 1.2–2.2 ms
  each, which looks like every subject's chain relinking (inferred, not profiled). Since
  2026-11-21 such a voice bounded by `within` or an `around` ball sends only the subjects within
  it, and those it left holding a weight, to the general path, and `atRest` reads every other
  subject from the lanes (`Lanes.alone`).
- **[agent] Churn under other reorderings.** `pull` renumbers a swapped-in subject into the freed
  number, and since 2026-11-21 leaves a list shifted up by `splice` as numbered (`reorder-splice`
  9.73 to 0.60 ms a frame at 10,000 subjects, measured). Left: that 0.60 against 0.18 in order is
  every subject after the gap missing the position `pull` remembered it at and read alone (inferred
  from `readAll`, not profiled since). A shuffled list reads 0.24 against 0.18 (measured); a free
  number cannot fix it, which needs numbers swapped between live subjects. Under history, roles or
  a bound `src/renumber.ts` still declines; extending it there needs tests proving each store it
  would carry.
- **[agent] Running back past a voice's end costs `own` and `keys` 1–3%** (`4a6cc4e`, accepted
  under the tuning bound, 2026-10-17).
- **[agent] A probe pays for every channel in the kit, written or not**; skipping unwritten ones
  needs the pose to stop promising rest in every channel.
- **[agent] Work nobody will see**: astv's `typing` shape (2% probed) spends 55% in the general
  path's fold; lanes do nothing for it, since astv's text runs write `last` over row objects.

## gpu engine

- **[agent] A channel a new stock kind or a staggered shader patch writes is null while its
  kernel compiles.** A compiled kernel stands in for everything else (`src/gpu/stand-in.ts`), and a
  shader patch playing at one time for every subject folds from its `at`; a staggered one would need
  each subject's time worked out on the CPU, and `at` sees no `lag`.
- **[agent] Lifting "it is parting from subjects"** needs the kernel told which subjects a voice
  faded out of, apart from `Answer.reach`.
- **[maintainer] Every subject count compiles a kernel of its own, and none is let go**
  (2026-11-23, read, not measured): `Kernels.choose` keys a kernel by the count, since each
  output's offset in the kernel is its axes times the count, and a stand-in must have the same
  count, so a host whose list grows a little each frame gets null channels until each new kernel
  compiles, while `built` and `compiledOnes` keep every one until `close()`. Taking offsets from
  `frame.y`, which already holds the count, would drop it from the key; or decide that a changing
  count is not a case the engine serves, and evict kernels of other counts.

- **[agent] Unconfirmed gpu suspicions from the 2026-11-24 review pass** (read, not reproduced):
  a subject listed twice in `subjects()` is indexed by its first place in `Answers` and its last in
  `numbering.ts`, so the earlier copy's motion row may go stale; a kernel that fails to compile
  gets no stand-in even where an older kernel could fold the frame; offsets and level codes are
  stored as raw bits in f32 buffers, so small ones are subnormal and a GPU that flushes subnormals
  on load would read 0 (teitou does not).

## Playground

The goal is to offer everything in blits it feasibly can (2026-10-09); the README lists what is
built and what is deliberately not offered.

- **[maintainer] Where a dot is beyond its grid place** (a per-subject position expression, a
  voice that moves the dot, or other). Decides whether `put` and author-written `within` signals
  are offered.
- **[maintainer] Recording level moves** as a composition field, so they save, share and undo.
- **[maintainer] A booker with its own clock, and link drags on group headers** — wanted or not.
- **[maintainer] The debug panel's hold ends at every playground rebuild**: an edit, or a seek
  back or lap by replay (2026-11-21). The Player closes its mixes and makes new ones with the same
  names; the panel's agent frees the hold as the held mix's `gone` arrives, and the panel shows it
  free while the score plays on at the transport's rate. Which mix the panel picks after is an accident
  of order: `pickOnly` picks whatever mix is alone on the page as the old ones close and the new
  ones register. Decide whether the agent carries the pick and the hold, at its rate, to a mix
  that replaces the held one under the same name. `apps/playground/test/panelHold.test.ts` pins
  today's behavior.
- **[waiting] Three unnamed mixes on the playground's debug panel come from weasel** (seen
  2026-11-21): their channels are `pose`, `alpha`, `path` and `data`, a weasel UI kit's, not the
  playground's. Weasel's own mixes need a name, or `close()`, to keep off a host's panel.

## Companions

- **[maintainer] blits-quarks: does `drive`'s `carry: 'float'` earn its place?** The exact
  default also matched magicsmoke byte for byte over 1,200 frames. magicsmoke links
  `file:../blits/packages/quarks` until a quarks release carries it; its typecheck, suite and bench
  have not run against the link.
- **[maintainer] blits-tone: should a spring, glide or fling settle at a time it names**, so
  `mix.trace` can bend them as it does fades instead of reading them on the grid?
- **[maintainer] `apps/fireworks` has never been listened to.** One bang peaks at 0.88 of full
  scale, so two at once may clip.
- **[waiting] `node-web-audio-api` frees a channel's samples under a live array**
  (ircam-ismm/node-web-audio-api issue 80); `packages/tone/test/render.ts` copies them until fixed.
- **[agent] blits-rapier: a kinematic goal's weight only switches it on or off**; crossfading
  goals needs a core channel that blends rest-less values. A seek's catch-up steps read a log the
  world keeps itself, which can go if blits ever replays recorded host input.
- **[maintainer] The DevTools extension** is not on the Chrome Web Store. Its `start.js` builds the
  registry and tape from its own bundled copies, so an engine changing either needs a rebuild or
  `watch/2`.

## Site and diagrams

- **[maintainer] light-board still schedules from the frame loop** (2026-11-21): "Run the show"
  cues each look as the frame loop finds fewer than two cued ahead (`while (running && ahead() < 2)
  next()` in `light-board.ts`), rather than from a voice. What is lit is read back from its voices
  (2026-11-23), so a panel seek back shows the right look; moving the cueing onto voices too is a
  redesign.
- **[maintainer] Two explainer files import from outside `site/src/explainers`** (2026-11-23):
  `hues.ts` takes `logoHues` from `@brand/hues.js`, and `kit/Timeline.tsx` takes the track drawing
  from `@pg/widgets/ScoreLanes/track`, though HANDOFF's Traps say explainer source may import only
  from under `site/src/explainers`. Both predate that line, nothing in the repo enforces it, and the
  site builds. Decide whether the rule still holds; if it does, one route is a lint rule
  (`noRestrictedImports` scoped to the folder) and moving the two shared pieces under it.
- **[maintainer] Should the built-on page's Libraries table list every consumer?** It names
  klieg, magicsmoke, weasel and agnew; the README's status names nine. Which are public decides it.
- **[maintainer] CI never runs `test:gpu`.** It needs real WebGPU, which GitHub's hosted runners
  don't have; it would take a self-hosted runner with a GPU. The other smoke tests run in
  `smoke.yml`.
- **[maintainer] Channel nodes shaped by their fold rule** (parked 2026-11-05). The outline is the
  region the rule sweeps: `sum` leans, `mul` and `min` lower the top, `max` raises the bottom,
  `last` narrows to a funnel. `node spikes/fold-shapes/shapes.mjs > shapes.svg` draws the sketch;
  the inner lines need weasel to take `detail` beside a `Path` outline.
- **[waiting] weasel gaps the site and playground work around** (rechecked on 1.18.0,
  2026-11-08): no per-row layout in labkit's `ControlPanel`, no accessible name apart from a leaf's
  label, `.clearable()` takes only a fixed placeholder, `DiagramView` never reports its first
  layout, no file picker, no editable code pane, no `aria-expanded` on `Button`, the `Transport`
  loop switch drawn as a `⟲` character.
