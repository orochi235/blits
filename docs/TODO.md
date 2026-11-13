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
- **[agent] `plot(subjects, xy, cell)`, `cell` as a third argument, is deprecated** (2026-11-12):
  remove it in the release after the one that ships `{ axes, cell }`. `bench/frame.mjs`,
  `bench/recaddr.mjs` and `bench/plotleak.mjs` still call the old shape, since older builds an A/B
  runs them against throw for `{ cell }`; move them to `{ cell }` with the removal.
- **[agent] Two copies of blits loaded together** share what each knows of its patches and
  channels (`src/shared.ts`). quarks, tone and the panel take blits as a peer, so their ranges must
  widen with each engine minor; quarks, tone and rapier call `bind`, so they must rise to the
  release carrying it.

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
- **[agent] Heatmap `pull` reads 5.4 ms with lanes, 3.8 without** (5,000 retargeted springs and
  three `ink` voices weighted by `input` signals). By line, `one`'s calls into `base`, `signal`,
  `primeLaned` and `signalled` are about 14% together, each spread thin; folding the four into one
  call layer is what is left. Profile with `bench/heatprof.sh`, not the stress demo, which plays a
  lanes twin.
- **[agent] A host probing into its own object under `retargets: true`** keeps two poses a
  subject in `Probes` (`src/trail.ts`), costing a 10,000-subject probe frame 35–70%, spread with no
  hot spot (`bench/runs/2026-11-08-probes-ab.txt`).
- **[agent] Steady `tweens^`/`weasel^` frame** (10k one-voice-per-subject tweens by `pull`): 0.235
  and 0.362 ms on studio against 0.03–0.05 for a hand loop. `tweens^` is 39% `bareRows`, 29%
  `pullRun` (about 1 ns a subject per check, none dominant); `weasel^` 58% `runMotion`.
- **[agent] A voice over every subject cued among a crowd** (`swap`, 2.19 ms on msb-uai). Left per
  subject: relinking its chain (`relink.ts`), the fill's `open`/`one`/`call`/`shut`, and the copy
  out, which boxes every number into a host's `{}` out; `mix.pose()` gives the unboxed shape.
- **[agent] A role costs about 20% over its voices played apart, a blend about 33%** (teitou,
  2026-10-26); `runRole` covers the inline case, everything else gathers then folds.
- **[agent] Starting 10k one-subject tweens** takes a 20.7 ms first frame against 8.9 for fn
  voices: crowd `join`, the motion buffer, a second numbering, collection. `Voice` has about 100
  fields, 12 of them boxed doubles.
- **[agent] A stop grows with N** (0.61 µs at 1,000 subjects, 2.92 at 40,000) though nothing walks
  more; inferred to be first touches of each object of the voice and each array of its crowd row.
- **[agent] `carry`'s walk past read-ahead copies that never read a voice is untested:** answering
  none in place of its fallback still passed `test/readahead.test.ts` (2026-11-12). Since the
  copies share one store (`Along` in `src/store.ts`), it runs only where the copy just before has not
  read the subject, so a test needs a voice first met many stops on.
- **[agent] `ink()` folds on lanes through its channel's `fold`**, a call per contribution; folding
  it as a five-axis sum needs the widening wherever a lane reads a contribution as numbers. Unmeasured;
  the benches still cue the deprecated `lerp: 'oklch'`.
- **[agent] A voice leaving the general path or a lane** still requalifies every voice.
- **[agent] Churn under other reorderings**: `pull` renumbers a swapped-in subject into the freed
  slot, but not for sorted, reversed or filtered lists, nor under history, roles or a bound
  (`src/renumber.ts` declines).
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

- **[agent] Listing past 8 groups of 4,096+ subjects still costs a 22–40 ms sync when the
  WeakMap doubles** (`src/filed.ts`, the mix's named index). A scene of voices naming 1M subjects
  now starts in 0.13–0.19 ms of sync and fold on the gpu engine, 0.6–0.7 the first time, and a
  staggered one ends in 0.10–0.17 (`bench/runs/2026-11-12-gpu-codes-copy.txt`); the cue of such a
  voice, which now pays the level hash and its codes buffer, is untimed.
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

- **[maintainer] Channel nodes shaped by their fold rule** (parked 2026-11-05). The outline is the
  region the rule sweeps: `sum` leans, `mul` and `min` lower the top, `max` raises the bottom,
  `last` narrows to a funnel. `node spikes/fold-shapes/shapes.mjs > shapes.svg` draws the sketch;
  the inner lines need weasel to take `detail` beside a `Path` outline.
- **[waiting] weasel gaps the site and playground work around** (rechecked on 1.18.0,
  2026-11-08): no per-row layout in labkit's `ControlPanel`, no accessible name apart from a leaf's
  label, `.clearable()` takes only a fixed placeholder, `DiagramView` never reports its first
  layout, no file picker, no editable code pane, no `aria-expanded` on `Button`, the `Transport`
  loop switch drawn as a `⟲` character.
