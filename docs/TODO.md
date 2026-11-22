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
- **[agent] Heatmap `pull` reads 20–33% slower with lanes than without** (5,000 retargeted
  springs and three `ink` voices weighted by `input` signals: 5.2 against 3.9 ms on studio,
  `bench/runs/2026-11-12-heatmap-signal-fold-ab.txt`; 3.71 against 3.09 on msb-uai,
  `bench/runs/2026-11-21-heatmap-signal-split.txt`). Little of it is `one`'s signal branch, and
  nothing in that branch stalls. A per-load split on msb-uai (5 rounds, switches in
  `runs/2026-11-21-heatmap-signal-split.diff`, measured) put the whole branch at about 0.33 of
  3.86 ms, spread over its ordinary work: the signal call and replay check about 0.11, the
  `primeLaned` in `host.signal` about 0.15, `signalled`'s own entry about 0.07. Touching every
  record before the loop made it 0.09 ms slower, not faster (`runs/2026-11-21-heatmap-signal-split{,2}.txt`)
  (2026-11-21). The 14% the 2026-11-12 studio profile put on the `signalled` lines did not recur
  on msb-uai (1.2% on that line, 1.4% on the weight store), so it reads as where the profiler
  pinned inlined code, not a cost of its own (inferred). Const weights, which fold every band,
  still read 3.42 ms on lanes against 3.09 off (measured), so most of the gap is outside the
  signal. Next: split that remainder (`call`'s `host.ready` and `foldDelta`, `numbers` and
  `subject`, which lead the profile) on `spring/const/ink/on` against `off`. Profile with
  `bench/heatprof.sh`, not the stress demo, which plays a lanes twin.
- **[agent] A host probing into its own object under `retargets: true`** keeps two poses a
  subject in `Probes` (`src/trail.ts`), costing a 10,000-subject probe frame 8–22%, about 14 ns a
  probe: `keys` 1.033 against 1.172 ms, `tweens` 0.608 against 0.745 (measured: teitou, 7 rounds,
  `RETARGETS=1`, `bench/runs/2026-11-21-probes-retargets-after.txt`; 18–57% before the per-kit
  noter). What is left is finding the row and turning its halves over; no hot spot (inferred).
- **[agent] Steady `tweens^`/`weasel^` frame** (10k one-voice-per-subject tweens by `pull`): 0.235
  and 0.362 ms on studio against 0.03–0.05 for a hand loop. `tweens^` is 39% `bareRows`, 29%
  `pullRun` (about 1 ns a subject per check, none dominant); `weasel^` 58% `runMotion`.
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
  2026-11-21), down from 71 and 76 by `Named` keeping one map of places in place of a `Set` and a
  delay `Map`. Still two frames in one call. About half is `Named` (`src/named.ts`): its map of
  1M places and the stagger asked per subject. The rest of `cue`, inlined so the profile can't
  split it, is a third, and collection 7–13%. The gpu engine's share is about 5 ms: the level
  hash (4.1 ms in Chromium) and the codes buffer (0.15 ms). `bench/gpu-cue.mjs` times it.
- **[agent] A stop grows with N** (0.52 µs at 1,000 subjects, 1.46 at 10,000, 2.41 at 40,000;
  msb-uai, 2026-11-21, `bench/runs/2026-11-21-row-alloc-restart.txt`) though nothing walks more.
  Every part of it grows, none by much more than the rest (`bench/stopparts.mjs`,
  `runs/2026-11-21-row-alloc-stopparts.txt`; `bench/stopprof.sh`,
  `runs/2026-11-21-row-alloc-stopprof.txt`): the fade 0.36 to 1.03 µs, `Numbers.release` 0.33 to
  0.96, `Lanes.forget` 0.06 to 0.29, the map deletes in `drop` (`Store.delete`) 0.02 to 0.25. The
  bench's own swap-remove, which indexes two arrays and nothing else, grows 0.04 to 0.27 µs too, so
  the growth is cold memory, each distinct object and map a stop touches costing a miss (inferred
  from that, not counted). A lever would be fewer of them per subject, such as one record holding
  what `chains`, `lastPoses` and `restStamps` keep by subject in maps of their own. Not tried.
- **[agent] A voice leaving the general path still requalifies every voice where a voice still
  present writes one of its channels, and so does a role member leaving a lane.** A requalify
  costs 1.4 to 2.9 ms at 10,000 crowded voices (`bench/requalify.mjs` `direct`, teitou, a shared
  node's spread). One ending alone on its channels has skipped it since 2026-11-21: a frame one
  ends reads 0.52 ms, from 3.74 (`bench/runs/2026-11-21-requalify-reorder-ab.txt`, measured).
  Where its channel stays written, a channel it closed may open, so skipping needs the remaining
  writers shown off lanes for reasons of their own. Not built.
- **[agent] While any voice plays off lanes, `pull` reads every subject one at a time.** One
  stateful 40 ms voice on one subject, on a channel 10,000 crowded tweens do not write, cued every
  tenth frame: the frames it does not end on average 0.29 ms against 0.17 with none cued (`general`
  `rest` against `quiet`, `bench/runs/2026-11-21-requalify-baseline.txt`, measured), and it plays
  in about three of those nine, so a frame it plays in costs more (inferred). The cause is inferred
  from the code: `lanes.whole` is false while it plays, and `pullRun` reads nothing then.
- **[agent] Churn under other reorderings.** `pull` renumbers a swapped-in subject into the freed
  number, and since 2026-11-21 leaves a list shifted up by `splice` as numbered (`reorder-splice`
  9.73 to 0.60 ms a frame at 10,000 subjects, measured). Left: that 0.60 against 0.18 in order is
  every subject after the gap missing the position `pull` remembered it at and read alone (inferred
  from `readAll`, not profiled since). A shuffled list reads 0.24 against 0.18 (measured); a free
  number cannot fix it, which needs numbers swapped between live subjects. Under history, roles or
  a bound `src/renumber.ts` still declines; extending it there needs tests proving each store it
  would carry.
- **[agent] A crowd of tweens read half at a time goes idle and reads 5× slower than whole.**
  `pull` over every other one of 10,000 one-subject tweens takes 1.65 ms a frame against 0.33 for
  all of them (studio, shared, `bench/runs/2026-11-21-reorder-half.txt`, measured), and a profile
  puts 72% in `foldWith`, the general path (`runs/2026-11-21-reorder-half-prof.txt`). Half the
  subjects probed is under `SPARSE.other.stop` (0.6, `src/lane.ts`), so the crowd idles; the line
  was not set on a crowd of motions, whose general path costs this much more (inferred).
- **[agent] The finder commit `4350a86` made the glow rows 8–15% slower**, cause not found, left
  there by the owner's call (2026-10-29). Profiling, GC traces and pretenuring flags are in
  `bench/runs/2026-10-28-finder-*.txt`; the record layout is the one lead not tested.
- **[agent] astv's glides (+8%) and progress clocks (+39%) since 0.8.0** are unexplained, at 1–2 µs
  a frame; `MOTION_ONLY=1 probes/blits-version-bench.sh <out> 0.7.1` in `~/src/astv` on a node.
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

- **[maintainer] Two example demos still schedule from the frame loop** (2026-11-21):
  `light-board.ts`'s "Run the show" keeps the current look and the button lit as host state, so a
  panel seek back leaves the wrong look lit; moving it onto anchored voices that the buttons read
  back is a redesign. `burst.ts` cues its automatic bursts on `m.now` in the frame loop, as each
  needs new random sparks, which a voice cannot make.
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
