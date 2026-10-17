# Handoff — blits

**For:** the next session on blits. **Answers:** what blits is meant to be, what exists, what was
decided in conversation and lives nowhere else, and what comes next. The design is in
`docs/schema.html`; the naming work is in `docs/vocabulary.json`, which semanticore serves as a page. Do not
restate either from here; read them.

## What blits is

A common language and paradigm for orchestrating effects from arbitrary sources, extensibly and
flexibly. The package follows from that: each effect runs on its own clock with its own state and
weight, and a mix folds them into one value per subject per frame by rules that belong to the
channel, not the effect. The vocabulary is the deliverable as much as the runtime is — the sources
are open by design, so the language has to be able to name a seam it does not own. It generalizes
what klieg does three times over (motion, effects, lighting) and what wod's transition voices do
once, so klieg, wod, sherpa and magicsmoke can share one vocabulary and one engine. **klieg, wod,
sherpa and magicsmoke run on it**, each on its own `main`.

## State

- `main` at `git@github.com:orochi235/blits.git` — **public**; release 0.10.0 (2026-10-11).
- **Unreleased on `main`** (2026-10-11): a read ahead after a seek back that plays
  the tape's calls, a voice's own `stepMs`, and three fixes found on the way. The changelog's
  Unreleased section lists them. Chosen while building, Mike's to overturn: the name `stepMs` on a voice's spec, with 0 meaning the frame's gap; that a read
  ahead moves the tape forward and back, which the tape's subscribers hear; and which two calls
  it still refuses (the schema page's "Reading ahead past the tape").
- **Unreleased: `share(by, i, n)` and `BlendMember`** (2026-10-17), from item 13. The playground's
  solo mixes weight a member by `share` and its blends cue each member under its own name, tags and
  hits. Chosen while building, Mike's to overturn:
  - **The public read is a signal, not a read on `Handle` or `Mix`.** A solo plot needs the share
    as the weight of a voice in another mix, and `Handle.weightOf` already reports a member's weight
    in its own. To reverse, drop `share` from `signals.ts` and `index.ts`; `cueBlend.ts` in the
    playground is its one caller.
  - **`n` counts the members** (as `mix.blend`'s array does), not the stops, and an `i` outside
    `0..n-1` throws.
  - **A member is an entry in `mix.blend`'s array**, `{ patch, name?, tags?, hits? }`, beside bare
    patches, rather than a second array of specs. It carries only labels: not `score`, since a
    member in another score would resolve the shared anchor to another voice and start apart.
  - **A member's `tags` replace the spec's** rather than adding to them, as `name` and `hits` do.
    To merge instead, concatenate in `Mixer.blend` (`src/mixer.ts`).
- **Unreleased, breaking: `loop` defaults to one pass** (Mike, 2026-10-11; it defaulted to
  looping for good). It waits for the next minor. Every consumer's cues were read at its `origin`
  head (2026-10-11): one relied on the old default, klieg's lighting voice
  (`packages/core/src/render/lighting.ts`), whose sweep would leave after one period. klieg
  `dee96ba` gives it `loop: true`, committed on klieg's `main` and not pushed. No consumer test
  leaned on looping. The site's explainers and samples did, and now ask for it.
- **The score and reading back shipped in 0.3.0**, merged from `project` with lanes, `pull` and
  blits-quarks (2026-10-02). `mix.project(t)` with `probe`/`assess`, `MixOptions.history` (control
  log, departed voices, state copies, recorded inputs and host fields), placements by anchor with
  names, scores and queries, `mix.marks`, motion history in `spring`/`glide`, and the site's Score
  page. The schema page's Score section describes it; `CHANGELOG.md` has it under 0.3.0. One
  behavior change rides along: a finite loop's fade starts when its last pass ended, not at the
  next frame.
- **klieg's port is merged into klieg's `main`** (2026-10-02), and its step two shipped in klieg
  0.15.0 (merge `77d537d`, 2026-10-05). klieg reads `setting.host` through `mix<I, O, H>`.
- **Which blits each consumer pins**, read from each `origin` head on 2026-10-11:

  | Consumer | Pins |
  |---|---|
  | astv, weasel core and labkit, agnew | `0.8.1` |
  | klieg | `0.7.0` |
  | wod, sherpa, magicsmoke | `0.6.0` |
  | portfolio | `0.4.0` |

  This file said until then that wod, magicsmoke, portfolio and klieg's `main` were on 0.8.1 in
  commits not pushed. No ref in the clones under `~/src` holds such a commit, so those moves are
  either on another machine or were never made. sherpa follows klieg, to keep one blits copy.
- **sherpa runs on klieg**, with one deduped blits copy. Its seams run on a blits mix, and its klieg pages hold on clicks and stages through
  `dismiss: 'host'` and `advance()`, paced on klieg's `active` and `stage` marks. All three systems fold through a mix: `Timeline.poseAt`
  cues a voice per layer of each phase, `EffectFrame` one per effect, and the sign's environment is
  a mix with one subject. The arithmetic did not move: klieg's 1974 vitest cases pass on the fleet,
  and its Playwright specs fail exactly the five they already failed before the port, to the pixel
  (recorded in klieg's changelog). 0.3.0 needed no change in klieg: its `color` channel is a `hex`,
  but every effect voice plays at full weight with no locus, so the OKLCH blend is never taken. The
  schema page's klieg section says what the port found.
- **The package, `@msb235/blits` 0.10.0 on npm.** `src/` is the whole of it: `channels.ts` (the stock
  channels, `kit`, `hex`/`mixHex`, `bounds`), `easing.ts` (easing as data resolved to a curve), `patch.ts` (`patch`, `keys`,
  and the stops built once per channel that `from: 'current'` reuses),
  `motion.ts` (`spring`, `glide`), `tweened.ts` (a tween's closed form, in pieces a fill calls), `clock.ts` (the phase, envelope and weight clamp both fold
  paths share), `numbers.ts` (numbers subjects), `signals.ts` (`peak`, `slew`, `lag`, `level`, `gate`), `store.ts` (per-subject storage, WeakMap for
  objects and a Map for anything else), `types.ts` (the whole public surface, doc-commented: a barrel over `types/`, a file a domain). The
  mix is `mixer.ts` (the `Mixer`'s state, its public methods, the engine and `mix`) and a module
  per part it owns: `voice.ts` (a voice and its record of a subject), `cue.ts`, `place.ts`
  (anchors), `marks.ts`, `move.ts` and `due.ts` (the clock moving, the voices due), `held.ts`,
  `chain.ts`, `weigh.ts`, `blend.ts`, `fold.ts` and `locus.ts` (the general path), `pull.ts`,
  `fade.ts`, `strays.ts`, `hosts.ts`, `history.ts`, `project.ts`, `owner.ts`, `book.ts`, `pace.ts`
  and `handle.ts`. Lanes are `lanes.ts` (the `Lanes` class and the probe protocol) with
  `qualify.ts`, `lane.ts`, `crowd.ts`, `rows.ts`, `meet.ts`, `fill.ts`, `gather.ts`, `sample.ts`,
  `bare.ts` (tween rows sampled without keeping the sample) and `columns.ts`. What a probe or a fill runs per subject is methods, written in those modules
  as functions taking `this` and installed on the prototype at the foot of `mixer.ts` and
  `lanes.ts`: as plain functions they cost up to 9%. Zero runtime deps, ESM, vitest, biome as klieg. `npm run check`
  is lint, typecheck of both `src` and `test`, then the suite, green. `npm run bench`
  (`bench/frame.mjs`) measures a frame at scene sizes, GC counts included. Enlisted for the fleet — `.onto/tests` is
  `plugin: node`, `run: npm test`, `runner: vitest` — and green there too.
- **A voice's `freeze`** (shipped in 0.4.0 as `hold`, renamed in 0.6.0): WAAPI's
  `fill` under blits' own name, for wod's move onto blits — `useSpin` holds its landing angle with
  `fill: 'forwards'` and awaits `animation.finished`, which map to `freeze: 'after'` and
  `handle.played`. The schema page's Freezing paragraph has the design. Mike chose the values
  `before`/`after`/`both`, that a frozen voice's end is when it is faded, not when its passes run
  out, and the name `freeze` once the ticker's `hold()` took the word; the state is
  `'frozen'`, and the alias `hold` is removed in 0.8.0.
- **`mix.inert` shipped in 0.4.0** (built 2026-10-03, merge `3228fa7`), for wod's frame loop to
  sleep under a landed wheel while `live` stays true. Mike asked for it and named it through the wod
  session; the CHANGELOG entry and the schema page's `Mix` block say what counts as inert. wod's
  migration (`~/src/wod/docs/superpowers/specs/2026-10-03-blits-migration-design.md`) is built
  through its last phase, editor scrub (merge `06ef87d`, 2026-10-04).
- **The site, `site/`**, built 2026-09-30: an Astro workspace with a live explainer per word and
  the API reference from the doc comments. `site/README.md` says how it works; `npm run site:smoke`
  is green on all 15 pages. Deployed to `michaelbaker.tech/blits/` by `.github/workflows/site.yml` on every push to `main`;
  that workflow also runs the site's typecheck, which `npm run check` does not.
  Every explainer draws a stage of what its mix drives above its chart (2026-10-04). `site:smoke` also
  fails a page laid out wider than a 390 px viewport. The sliders whose
  right end means never (Score's `cut`, Mix's `muteAt`, Voice's `fadeAt`, State's `cap`) are on
  labkit's `endless`, which stores `Infinity` at that stop.
- `docs/schema.html` — the design: vocabulary, channel table, patches, voices, mix,
  signals, time model, blending, patch state, the engine seam, per-consumer rigs, the klieg port,
  decided-against, tests, open items. Status line says design under review. It reads in the called
  words; klieg's own `offset` channel, the arithmetic `add`, a `keys` patch's `stops` and the patch
  callback `step` are deliberately unrenamed.
- **The spec self-review has been done and its findings fixed** (2026-09-27). What the review
  changed, so nobody re-derives it: `sync`, `step` and `Setting.dt` now say that nothing advances
  at the call and each subject catches up by its own whole gap; `mix.mute` takes `over` like
  `handle.fade`; `duration` became `period` (reversed on 2026-10-04, below) and `t` became `phase`; `pose`,
  `contribution`, `setting`, `period`, `phase`, `system`, `source` and `score` are defined in the
  Vocabulary section; `Easing`, `Keyframe<O>`, `StaggerSpec` and `mixHex` are given; and the
  answers a builder would otherwise have guessed are stated where they belong — `target` runs per
  subject on first sight, `seek` moves the clock and never runs state forward, `setting.weight` is
  post-cap, `from: 'current'` reads the frame before the voice contributes, a stateful signal's
  state is kept by the mix per voice and subject (changed 2026-09-29), `live` goes true on `cue` and the mix never calls back, and a
  consumer may declare its own channel, which is what sherpa's `transform` is.
- `docs/vocabulary.json` — **the naming sheet, and the source of it.** 19 nouns (one
  fixed), 8 verbs, 4 operations, 20 candidates each, six consistent-set columns, relations,
  algebra. Edit this file; semanticore builds the page from it, so nothing is hand-edited in HTML
  any more:

  ```
  cd ~/src/semanticore
  git pull --ff-only
  node bin/semanticore.js check ~/src/blits/docs/vocabulary.json   # 20-word rule, placeholders
  node bin/semanticore.js serve ~/src/blits/docs/vocabulary.json --port 4873
  ```

  Run semanticore at its `main` HEAD. If that won't render the sheet, fall back to `0c1df0c`, the
  last build known to render it (2026-10-07). The built page is not committed here; `serve` rebuilds on every
  edit and adds undo/redo, snapshots, cross-off and chat, none of which the hand page had.

- **The playground's diagrams.** Views A to D are built: the signal flow, the timing graph, both
  as one diagram, and that diagram editable; the playground's README ("The flow", "The timing",
  "Both", "Editing the diagram") describes them.

  Chosen while building, Mike's to overturn:
  - View C is one diagram with both kinds of edge, not the two views linked side by side (the
    right column is too narrow for two). Reverse it by replacing `BothPanel` with a `FlowPanel`
    over a `TimingPanel`, sharing `selected`.
  - View D is the Both tab behind an **edit** box, not a tab of its own, and Flow and Timing stay
    read-only. Reverse it by giving those panels the same `FlowDiagram` editing props.
  - A port's meaning is its compass side: a voice's or group's top takes a weight, its left is its
    start, its right its end; a signal or mark gives from its bottom. weasel's default ports are
    kept so layout is unchanged; the unused ones are hidden. Reverse it by giving nodes their own
    `ports` in `FlowDiagram`, and rewriting `roleOf` in `src/blits/wire.ts`.
  - Dragged node positions last the page's life, outside the composition and its undo; reverse it
    by storing them in the composition (a new optional field, which `load` would have to accept).

  View B boxes owners and spans, not loci: a weasel diagram group holds each node once, a voice has
  both an owner and a locus, and voices of one locus may sit under different owners. A locus is
  named on its voices instead. Chosen 2026-10-13 without a decision from the owner, who said to
  build it; reverse it by boxing loci in `timingOf` and drawing owners as nodes with edges.

  The mixer-desk drawing of A is built, as the Desk tab (README, "The desk"). `flowOf` builds the
  graph from the playground's `Composition`; once the UI settles, a public `describe()` on `Mix`
  should make the same shape for any host, and `flowOf` becomes a thin adapter.

  Chosen while building the desk, Mike's to overturn: it is live, each tap and meter lit by the
  voice's `weightOf` for the picked subject and each bus printing the folded value (reverse by
  passing `deskOf`'s desk straight to `MixerDesk` in `DeskPanel`, skipping `litDesk`); groups are
  brackets over their strips rather than strips of their own, with strips in the score's order so
  a group's are adjacent (`deskOf`'s `groups`); a desk with more voices than fit at 24 px apart
  scrolls sideways instead of squeezing (`MIN_PITCH` in `MixerDesk/layout.ts`); only channels
  something writes get a bus, as in the flow.

  weasel 1.10.1 (2026-10-15) carries the diagram's edge routing and label-sized group boxes, but
  not weasel's reworked `layered` layout, which is on weasel's `origin/main` (2026-10-17) and in no
  release. Until one has it, this machine's `apps/playground/node_modules/@weasel-js/diagram` is a
  symlink to `~/src/weasel/packages/diagram`, whose `dist` is whatever that checkout last built;
  `npm ci` or `npm install` replaces it with 1.10.1 from npm. Once weasel releases the layered
  layout, pin that version and delete this paragraph.

  An edge label is still placed without regard to nodes, so on a short edge it can overlap the box
  it leaves or enters (`anchors`: `start its end +200 ms` over `pair`). That gap is filed in
  weasel's `docs/TODO.md`.

## Decided in conversation, and in no doc

- **Approach**: a mixer of tracks, over a signal graph and over keyframes-only. Chosen 2026-09-15.
- **Engine seam**: the `Engine` interface with a `runs` set and `create`; one engine ships,
  `mixer`; later ones are sketched only to prove the seam. Mike asked for the seam explicitly.
- **First consumer**: all three klieg systems at once, not effects alone. The port is a pure
  extraction first, same arithmetic, so klieg's 40 Playwright baselines hold unchanged; a baseline
  that moves is a defect in the port, not a baseline to re-bless. New capabilities turn on after.
- **Home**: its own repo, here, not klieg's monorepo and not weasel. Package name `blits`: free on
  npm; `@lightningjs/blits` is a live TV framework whose name will win searches.
- **klieg yields**: where a blits name collides with a klieg name, klieg renames, provided blits
  earns it. Said about `domain`, which klieg's tube gradient uses for something else; blits took `kit`
  for the channel set instead, so klieg keeps `domain` (Mike, 2026-10-05).
- **`duration`, not `period`** (2026-10-04, Mike's call): a pass is one run through a patch whether
  or not it loops, and only a looping voice has a period. `Patch.duration` is the field;
  the alias `Patch.period` is removed in 0.8.0.
- **`phase`** is the fixed name for the normalized position within a pass, formerly `t`. It costs
  renaming klieg's `onPhase` and `PhaseEvent`, which sherpa consumes through `ctx.phase`.
- **The vocabulary is called**, every role enshrined on 2026-09-29, and
  `docs/vocabulary.picks.json` is where it lives: delta, channel, kit, subject, patch, voice, mix,
  signal, handle, engine, pose, contribution, setting, timestamp, duration, phase, rest, weight, locus,
  series, host, source, score, subsystem; for the score, anchor, event, mark, name, tag, query,
  resolver, projection (synonym image), doubt, snapshot, interval; cue, fade, sync, probe, project,
  assess, seek, blend, mute, drop; merge, scale, lerp, fold. The code and the schema page read in
  them. `name`, `query` and `resolver` are marked informal. `contribution` replaced `influence` on
  2026-10-07, Mike's call; it is internal, so nothing exported changed.
- **Blending** covers all four behaviors he was offered: fade, retarget on interruption, blend
  between alternatives, handover at rest. All reduce to a weight per voice or a channel lerp.
- **Two clocks, both addressable under a tape.** Voice time is a position, because `phase` is
  computed from the reading rather than accumulated into (decided 2026-09-27). Mix time became one
  on 2026-10-07, once a seek back replays the host's recorded calls: `mix.seek(t)` moves it, and
  `seek`, `project` and `mix.now` are all mix time. The 2026-09-27 rule that `seek` has one scope,
  the voice, fell with that. The session that built the mix method named it `seek`, and Mike kept
  the name on 2026-10-07: one word at both scopes, as in a media player.
- **Reading back is a read; moving is `seek`.** `project(t)` copies state and reads at `t`, with
  history opt-in and nothing kept without it. `mix.seek(t)` (built 2026-10-07, after a first build
  that cut the future) restores the live mix and replays the host's calls from a weasel-history
  tape, branching on a new call. weasel asked for it on 2026-10-06 for labkit's trial clock; Mike
  made each call in the decision list then. The schema page's Score section, "Seeking", is the
  record.
- **The score's shape, picked 2026-10-01 while building it** (Mike asleep; his to overturn): anchors
  are `after` (the target's end), `with` (its start), `before` (its start less `by`) and the general
  `{ of, mark, by }`; a query's resolver is a field, `resolver: 'next'`, not the schema's earlier
  `next: true`; a bare name looks in the asker's `score`. Mike chose (2026-10-01, awake): a **mark** is
  any named time an anchor hangs from, a voice's four or one the host puts on a score with
  `mix.announce(name, { at? })`; an **event** is only what a patch `send`s out. `announce` is not in
  `docs/vocabulary.json` yet. A start follows its target only while
  pending, an out until its fade begins. Queries never read channel values, and astv's own rules
  (which nodes changed, arrivals growing from an ancestor, ghosts) stay astv's: checked with two astv
  sessions on 2026-10-01.
- **`mix.step(now)` becomes `sync`**, and `step` stays on the patch callback, where it takes a `dt`
  and means an advance. The mix method takes an absolute reading and publishes it; nothing advances
  at the call, and each subject catches up when it is next sampled. Both were called `step`, meaning
  opposite things. Decided 2026-09-27, and in the schema page.
- **Name from the point of view of the thing that experiences it**, not the machinery that
  produces it. A pattern does not meet a fresh object each frame; it looks again and the world has
  moved on, so an argument from allocation is not an argument about the concept. The same cut
  settled the mix's clock verb: `step` named the consequence, `sync` names the act. Stated
  2026-09-27.
- **A locus folds by `lerp`, not by scaling and merging.** The review found the old cap's
  invariant — two voices in a locus at weight 1 look like one at weight 1 — false on every channel
  but `sum`: two at 0.5 on `mul` give `(1 + (v − 1) / 2)²`, so a shared gain of 0.06 read 0.28.
  A locus is alternatives, so the mix folds its members through the channel's own `lerp` by their
  share of the summed weight, and that one contribution counts at `min(1, Σw)`. On `sum` it is
  identically `w₁a + w₂b`, so klieg's baselines hold and the port stays an extraction. Mike had no
  view and asked me to take it; decided 2026-09-27, and the alternative (per-channel
  normalization) is in the page's Decided against.
- **Two halves of "offset"** were split: the delta a patch returns (partial, relative) and the pose
  the mix returns (resolved). klieg's `ResolvedOffset` is the second.

- **Decided 2026-09-29/30, and in the code or the schema since**: easing is data (CSS's names,
  `{ bezier }`, `{ steps }`) as well as a function; `stagger` is asked once per subject and a
  subject's fade in counts from its own start; a `Setting` is valid only during its call;
  `Channel.fold` folds into the pose in place; `mix.rebase()` takes hidden-tab time out of the
  clock and `MixOptions.maxDt` caps a step's `dt`, off by default.
- **Semver from 0.1.1**, decided 2026-09-30. Below 1.0.0 a break bumps the minor. 1.0.0 happens only
  on the owner's explicit say-so, whatever else has landed. Every release gets a `CHANGELOG.md` section, which
  the release workflow checks. 0.1.0 went out by hand; 0.1.1 is the same code from the
  workflow, and every release after it goes out from a `v*` tag.
- **The site**: the vocabulary first, consumers' docs second, the npm pitch third. Astro, not a
  Vite app, because it is mostly documents. `docs/schema.html` stays the design record, untouched;
  the site takes its outline loosely. Local until GitHub Pages, and the workflow exists already.

- **Built 2026-09-30 for magicsmoke**, which now runs every fault on blits (its old engine is
  deleted; on magicsmoke's `main` since 0.5.0): `lag`,
  `handle.weightOf`, `MixOptions.stepMs` and `setting.send` / `mix.drain`. Each is in the schema
  page; magicsmoke's row in the consumer table says how it uses them.

- **Spans and joins (built 2026-10-07, merged).** Mike's framing: consumers declare
  what they want of time, and blits resolves competing duration claims from the hints they give;
  any strategy is acceptable as long as declaring it is easy and it just works. He picked a span
  with fit strategies over a constraint solver and over a helper the host calls; that `overrun` is
  opt-in and never in the default; that collapsing everything left to an instant is a choice; that
  joins are `all`/`any`, not first/last, which read as the ends of a range; and asked for
  `lax` (then `lenient`) as a convenience. He rejected `give` as the name for the children's hints, which are
  now plain fields on the spec. The schema page's Score section, "Spans" and "Joins", is the
  record.

## Next, in order

0. **The playground is on `main`** (merged 2026-10-04, `d9ef787`). A Vite + labkit app at
   `apps/playground`; its README says what it is, how to run it and how it works, and holds what
   stays true of the design.
   Decided in conversation and not otherwise written down:
   - Mike will rework the score and panel designs later; this version is a start.
   - The composition types are named without a `Doc` suffix (Mike took that from a side
     discussion).

1. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits, all of it measurement
   now: the garbage a churned voice makes was cut from 21.5 to about 13 KB on 2026-10-11, and the
   file says what the rest is. Delete each item as it is dealt with, and the file once it is
   empty. Its speed items matter only if weasel adopts blits: klieg and
   magicsmoke are expected to run about two dozen voices over tens of subjects, under 1,000 subject
   × voice pairs, where a frame costs about 0.2 ms (2026-10-01 guess, not a measured
   workload). Two things that file records about the bench change how its numbers read: at
   `FRAMES=5000` the tween rows mostly time tweens that have landed, since each lasts 10 s, and
   `turnover^`'s `kB/frame` is mostly the row's own list copy.

1a. **Lanes are built and merged into `project`** (2026-10-02). The schema page's Lanes section
   says what they are, what qualifies and the two places the pose path differs; the `'motion'` form
   is in its Springs and glides section. Measured on the fleet (studio, three runs alternated
   against `project`), lanes ÷ `project` per frame: `keys` 0.38–0.57, springs 0.53–0.72, a
   stateless `fn` 0.70–0.88. A lane rests when few of its subjects were probed last frame. The table
   is in `spikes/gpu-engine/README.md` under "Lanes, as built". A weasel session reruns
   `animator-on-blits` and `pose-overrides` against the build before deciding its animator step 3
   (weasel `c7a183bde`, branch `pose-overrides-mix`).

1b. **What lanes cost on rows they don't serve, accepted by Mike 2026-10-02.** A voice per subject
   (`named`) reads 1.07× at 10,000 subjects (+0.2 ms) and 1.2× at 100–1,000 (+0.04 ms at most); a
   mix probing 5% of its subjects 1.29× (+0.03 ms); a projection every frame (`ahead`) 1.10×
   (+0.2 ms); a spring voice per subject with `lanes: false` about 1.05×. Profiles put it in three
   places: the phase and channel arithmetic is now one shared copy that V8 does not always inline
   where `project` had it written out; numbering and first-sight checks on every probe while lanes
   are on; two more fields per record (lane number, seek count) that a projection copies. Writing
   the arithmetic out again was turned down, since the exactness guarantee rests on there being one
   copy.

1c. **Next for speed, decided with Mike 2026-10-02, in this order, each measured on the fleet
   before the next starts.**
   - **Bulk output: `mix.pull`, built 2026-10-02.** The host hands arrays in its own order; nothing
     internal is exposed. An array read again in the same order skips each subject's lookup (Mike
     chose that over a view object or host-held numbers, 2026-10-02); the schema page's Reading in
     bulk paragraph has the numbers. In weasel's shape a shared tween voice read by `pull` was still
     about 4× weasel's own animator before that. Then (branch `motion-batch`, 2026-10-02): lane
     values copied a column at a time, as one block when in order; a motion lane filled in one loop
     (`runMotion`) through the one copy of the closed forms (`Motions.sampleBare` calls
     `evaluate`), keeping Mike's one-copy rule. Mike set the goal as fast and capacious as
     possible, not a target (2026-10-02). weasel-shaped `pull` at 10k is now about 0.44 ms on
     teitou, from 0.71; remembered lane slots are read without loading each chain while nothing
     has relinked (`relinks` counts chains made stale one subject at a time). Storing stretches as Float64Arrays gave nothing (reverted, `b4a4260`).
     `prepare`'s per-subject bookkeeping now runs once per `pull` over a remembered list
     (`pullRun`, branch `pull-run`, 2026-10-03): weasel-shaped `pull` about 0.38–0.45 ms on
     teitou. What is left, by a profile of 20,000 frames on teitou (0.35 ms a frame): the fill is
     about 68% (`runMotion` 30%, the fold 12%, weasel's own easing 9%), the read about 29%
     (`pullRun` 14%, the column copy 11%).
   - **`tween`, built 2026-10-02** as a fourth motion kind (Mike chose its own clock, like a
     spring's, over the voice's period). In weasel's shape on studio it takes a frame to 0.83
     of a `fn` tween's and its collection pauses to a quarter; against a `fn` with no per-call
     lookup it is about even, both sitting on the probe floor. The schema page's motion section
     and `spikes/gpu-engine/README.md` under "Tween" have it. A spring with lanes off, which read 1.14× on a loaded studio, reads 0.99× on an idle node.
   - **One voice carrying many independent animations: built 2026-10-02 on branch `subject-fade`.**
     A host that starts many short animations (weasel's reflow and pose helpers, one per node) can
     keep one shared voice per motion kind on its lane rather than a voice per call:
     `handle.fade({ subject, over })` takes one subject out of a voice, and `tween`'s `ms` may be
     per subject. The schema page's Voice and motion sections say how. Mike chose to extend `fade`
     rather than add a removal verb, so the handle stays the only pathway for control; `mix.drop`
     already meant "forget this subject everywhere". weasel (weasel-64) confirmed it needs per-node
     removal: a node changes motion kind mid-flight, or is cancelled with nothing replacing it. The
     schema page's Open section has the one gap, reading back across a subject fade under `history`.
   - **A voice per node, built 2026-10-03** (branch `voice-lane`): single-subject motion voices
     share a crowd of flat rows per channel, and `sync` visits only voices with something due. The
     schema page's Lanes section has how and the numbers; 10k tween voices of one subject each now
     cost what one shared voice does. Mike approved the direction and the design, which was then
     deleted as built.
   - **Crowds take `keys` and stateless `fn` rows, and voices come and go without a requalify**
     (branch `crowd-rows`, 2026-10-03). A voice naming its subjects relinks only those, joins its
     crowd at the end and leaves an empty row; `drop` walks only the voices that can hold the
     subject. weasel's ask: on teitou a frame replacing one of 10k tween voices went from about
     9 ms to 0.6 by `pull`. The schema page's crowd paragraph has the rest. Left: a voice that
     leaves the general path or a lane, rather than a crowd, still requalifies every voice.
     Reading keys stops as flat numbers measured no different and was reverted.
   - **The slow cases after 0.4.0, worked overnight 2026-10-04** (branch `slow-cases`, Mike
     asleep). `CHANGELOG.md`'s 0.8.0 section lists what landed, with numbers: crowds of
     several channels, in-place crowd compaction, an allocation-free locus fold, read backs
     without `structuredClone`, a spring's shared time terms, and per-voice memory cut by a sixth.
     Every change was checked bit for bit with `bench/same.sh <rev>` (random scenes through two
     builds), and timed one row per process with `AB_EACH=1 bench/ab.sh`. `bench/start.mjs`,
     `bench/memory.mjs` and `bench/heapby.mjs` measure starting voices and what each one holds.
     The same night put signal weights and loci on lanes (the schema page's Lanes section has
     how), which found and fixed two exactness bugs the random scenes now cover: a lane clamped
     a weight before multiplying in a subject fade, and `atRest`'s dry read handed a weight
     signal the unheld time. `SAME_LANES=off bench/same.sh <rev>` compares this tree's lanes with
     a revision's general path. What is still slow, largest first:
     - **A voice over every subject cued among a crowd** (`swap`: 10k tween voices of one subject
       each, a voice over all of them replaced every frame) costs about 3.6 ms a frame on teitou,
       from 12.4 at `560f79c` and 6.2 at `a7d5317`, against 0.83 for the tween voices alone. What
       is left is spread thin: a record per subject for the new voice and the WeakMap entry that
       holds it (about a fifth of the profile together), the patch call and its fold on the general
       path, and collection. Keying a voice's records by subject number would drop the WeakMap
       for subjects lanes number, at the cost of a second way to find a record.
     - **A blend still costs half again a plain voice**: three voices blended by a signal over
       10k subjects take about 3.2–3.3 ms a frame, three plain ones 2.0 and a plain locus of three
       2.7–2.8 (teitou, `FRAMES=5000`, 10 rounds, 2026-10-04). `mix.blend` now reads its signal
       once per subject per frame rather than once per member (Mike's call, 2026-10-04), which
       measured no different (3.20–3.67 against 3.20–3.53 at `a7d5317`): the bench's signal costs
       almost nothing. A profile against the plain locus puts the difference in the lanes' per-member weight path (`one`,
       `signalled`, and `gatherLocus`). A locus with a motion member, or a signal that keeps state,
       stays on the general path.
     - **Starting 10k one-subject tween voices** takes about 2.5–5 ms to cue and 16–18 for the
       first frame, against about 3–4 and 11–14 for `fn` voices (teitou, 2026-10-05, `bench/start.mjs`
       medians over three alternated rounds against `66ea692`, which took 6–6.5 and 18–20). Cueing caught up once a patch stopped making a buffer before its first subject.
       What the first frame still allocates per voice, by the code: the patch's first stretch
       (its endpoint arrays, a weak reference, a buffer off the heap) and the voice's own WeakMap
       and record, with collection the largest line of a profile (15%);
       weasel's ask below is the way past it. Measured no different and reverted: carving motion
       buffers from a shared slab, and keeping a named subject's record out of the WeakMap. Asking
       the mix by voice id rather than through two closures, and finding a lone subject without a
       WeakMap, measured no different in time and were kept for the bytes they save.
     - **A crowd's `keys` rows** cost about 35 ns a subject by `pull` against 25 for keys voices
       over every subject (teitou, 2026-10-05), from 66–102 once their stops were copied into
       the crowd's own array. What is left is each row's own segment search, ease and lerp, where
       a shared voice does those once per phase; sharing them across rows whose stops have the
       same phases and easings would need a way to tell that cheaply, such as interning a
       track's timing when it is built.
     - **A voice that allocates almost nothing per cue would not speed weasel's frame.** At
       `0c80b6d` (3.7 KB a voice) weasel's animator takes 0.50–0.73 ms a frame for 10k tweens on
       teitou, against 0.165 with no voice cued. Pooling weasel's own per-animation objects, which
       tests whether a voice's bytes between them cost cache misses, closed none of that gap
       (weasel branch `animator-pool`, `71f7c42c6`); blits' own share stayed 0.22–0.25 ms in
       every row. So the lever for weasel is blits' per-frame work, not bytes per voice; a
       one-subject voice kept in a crowd's rows would still help starting voices.
     - **A motion patch's `runs` as a plain array** would save about 150 B more per voice (a
       one-subject tween voice holds 3.7 KB by `bench/heapwho.mjs 5000 weasel`), but `closed`
       then reads stretches from a plain array and from a crowd's Float64Array, and at
       `FRAMES=5000` on teitou `tweens^` ran 6% slower; copying each stretch into a Float64Array
       first made `weasel^`, whose voices sample through their patch every frame, 15% slower. The
       way through is a lane copying its stretches into its own Float64Array, as a crowd does.
     - **Nothing reads clearly slower than 0.4.0 at steady state.** Confirm any short-run
       regression at `FRAMES=5000` before chasing it: 330 frames can end before the JIT settles.

1e. **Next for speed: the steady frame of 10k one-voice-per-subject tweens read by `pull`** (`tweens^`,
   `weasel^`), Mike's go 2026-10-05. Bare tween rows fill in one loop (`bare.ts`) and `pull` queues
   runs since 2026-10-05: on teitou `tweens^` takes 0.17 ms a frame and `weasel^` 0.22, against
   0.031–0.047 for a hand-written loop doing the same arithmetic. What is left:
   - **Inlining `linked` back into `probe` and `atRest` buys no frame time**, so not worth
     re-proposing. A callee with TurboFan code of its own costs the caller its bytecode plus what
     that code inlined, times 1.2, against 920 for the whole compile (`--trace-turbo-inlining`):
     `linked` at 91 + 521 did not fit. Caching `filled` as one stamp that `begin` sets on its way
     out, and moving `begin` and the per-subject stamping out of `prepare`, took that to 244 and
     put `linked`, `chain`, `prepare` and `filled` back inline in the bench's read loop; reducing
     `keep` to its check as well inlined the stamping into `probe` for `named` and `fn`. On
     msb-uai, 12 own-process runs a side at `FRAMES=5000` against `1981422`: probed 2.224 → 2.188,
     fn 2.792 → 2.747, named 2.292 → 2.272, probed- 3.924 → 3.906, rest 1.216 → 1.216, every row's
     runs overlapping the other side's, collections unchanged; without the `keep` change, within
     ±1.2%. `bench/same.sh` read 0 differ in all four settings. What `probed` still allocates is
     pose data: `foldWith` copying each channel's rest value, and the `fn` voices' returned objects
     in `fill.ts`'s `call`.
   - Measured no different, so not worth re-proposing:
     - Moving `popDue`'s loop into a function of its own (`due.ts`). It ends `popDue` deoptimizing
       at its tail on every frame a voice comes due (`node --trace-deopt`, 252 in 600 frames of
       `churn^`), which a `turnover^` profile charges 42–49% of the frame, yet no row moved (eight
       runs a side, teitou).
     - Skipping `atRest`'s second `chains.get` after a probe of the same subject, though a local
       `--cpu-prof` charged `chains.get` 8% of `probed`'s samples. `chain` kept the last subject
       and head it answered and returned them while the head's version was current. On teitou, six own-process runs a side at `FRAMES=5000` against `13f7df1`:
       probed 1.559 → 1.516 ms, fn (10k) 2.084 → 2.121, named (10k) 1.347 → 1.342, probed-
       2.663 → 2.667, rest 0.943 → 0.964, tweens^ 0.165 → 0.166, weasel^ 0.220 → 0.217, every
       row's runs overlapping; `bench/same.sh` read 0 differ with lanes on and off. The probe's
       own lookup has no way around it short of a per-subject handle the host holds.
   - Not tried, and not to try: writing `pullRun`'s `LANE_PROBE` and `LANE_FILL` once per run
     instead of per subject. `weightOf` (`Lanes.reported`) and every pace loop (`bare.ts`,
     `sample.ts`, `crowd.ts`) read them by slot, so each would also have to find the run holding
     its slot, a second place for the same answer; and `pullRun` reads both stamps per subject
     anyway to count `distinct`, so the saving is a store per subject.
   - **A cheaper `keys` patch read, asked by weasel 2026-10-08: built for plain-number tracks**
     (`bce8fa3`). `NOTES-FROM-WEASEL.md` under "Speed" has the numbers, and why there is no
     public read into an out object, and what weasel's own bench reads on 0.8.1: about 0.41 ms
     at 10,000 tracks from 0.48, with a slow mode near 1.0 on both versions.
   - `turnover^` reads two ways on identical code (0.43–0.46 or 0.48–0.54 ms by process): six
     runs a side at least.

1d. **`@msb235/blits-quarks` 0.6.0 is on npm**, pinned to engine 0.10.0 and published from its
   `quarks-v0.4.0` tag (0.1.0 went out by hand, because npm refuses trust for a name never
   published). Its README says how it works. magicsmoke is on engine 0.8.1 but its fizz and tuning stay on its own code: the driver doesn't fit without changing
   what magicsmoke does. Its `docs/HANDOFF.md` has the gaps; the likely driver changes are a
   per-subject emitted count from `write`, rate or counts settable by the host, and rounding
   without the `1e-6` slack. Mike's call whether to make them.

2. **The remaining opens** are in the schema page: what the score still lacks (marks placed inside
   a voice; tags absorbing loci; splitting a read ahead at known events), color's lerp space and the
   stock band's width.

4. **Reach is fixed at cue, so a voice whose contribution moves pays for every subject it might
   touch** (2026-10-07). A pointer glow is a weight signal run for every reached subject every
   frame. Its patch is not the cost: `at` has been skipped at weight 0 since 2026-10-04, and a
   `keys` patch's stops are now too (outside a locus, where a delta makes a voice a member; `step`
   still runs, since a skipped step cannot leave state as a run one would). What is left for each
   of the 98% of subjects out of range is visiting its record: `contribution`'s bookkeeping, the
   signal call, the envelope. Measured on studio (2026-10-07, M1 Max, load average 2.2–3.3 from
   other jobs; `bench/again.sh 6` and `AB_EACH=1 bench/ab.sh` against `main` over the `glow*`
   rows, medians of six fresh processes), a glow over 10k subjects adds to the voice under it

   | Read | glow, `gain` | glow, `gain` + `hex` | glow, `gain` + `color()` | `keys` glow, `gain` + `hex` |
   |---|---:|---:|---:|---:|
   | probe | 0.91 ms | 1.52 ms | 1.25 ms | 1.47 ms |
   | probe, lanes off | 1.01 ms | 1.10 ms | – | 1.22 ms |
   | `pull` | 1.01 ms | 2.96 ms | 1.21 ms | 3.02 ms |

   on a 2.10 ms frame (0.84 by `pull`). The `keys` glow (`glowkeys`) was 5.05–5.37 ms a frame
   before the skip and is 3.58–3.73 after, 0.70–0.73 of it; every `fn` glow row is within ±5%
   of `main`. A `hex` column still takes the glow's voice and the one under it off the lanes;
   `color()` runs on them and costs `pull` 0.2 ms over `gain` alone, so that half is solved by
   moving to `color()`, not by reach.
   - The skip, done (2026-10-07).
   - Declared bounds, the design to evaluate (unbuilt). The mix takes subject positions from the
     host, and reach may be declared at three levels, each optional, each meaning "everywhere"
     when absent; a voice's reach is where all three overlap:

     | Declared on | Knows | Example | Changes |
     |---|---|---|---|
     | voice (`subjects`/`target`, today) | which subjects this cue is for | only the left sign | fixed at cue |
     | patch | the effect's footprint by phase | a ripple growing 0 → 200 px | with phase |
     | signal | where it is nonzero | within 80 px of the pointer | with host input |

     A bound on a mix without positions is refused at cue. Channels take no reach. The hazard is
     a bound declared too small, which clips the effect silently; a dev check could sample a few
     subjects outside it and warn on a nonzero contribution. Opt-in (decided 2026-10-07): with no
     bound, behavior is today's. Whether unbounded voices are ever deprecated is left open, and
     unlikely — klieg's lighting, a fade over a whole sign and wod's transitions are unbounded by
     design; `target` is the likelier candidate once bounds absorb its spatial uses.

     What bounds would still save, after the skip: the record walk, about 0.9–1.0 ms per 10k
     subjects on studio (100 ns a subject; a local profile of `glow-` puts the glow's own
     functions at about 30% of the frame). Only a bound the mix can answer without visiting
     each subject saves it: a per-subject test against a radius is the signal call again.
     So the signal bound pays only with a spatial query over the host's positions, kept current
     as they move, and the patch bound is the same query with a radius that changes by phase.
     A reach that changes each frame also moves subjects on and off a voice's chain and lane.
     Measured 2026-10-11 (`bench/reach.sh 6` on teitou and studio, medians of six processes,
     10,000 subjects, 200 in reach; `bench/reachcost.mjs` reads the output). With nothing
     moving, a reach of 200 saves 76–99% of what the glow adds. The calls that move a subject
     cost 0.3–0.9 µs for one leaving and one entering, 200 at a time, and 1–5 µs two at a time,
     not the 100 ns hoped for but small. The frame around them costs far more with lanes on:

     | 200 pairs a frame, probe | teitou K=0 | teitou K=200 | studio K=0 | studio K=200 | full glow (teitou, studio) |
     |---|---:|---:|---:|---:|---:|
     | `part` (fade a subject out, rise it in) | 1.410 | 1.810 | 2.209 | 2.408 | 1.861, 2.806 |
     | `drop` (`mix.drop`, `target` asked again) | 1.393 | 2.881 | 2.142 | 2.928 | 1.861, 2.806 |
     | `own` (a voice cued for each subject) | 1.477 | 2.294 | 2.189 | 2.811 | 1.861, 2.806 |

     (ms, median frame.) So at 200 pairs a frame `drop` and `own` cost more than a glow over
     everything, and `part` keeps 11–51% of the saving. With lanes off every way keeps 34–74%.
     At two pairs a frame the nodes disagree (teitou keeps 10–55% by probe, studio 64–87%), so
     that row is not settled. A frame also allocates 1.9–2.3 MB at 200 pairs against 1.2 MB
     still. Not found: what in the frame costs it. The guess, unrun, is a lane filling its
     columns again whenever a chain is marked stale; the `stale:<K>` rows in `bench/reach.mjs`
     mark K chains stale with nothing entering or leaving to test that, and have run only as a
     local smoke. Bounds are not worth building for a reach that moves every frame until that
     is found.

5. **Work nobody will see** (2026-10-07). Prompted by astv speeding 100 text animations into 2 s,
   most of them offscreen. Three cases; the first is built, the other two wait on a decision.
   - **Offscreen, built**: a lane fills only subjects probed this frame or the last (CHANGELOG
     0.8.0, the schema page's Lanes section). It pays where lanes stay busy over a part
     view: `view`, three `keys` voices with 40% of 10k subjects probed, 0.561 ms a frame from
     0.878 (teitou). It does nothing for astv's shape, the `typing` row: 100 voices of 40 rows
     over 10k rows with 200 probed costs about 0.02 ms a frame either way, because at 2% probed
     every lane already rests. A profile of it (teitou, 20,000 frames) puts about 55% in the
     general path's fold, 11% in lane bookkeeping and 11% in voice clocks. astv's real text runs
     write `last` over row objects, which no lane runs, so this change does not reach them.
   - **Too fast to see — decided: no change** (Mike, 2026-10-07). A voice too brief to affect the
     scene is not shown: one whose whole span falls between two syncs is never sampled mid-way,
     and shows only by freezing after. No jump, no stretch to a minimum number of frames.
   - **Flicker — decided: opt-in only, for now** (Mike, 2026-10-07). Flicker, or protection from it,
     is something a host adds to its own pipeline; blits marks no brightness channels and counts
     nothing on its own. Nothing is built; an opt-in limiter would be a signal or channel wrapper,
     and could warn rather than clamp.
   A reach that changes over time (item 4) is another way to say offscreen.

6. **Color as a value: `color()` is built** (branch `color`, 2026-10-07); the schema page's
   channel section and the CHANGELOG say what it is. Mike chose that the channel picks its lerp
   space (`{ lerp: 'oklab' | 'oklch' }`, OKLab default) after a red-to-cyan render showed OKLab
   washing to pale gray and OKLCH sweeping through the hues between. What is left:
   - `color({ lerp: 'oklch' })` runs off lanes, since a lane lerps a stock channel straight across.
   - **A glow writing `color()` stays on the lanes**: the bench's `glowk` rows are `glowc` with the
     color on `color()`. Medians of six fresh processes on this Mac under a load average of ~10,
     so trust the differences and not the absolute numbers: what the glow adds over `glowbase` fell
     from 3.10 to 1.19 ms through `pull`, and from 1.69 to 1.35 ms through `probe`.
   - **`color(last())` runs on lanes** (OKLab lerp only), as a lane op `'last'`: the band state
     stays on each voice's record for the subject, which the lane already holds, so it moves
     between the lane and the general path for free (`gate` in `src/gather.ts`). A voice writing a
     `last` channel that is a motion, sits in a locus or names one subject keeps the channel off
     lanes, since crowds, motions and loci fold elsewhere (`fits` in `src/hosts.ts`). `hex` and a
     plain `last()` stay off: hex's lerp is not straight across, and `last()` holds anything.
   - **What the `last` lane saves**, measured on teitou (2026-10-07, idle, `bench/again.sh 6`,
     medians of six fresh processes, ms a frame): through `pull`, `glowl^` 1.09 against
     `glowk^` 1.03 and `glowc^` 2.14, over `glowbase^` 0.48; through `probe`, `glowl` 1.60,
     `glowk` 1.70, `glowc` 1.88, over `glowbase` 1.08. So a glow on `color(last())` costs what
     one on `color()` does, and half what a hex glow does through `pull`. What the `last` op
     costs every other lane does not show: `AB_EACH=1 bench/ab.sh f0f9494 HEAD 6` read
     `fn^`, `tweens^`, `weasel^`, `keyses^`, `blend` and `glowc^` within 0.96–1.04×, every row's
     runs overlapping the other side's.

7. **The span vocabulary is picked and settled** (2026-10-07). `span` and `fit` kept their names;
   `fallback` became `spill`, the fits `condense`, `shed`, `conclude`, `overrun`, `pipe` and `lax`,
   the retiming `rescale` (internal), `handle.fitted` became `handle.result` (type `FitResult`) and
   the hint `firm` became `priority` and `skip` became `ballast`; `faster`, `slower` and `overlap`
   kept theirs. `pass` was picked for `skip` first and dropped: it is already public as a number,
   `setting.pass`, the loop pass a voice is in. Shipped in 0.7.0.

9. **The history adapter is built** (2026-10-07, merged to `main`):
   `history.store`, `prepare`, `HistoryMiss`, `keyOf`, `as`/`revive`, `pack`/`unpack`.
   The schema page's "History behind a store" describes it, and the spec section lists the calls
   made in building (state kept by order, `store.cut`, the `stretch` stream). Mike has not reviewed
   the design. astv marked its text-run weight `input` (astv `522624e0`); it now names its mixes,
   describes its voices with `as` and gives a store once it moves to a release with this.

8. **astv's phase on a span.** astv's `scheduleMarks` (`packages/engine/draw/text/changeOrder.ts`)
   is what a `queue` or `stagger` span with a budget replaces. astv is on 0.8.1, which has spans,
   so nothing in blits holds this up.

10. **Two copies of blits loaded together share what each knows of its patches and channels**
    (`773d088`, 2026-10-08): `keys` options and the stock channels' lane facts sit in WeakMaps
    under `Symbol.for` names (`src/shared.ts`), versioned so copies that disagree on a shape keep
    apart; `test/copies.test.ts` loads a second copy of `patch.js`. blits-quarks and blits-tone
    take blits as a peer dependency, `^0.10.0`, on `main` since 2026-10-11 (Mike's call), unreleased
    in both; the range has to be widened with each engine minor.
    A motion patch another copy made runs on lanes too (2026-10-17, unreleased), known by a
    `Symbol.for` getter on the patch's prototype. Chosen while building, Mike's to overturn: the
    mark is named for the release (`release` in `src/shared.ts`, held to `package.json` by
    `test/copies.test.ts`), not a hand-bumped `@1`, because the mix calls a wide, often-changed
    surface of the other copy's `Motions`; so an unreleased checkout and the release it grew from
    wrongly agree. To reverse, name the mark `motions@1` in `src/motion.ts` and drop `release`.
    `@msb235/blits/testing` (`setting`, `checkPatch`) is the authoring kit; the driver scaffold
    the survey proposed is the magicsmoke question in item 1d.

    **`@msb235/blits/lean` leaves lanes out of a bundle** (2026-10-11, unreleased): 44.5 kB
    gzipped against 59.9 for the stock entry (esbuild, minified), the same values, and
    `lanes: true` throws. `test/lean.test.ts` holds both. Not done: the stock path was not timed
    after `Mixer` took its lanes class as a constructor argument; part of `src/crowd.ts` still
    lands in the lean bundle, cause not found; history (9.3 kB gzipped) is reached from 24 places
    in 12 modules and was left in.
11. **`@msb235/blits-tone` 0.1.0 is on npm** (2026-10-11), published by hand from
    `packages/tone` and pinned to engine 0.10.0 with Tone as a peer. Its README says what it is,
    how it works, and what it does not do. Trusted publishing is registered for it, so the next
    version goes out from a `tone-v*` tag, as `quarks-v*` does quarks; that path has not run. Mike
    settled its names on 2026-10-11 (`drive`, `attach`, `detach`, `write`, `cancel`, and the
    options `ahead`, `grid`, `late`, `clock`, `take`, `tag`, `score`). Calls made in building:
    - **Its tests take `node-web-audio-api` as a dev dependency**, a prebuilt native binary of
      about 40 MB, so Tone's offline render runs in Node with no audio device. Mike accepted it
      on 2026-10-11.
    - **`node-web-audio-api` 2.2.0 frees a channel's samples under a live array**
      (2026-10-11): the `Float32Array` from `getChannelData` reads freed memory once its
      `AudioBuffer` is collected. `render` in `test/render.ts` returned such arrays and dropped
      the buffer, so a second render in one test killed the worker with SIGSEGV on the release
      workflow's Linux runner (`clock.test.ts`, 8 runs of 8) and read junk on macOS. `render` now
      copies them. Upstream knows: ircam-ismm/node-web-audio-api issue 80, open since before
      2.2.0, describes the same read. To see it: render an `OfflineAudioContext`, keep only
      the array, call `gc()`, and read it.
    - **`apps/fireworks` plays one mix through this driver and the quarks one** (2026-10-10; its
      README says how). It ran in headless Chromium's `AudioContext` with Tone `Param` targets:
      shells rose and bloomed, a meter on Tone's output showed each bang, and ramping `mix.rate`
      between 0.3 and 2 threw nothing. Nobody has listened to it. What writing it against
      both drivers turned up:
      - Both packages export `drive`, so a file using both aliases them. Kept, 2026-10-11.
      - A booked hit carries its voice's `subjects` now (2026-10-11); fireworks still packs pan
        and size into each event and could read them off the shell.
      - **A subject binds one `Target` per channel, and that stays** (Mike, 2026-10-11). Each
        rising shell borrows an oscillator from the app's own pool, and one launched with the
        pool empty has no whistle. A host that wants every subject heard builds a synth per
        subject and attaches it; the driver's README says so.
    Undecided, and what would close the README's gaps:
    - A read of the mix over a window, returning a run of values or a `keys` voice's own
      breakpoints as exact ramps, in place of a `project` per grid point (31 a write, and only
      as exact as the grid). Useful beyond audio.
    - Mix time converted to the outside clock while `mix.rate` ramps; the driver reads
      `mix.rate` as it stands at each write, which drifts during a ramp (3.59 Hz in its test).
    - Scrubbing works against the engine's source: after a seek back under `history`, `write`
      reads through a recorded call (`packages/tone/test/driver.test.ts`, 2026-10-11), where
      `project` threw and `write` with it. blits-tone on npm is pinned to 0.10.0, which still
      throws; its README's "Scrubbing" line goes when it is pinned to the next engine.

12. **What the docs audit left** (2026-10-10). The schema page's interface listings now carry
    every public member, and the page and README cover what the audit found missing.
    - **A voice cued before the mix's first sync starts at 0 on the host's clock, not at that
      sync** (measured 2026-10-11): a one-pass 1 s voice cued before `sync(5000)` has ended
      when it is first probed. `VoiceSpec.start` said "Default: the next sync" and now says
      what happens. Whether it should start at the first sync instead is Mike's call; a page
      that cues before its first `requestAnimationFrame` meets it.
    - **Not checked**: the page's timings and its table of consumers' kits, which are other
      repos' facts, and the playground README's gestures against the widget code.

13. **The playground should offer everything in blits it feasibly can** (Mike, 2026-10-09). Built
    2026-10-09: `wave`; every ease (`keys` `ease`, `easeBy`, `delayBy`, `fade.ease`, a tween's bezier
    and steps); the live panel's `fade` options, `rise`, `rate` setter and `seek`'s `Doubt`; the
    mix options `stepMs`, `maxDt`, `reduce` and `lanes`; the mix's own `rate`; scrubbing by
    `mix.seek` with `assess` per channel; each channel's fold rule; and owners and spans (`owns`,
    `owner`, `span` with its hints, every fit step and a code fit over `plain` and `layout`,
    `FitResult`), drawn as header lanes on the score. Built 2026-10-10, each with a preset:
    `mix.blend` (a locus cued as one blend by a signal); marks, hits, and events (an Events tab
    with `marks`, `announce`, `book`, and `drain`, a voice's `tags`, `score`, and hits, and any
    anchor typed as JSON); and a cue's `seek` with a rate below 0. What that left:
    - Groups take no `tags`, `score`, hits, `seek`, or negative rate.
    - **Chosen while building, Mike's to overturn** (2026-10-17, the score's joined links, a
      partway clip's right edge, and the booker's read-ahead):
      - A join or query anchor draws a dotted link from each voice `timingOf` says it could
        wait on: close dots for `all`, wide for `any` or a query, and a query inside an `all`
        counts as `any`. To change the look, edit `.linkAll`/`.linkAny` in
        `ScoreLanes.module.css`; to drop them, remove `joinedLinks` in `score.ts`.
      - A query that also names (`{ name, tag }`) now draws as a query, not a dashed link to
        that name, so the score agrees with the Timing tab. `targetOf` in `score.ts` holds it.
      - A partway clip's right edge snaps to what each whole `loop` leaves (`stopsOf` in
        `clip.ts`), and the edit sets the fewest loops that leave that much; backward with a
        `seek`, the edge stops at the seek. Reverse by restoring the `startsPartway` early return
        in `score.ts`'s `passes` case.
      - The read-ahead is saved in the composition as `book.ahead`, 0 to `MAX_AHEAD` (5000 ms),
        while the book-and-drain tag stays per-session on the `EventLog`. Moving the tag to
        `book.tag` would save and share it too.
    Not worth offering: `mixer`/`Engine` (one engine), `as`, the color helpers, history paging
    without a store, and `ticker`, which would change only how the playground drives its frames.

14. **What the 2026-10-09 code review left.** The review is the doc "blits code review,
    2026-10-09" (https://claude.ai/code/artifact/e73a612c-4d44-462b-b471-d3d6e1829db5), with its
    findings numbered there. Its whole plan is built and shipped as 0.8.0; the changelog's 0.8.0
    section says what changed, and this item holds only what is still open. Measure any hot-path
    change with `AB_EACH=1 bench/ab.sh <origin/main sha> . <rounds> <rows>` on a fleet node (`.`
    is the synced working tree, and the first revision has to be one `origin` has);
    `AB_BENCH=bench/frame.mjs` makes both sides print `kB/frame`, `bench/medians.mjs <output>`
    reduces a run to medians, and `bench/allocs.mjs <row>` lists the functions that allocate.
    - **Mike has not seen two things chosen while building.**
      - **A probe into `out` reuses its arrays, which reverses a guarantee a test held.**
        `test/solo.test.ts` said a reused `out` "never has an array the host kept from it written
        into"; it now says the array is the same one, and that a probe with no `out` is never
        written into. To undo it, drop the two reuse branches (`foldWith` in `fold.ts`, `copy` in
        `copyout.ts`): the `tween` row then allocates about 0.7 MB a frame again. No consumer is
        caught by it (read 2026-10-10): klieg's two `poseAt` callers read the numbers out at
        once, and weasel's `poseOverrides.ts` and astv's six sites have no vec or color channel.
      - **Step 7's names and shapes**: the type `Vec<N>`; `angle({ turn })` with `turn`
        defaulting to 360; `input(read, of?)`, whose `touch()` reports a change; a keys patch's
        options as the flat fields `ease`, `easeBy`, `delayBy` and `lerpBy`, and a wave's as
        `patch.wave`, with `waveOptionsOf` removed; `handle.to` and `push` throwing for a patch
        that takes neither, and `read` giving undefined; and `fold` switching a rest-less channel
        on at 0.6, a mix's default band. All of it shipped in 0.8.0, so a rename is now a break.
    - **A key `at` returns outside `writes` is warned of** (2026-10-17, unreleased). Chosen while
      building, Mike's to overturn: a `warnOnce` per patch outside production, as a placement
      ending before its start already does, over a fault count the host reads, which blits has no
      pattern for; and only the first delta each voice's `at` returns is checked, in
      `contribution` (`src/fold.ts`), which makes every voice's first call, so the lanes' fills
      check nothing. Per frame that is one boolean read per `fn` call on the general path, which
      reads level (msb-uai, 2026-10-17, 10 rounds, `AB_EACH=1 bench/ab.sh da301d9 650b3e9` over
      `fn` and `named`, geometric mean 0.992, every row within 0.96–1.02). To
      reverse, drop `checkWrites` and `unchecked` from `src/voice.ts` and the line calling it.
    - **Undecided behavior, as found** (the fuzzers' or the build's account of each):
      - **Backward play is built (2026-10-10); the schema page's "Starting partway, and playing
        backward" is the record, and its last sentence lists what is not built.** Mike's calls:
        a valid use is not refused because no consumer has it yet; a cue takes `seek`; blank,
        a voice cued backward starts at its end. Chosen while building, his to overturn: a
        fade in counts from no earlier than the voice's start (so `seek` does not use it up),
        and a voice with no end cued backward has no first pass, a property of the cue and
        not of the rate it has later. A voice fading from its start, one with no first pass,
        and one faded before it started run off lanes. Timed with everything else since
        `da6e613` (teitou, 2026-10-10, 7 rounds, `e51cd85` against `da6e613`, 14 rows over
        `fn`, `named`, `probed`, `blend`, `keys`, and `typing`, geometric mean 1.011): every
        row's runs overlap the other side's but `blend`.
      - **`blend` reads about 5% slower at `e51cd85` than at `da6e613`, and no one commit
        shows it** (teitou, 2026-10-10, `AB_EACH=1 bench/ab.sh` over `blend` alone, 7 rounds at
        5,000 frames, medians in ms a frame). The whole range: 2.937 to 3.105, 1.057, the runs
        apart but for one. Against `da6e613` each time: `ed0eab9` 2.945 to 2.949, `717a5be`
        2.940 to 2.943, `0937ca1` 2.946 to 2.955, `2f2fb10` 2.945 to 3.161 with another job
        disturbing that last pair. Step by step: `0937ca1` to `64a5860` 0.990, `64a5860` to
        `2f2fb10` 0.978, `2f2fb10` to `e51cd85` 1.021, every pair's runs overlapping. So it
        is level through `0937ca1`, which clears the `setting.dt` fix, and arrives after it in
        steps smaller than the 3% a pair of runs resolves. A CPU profile at each end
        (`bench/profab.sh da6e613 e51cd85 blend`, teitou, 2026-10-11, one run a side at 5,000
        frames, 2.974 and 3.110 ms) names no function: every share is within a point of the
        other side's, so the 0.136 ms is spread over `call`, `foldWith`, `foldLocus`, and
        `gatherLocus` at 0.02 to 0.03 ms each, none of which changed in the range. What `one`
        gained there, its `unband` at weight 0 for the member a blend leaves out, is 0.7% of
        the later profile, about 0.02 ms. That reads as V8 laying out or inlining the same code
        differently, which `--trace-turbo-inlining` on both builds would confirm or rule out.
      - **A projection's copy keeps no `owners` list**, so `lapse` never runs on one. Run
        2026-10-10 and no pose was found to depend on it: a read ahead of nested spans, fitted
        by `pipe` and by `lax`, with an anchor after the outer one, matched the same scene
        synced frame by frame, since a child and an anchor are placed from a span's budget
        whether or not the span has left. A copy given the list read the same. A child retimed
        by `faster` did read apart from the synced mix, which was the mix's fault and is fixed
        (the changelog's 0.9.0 section; `test/span.test.ts`).
      - **A voice whose owner runs backward now leaves over its fade out** (2026-10-11; the
        changelog's 0.9.0 section, `test/backward.test.ts`). Chosen while fixing it, Mike's
        to overturn: an owner run back to its start stays while it holds a child and leaves
        with its last, where it left at its own start and took them all. Left as found: such
        a child's `start` and `in` marks read where the owner's clock will next read the
        child's start (400 for an owner turned back at 200), as any retime of an owner moves
        them; and a child that itself runs backward under a backward owner, forward overall,
        has no test.
    - **Not built**, and nothing recorded against any of it:
      - Records shared by a read back or a standing read, and by voices `shares` (in
        `everyone.ts`) turns away that could keep their difference by subject number too: a
        stagger, a signal weight, a motion.
      - `catchUp: 'fresh'` per voice; exact catch-up is the default, and a voice keeps at most
        256 past clocks.
      - `seek({ frame })`, for an earlier frame at the same mix time.
      - magicsmoke's faults could share one mix now that a voice has its own `stepMs`;
        magicsmoke still makes one per fault.
      - A read back with no history beyond the narrow case in `src/standing.ts`: a voice an
        anchor places, an owner and what it holds, and a voice whose handle was written to are
        refused because the fuzzer (`standing` in `test/fuzz/program.ts`) found frames that
        depended on when a sync noticed a change. Each could be let in with the fuzzer's say-so.
      - A view type per module (a `Pick` of `Mixer` for each of the 13 modules taking under ten
        members) was weighed and left, since it would name what each reads without stopping
        anything. Still assigned from several modules: `frame`, `reducedNow`, `relinks`, `pins`,
        `gone`, `pose` and `retired`. `test/owners.test.ts` reads assignments by name, so a
        `push` or `splice` gets past it.
      - A quat in a keys voice or a motion goes through `foldInto` per subject, a crowd's keys
        row on an angle or quat reads its voice's stops and not `KeyRows`, and a vec of angles
        and a `color` over one stay off lanes.
    - **Measured, and where it stands:**
      - **The laned steady rows read level as merged** (teitou, 2026-10-10, 7 rounds at 3,000
        frames against `27acb2d`): `keys` 10k×3 0.953, `tween` 1.023, `fn` 1.027, geometric
        mean 1.001, every row's runs overlapping the other side's.
      - **The `keys` row's 16 B a probe is the lane's scalar copied into the pose**
        (found 2026-10-11): `pose[ch.name] = ch.values[slot]` in `src/copyout.ts`, which a heap
        profile charges to `foldWith` because V8 inlines it there. The value comes out of a
        Float64Array as a raw double and the store is keyed by a name that varies, so V8
        boxes it in a new HeapNumber each time. Measured on the row's scene at 10,000 subjects
        (this Mac, `total_allocated_bytes` over 300 frames): 16.6 B a probe as it stands, 0.9
        with the store skipped once the field holds a number, 0.4 storing an integer, and 16.6
        to 17.0 whatever shape the host's `out` starts with. Built and backed out for changing
        nothing, on top of the two guesses before (a site of its own per scalar channel in
        `copy`, and folding a delta's number where `foldDelta` reads it): a store site per lane
        position. What is left is a store V8 can see the field of, which means a function
        made per kit from source text, or reading through `pull`, which never boxes.
        Still boxed:
        a locus's `gatherInto`, a crowd's `KeyRows.fold`, and what `host.signal` returns. Under
        `from: 'current'`, `keep` still copies a pose a probe into `out`.
      - **Tried and backed out for moving no number**: growing a lane's arrays to the number of
        subjects probed last frame at its first position, and handing `LaneHost.ready` its
        numbers through `Lanes.arg`.
      - **`kB/frame` on a row whose patch returns an object a call reads one of two values from
        run to run on one build**: `fn` 10k×3 read 2,442 or 4,318 on this machine. Take a row's
        allocation from a median over rounds on a fleet node, never from one local run.
      - **A lane switching a band off at weight 0 costs the `glowl` rows about 3%** and nothing
        else (teitou, 2026-10-10, 7 rounds at 3,000 frames against `da6e613`, 19 rows, geometric
        mean 1.003): `glowl` 1.680 to 1.736 ms, `glowl^` 1.201 to 1.236. `unband` fills the
        record's bands for every subject at weight 0 every frame. Filling only on the frame the
        weight reaches 0 (a flag on the record) read bit for bit the same and moved no number,
        so it was backed out: `glowl` 2.359 to 2.393 ms and `glowl^` 1.680 to 1.691 (msb-uai,
        2026-10-10, 7 rounds at 3,000 frames against `350991c`, every row's runs overlapping,
        on a node whose runs spread 6% to 14%). So the repeat fill is not shown to be the cost.
      - **A seek back and its return cost about 20 ms at 10,000 subjects, most of it copying
        records** (msb-uai, 2026-10-11, `AB_EACH=1 bench/ab.sh 657f3f2 . 9`, medians, ms a
        frame). The `kept` rows sync and probe a mix keeping 5 s of history and a tape; the
        `seek` rows also seek it 300 ms back and to where it was before every sync.

        | Subjects | `kept` | `seek` | A seek back and return | `seek` on `657f3f2` |
        |---:|---:|---:|---:|---:|
        |  1,000 | 0.666 |  1.785 |  1.119 |  2.961 |
        | 10,000 | 6.810 | 27.385 | 20.575 | 38.793 |

        Before `1b72ed9` the row's cost grew with every frame: a seek lets go of the copies
        made after the moment it sought, so each subject stepped from the copy before the
        first seek, 70 steps at the first frame and 1,069 at the 300th (`bench/steps.mjs`),
        and 1,200 frames ran at 80 to 118 ms a frame against 29 now (teitou). The copy a
        record is put back from now keeps its state stepped ahead to near the moment sought
        (`ahead` in `src/fold.ts`), under `stepMs` with no `maxDt` for a patch that `reads`
        no host field, and a subject steps 67 to 74 times a frame. A profile of `seek` at
        10,000 (600 frames, teitou) now puts 25% in `copyHeld`, 20% in collection, 3% in
        `tick` and 2% in the row's `step`: a subject's record is copied twice a frame, once
        put back and once kept at the probe, and the kept one is let go by the next seek.
        The row allocates 34.9 MB a frame against 9.3 for `kept`. The lever left is those
        copies and the generic `clone` of the state. Reasoned and untested: a `step` that
        reads `setting.weight`, `elapsed` or `pass` can give different bits after repeated
        seeks, since steps taken up from the copy ran under an earlier probe's setting.
      - **A subject sought back before its start with `state: 'keep'` shows state that depends on
        when it was last probed** (found 2026-10-11, not fixed). `contribution` in `src/fold.ts`
        does not step a subject before its start, so one a kept seek moves back there holds the
        steps its last probe ran: with no history and no mix seek, a mix probed every frame
        showed 80 steps and one probed every fourth frame 70. A record a mix seek puts back holds
        its copy's steps instead, so a mix sought back before every frame differs from one never
        sought until the delay runs out again: 5 of the 120 scenes that found a copy's stale
        start (fixed in `214909d`), each a kept seek made after the delay ran out on a voice with
        `freeze: 'before'`. Fixing it means choosing what that pose should be. Seen once and not
        chased: under a mix rate of 0.5 the same loop left the next sync's `now` an ulp off.
        `SAME_WAIT=1` in `bench/same.mjs` makes scenes of this shape.
      - **The fleet's copy of blits has a stale `node_modules`** (found 2026-10-11): its
        `@weasel-js/history` has no `timestampAt`, so the bench's `kept` and `seek` rows fail
        there until a job installs afresh.
      - **Two changes in the lanes-under-seeks fix (`3fd3eac`) await a yes or a reversal**
        (2026-10-11). `weightOf` reads 0 after a seek back until the subject is probed again,
        and a write to the handle of a voice waiting for its cue after a seek back is ignored
        where it used to branch the tape. Both sit under Fixed in the changelog; the second may
        belong under Breaking.
      - **The stale-start fix (`214909d`) has no clean timing** (2026-10-11): three rounds on a
        busy orochi moved the `kept` and `seek` rows up to 24% both ways. Rerun those rows with
        `AB_EACH=1 bench/ab.sh` on an idle node.
      - **A mix seek hangs on one scene** (found 2026-10-11, not fixed):
        `SAME_SEEK=1 SAME_RATE=1 SAME_OWNS=1 node bench/same.mjs <dist> <dist> 1 72600` never
        returns, with lanes on or off; its last calls are a `mute` and a seek 300 ms back in a
        scene that ramps the mix's rate to 0. Lanes on and off otherwise read the same through
        seeks (about 18,500 scenes, and 2,000 in `test/differential.test.ts`), and
        `SAME_SHRINK=1` reduces a scene that differs.
      - **A subject faded out of a voice that never met it, then dropped, stays out after a seek
        or read back to before the fade** (found 2026-10-11, measured on both paths, not fixed).
        The leaving record would have to carry when the subject parted, which changes the paged
        `left` format. Reasoned, not run: by the same loss a seek back into a ramp after a drop
        finds the ramp when it should not.
      - **`weightOf` for a subject only ever read through `project` differs by path** (found
        2026-10-11, not fixed, no seeks involved):
        `SAME_LANES=off node bench/same.mjs <dist> <dist> 1 1054` gives 0.9355 on the general
        path and 0 on lanes.
    - **Few consumers use step 7 yet.** klieg's `level` is built on `input` with a `touch()` in
      its `set` (klieg `c32d440`, unreleased); whether its level-weighted voices then run on
      lanes is not checked. The other workarounds the doc's "Universal applicability" table
      lists are still in klieg, sherpa, weasel and wod, and in `apps/playground` (`LivePanel`'s
      cast, `expr.ts`'s flag).
15. **0.8.0 costs more a frame than 0.7.1 under `history`; fixed in 0.8.1**
    (2026-10-10). astv's `packages/engine/playback/motion.bench.ts` showed it: text runs +36% to
    +47%, its busy stage +13%. A bisect with that bench found two commits, `c40e2bc` (a sync
    spliced the oldest frame off the list of every frame in reach) and `0d1fb48` (a contribution's
    object was deep-copied each frame on a channel nothing folds into). `src/frames.ts` and
    `first` in `src/clone.ts` are the fixes, and astv measured every regressed row back within 3%
    of 0.7.1 on msb-uai; the changelog's 0.8.1 section has the numbers. Left unexplained, at
    1 to 2 µs a frame with runs that disagree: astv's glides (+8%) and progress clocks (+39%).
    To measure a blits build against astv's bench: `MOTION_ONLY=1 probes/blits-version-bench.sh
    <out dir> 0.7.1` in `~/src/astv` on a fleet node.
16. **`setting.dt` for a patch with no `step` is fixed** (2026-10-10; the changelog's 0.9.0
    section, `test/dt.test.ts`). Mike chose the gap since the subject was last sampled over the
    gap since the last sync. What it left:
    - **A read ahead or back still rates such a patch `exact`, left so by Mike (2026-10-10)**,
      though the `dt` it hands is one sample's gap and not what frame-by-frame play hands.
      Rating it `stepped` needs the mix to know the patch read `dt`, which means a getter on the
      setting, untimed. Reopen it if a host scrubs a patch that reads `dt` and sees it jump.
    - **The first `dt` after a voice stops sharing its record counts from the subject's origin**,
      since each subject's own record starts fresh (`unshare` in `everyone.ts`).
    - klieg's `it.fails` test for this (klieg `TODO.md`) should pass on the next blits release.
    - **Timed level** (msb-uai, 2026-10-10, 7 rounds at 3,000 frames against `da6e613`, 17 rows
      over `fn`, `named`, `probed`, `blend`, `glowl`, `keys`, and `typing`, geometric mean 0.998),
      but `blend` allocated 3,441 kB a frame from 2,974: the write to `stepped` was boxed. Making
      the field a double from the start (`record.ts`) took it back: 2,982 on teitou at `e51cd85`
      against 2,974 at `da6e613` (medians of 7 rounds).

## Loose ends

- **Rows run earlier in one process change a later row's numbers.** Traced 2026-10-04 to the
  100k-subject `tweens` row: `fns^` reads about 117 ns a subject alone, 79 after the 10k
  `tweens` row and 214 after the 100k one (teitou). A dropped mix is freed
  (`bench/memory.mjs`), so it is the heap that row grew, not a leak. `AB_EACH=1 bench/ab.sh`
  runs each row in a process of its own.

- **A host editing a pose the mix allocated changes what `from: 'current'` reads.** `probe`
  without `out` keeps the pose it returns as the subject's last, by reference, so a held voice at
  `[10]` whose pose the host set to `[500]` was retargeted from 500 (checked 2026-10-04). Whether
  that is wrong is undecided: it is what the host showed, and copying would cost every probe
  without `out` an allocation.

- **A stale served-page tab overwrote `vocabulary.picks.json` four times**, most recently three
  times on 2026-10-07: the page kept its own picks in the browser and posted them whole on every
  click. semanticore `0c1df0c` posts only the roles a change touched. Until every browser that had
  the page open has reloaded on that build, `git diff` the picks file before trusting it.