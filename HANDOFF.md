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

- `main` at `git@github.com:orochi235/blits.git` — **public**; release 0.7.1 (2026-10-08).
- **The score and reading back shipped in 0.3.0**, merged from `project` with lanes, `pull` and
  blits-quarks (2026-10-02). `mix.project(t)` with `probe`/`assess`, `MixOptions.history` (control
  log, departed voices, state copies, recorded inputs and host fields), placements by anchor with
  names, scores and queries, `mix.marks`, motion history in `spring`/`glide`, and the site's Score
  page. The schema page's Score section describes it; `CHANGELOG.md` has it under 0.3.0. One
  behavior change rides along: a finite loop's fade starts when its last pass ended, not at the
  next frame.
- **klieg's port is merged into klieg's `main`** (2026-10-02), and its step two shipped in klieg
  0.15.0 (merge `77d537d`, 2026-10-05). klieg 0.16.0 pins `@msb235/blits` `0.5.0` exactly in
  `packages/core/package.json` and reads `setting.host` through `mix<I, O, H>`.
- **sherpa is on blits 0.5.0 (exact) and klieg `^0.16.0`** (2026-10-05), with one deduped blits
  copy. Its seams run on a blits mix, and its klieg pages hold on clicks and stages through
  `dismiss: 'host'` and `advance()`, paced on klieg's `active` and `stage` marks. All three systems fold through a mix: `Timeline.poseAt`
  cues a voice per layer of each phase, `EffectFrame` one per effect, and the sign's environment is
  a mix with one subject. The arithmetic did not move: klieg's 1974 vitest cases pass on the fleet,
  and its Playwright specs fail exactly the five they already failed before the port, to the pixel
  (recorded in klieg's changelog). 0.3.0 needed no change in klieg: its `color` channel is a `hex`,
  but every effect voice plays at full weight with no locus, so the OKLCH blend is never taken. The
  schema page's klieg section says what the port found.
- **The package, `@msb235/blits` 0.6.0 on npm.** `src/` is the whole of it: `channels.ts` (the stock
  channels, `kit`, `hex`/`mixHex`, `bounds`), `easing.ts` (easing as data resolved to a curve), `patch.ts` (`patch`, `keys`,
  and the stops built once per channel that `from: 'current'` reuses),
  `motion.ts` (`spring`, `glide`), `tweened.ts` (a tween's closed form, in pieces a fill calls), `clock.ts` (the phase, envelope and weight clamp both fold
  paths share), `numbers.ts` (numbers subjects), `signals.ts` (`peak`, `slew`, `lag`, `level`, `gate`), `store.ts` (per-subject storage, WeakMap for
  objects and a Map for anything else), `types.ts` (the whole public surface, doc-commented). The
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
  out, and the name `freeze` once the ticker's `hold()` took the word; `hold` stays a deprecated
  alias, and the state is `'frozen'`. wod (`anglePatch.ts`, `transition/tracks.ts`'s `'held'`) and
  klieg (`compositor.ts`) change when they move past 0.5.0.
- **`mix.inert` shipped in 0.4.0** (built 2026-10-03, merge `3228fa7`), for wod's frame loop to
  sleep under a landed wheel while `live` stays true. Mike asked for it and named it through the wod
  session; the CHANGELOG entry and the schema page's `Mix` block say what counts as inert. wod's
  migration (`~/src/wod/docs/superpowers/specs/2026-10-03-blits-migration-design.md`) is built
  through its last phase, editor scrub (merge `06ef87d`, 2026-10-04), pinned to 0.4.0.
- **The site, `site/`**, built 2026-09-30: an Astro workspace with a live explainer per word and
  the API reference from the doc comments. `site/README.md` says how it works; `npm run site:smoke`
  is green on all 13 pages. Deployed to `michaelbaker.tech/blits/` by `.github/workflows/site.yml` on every push to `main`.
  Every explainer draws a stage of what its mix drives above its chart (2026-10-04). Open: the pages
  don't fit a phone, since a 390 px viewport lays out about 640 px wide, and the score's text voice
  ends the moment it finishes typing, so the line vanishes as the tint comes in. When labkit releases `f.number().endless(word)` (weasel `2432ce316`,
  unreleased on 2026-10-04), switch the sliders whose right end means never to it:
  Score's `cut`, Mix's `muteAt` and Voice's `fadeAt` with `'never'`, and State's `cap` with
  `'uncapped'`. Their readouts show the number until then.
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

- **The playground's diagrams, after view A.** View A, the signal flow, is built; the playground's
  README ("The flow") describes it. Next, each with a spec of its own when it starts:

  | | View | Answers |
  |---|---|---|
  | B | Timing graph: voices linked by `anchor`, `all`/`any` joins and spans, `locus` groups as containers | what waits on what |
  | C | A and B together, as two views of one composition or one diagram with both kinds of edge | both |
  | D | Editable: dragging port to port authors an anchor, or wires a weight to a signal | the diagram as an input |

  Also wanted, unscheduled: a mixer-desk drawing of A, each channel a horizontal bus ending in its
  rule and each voice a vertical strip tapping the buses it writes. `flowOf` builds the graph from
  the playground's `Composition`; once the UI settles, a public `describe()` on `Mix` should make
  the same shape for any host, and `flowOf` becomes a thin adapter.

  The playground is on weasel 1.9.2, which widens `diagramScene` (per-box outline, rows, ports,
  padding/gap, pinned and min size; per-edge ports, router, waypoints, dash and markers; layout by
  name) and makes `DiagramView` editable, which view D needs: `onMove` reports dragged nodes,
  `onConnect` reports a port-to-port edge for the host to add, `canConnect` and `portOptions`
  configure ports, and a ref runs `layout()`. New specs reconcile instead of remounting.
  1.9.2 does not carry the fix that stops a view-only `DiagramView` claiming the space bar page-wide
  (weasel `975c1542e`, on its `diagram-scene-knobs` branch), so the playground's capture-phase space
  listener in `App.tsx` stays. Once a release carries it, drop the listener only if every weasel
  canvas on the page is view-only; the Voice tab's `Timeline` probably is not. weasel's
  `docs/TODO.md` holds the general fix, "A canvas's keyboard shortcuts claim keys page-wide".
  On 1.9.2 the flow diagram's labels render in Times: weasel quoted `sans-serif` as a family name.
  Fixed in weasel `6a1afa10e` (unreleased as of 2026-10-09); the next weasel bump picks it up.
  Still missing, and blocking view B: container nodes for `locus` groups, weasel `docs/TODO.md`,
  "(P2) Diagram groups".

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
  `Patch.period` stays as a deprecated alias, set on every built patch and read by `durationOf`
  where a patch sets only it. Removing the alias is a later breaking release.
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
  deleted; on magicsmoke's `main` since 0.5.0, pinned to `@msb235/blits` `0.6.0` since 2026-10-05): `lag`,
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

1. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits: the allocation still
   in the hot path. Delete each item as it is dealt with, and
   the file once it is empty. Its speed items matter only if weasel adopts blits: klieg and
   magicsmoke are expected to run about two dozen voices over tens of subjects, under 1,000 subject
   × voice pairs, where a frame costs about 0.2 ms (2026-10-01 guess, not a measured
   workload). `NOTES-ON-SCRUBBING.md` holds the one unbuilt reading-back item:
   a read ahead after a seek back plays what is cued, not what the tape recorded.

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
     asleep). `CHANGELOG.md`'s Unreleased section lists what landed, with numbers: crowds of
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
     public read into an out object. Left: rerun weasel's `tests/perf/bench/timeline-sampling.bench.ts`
     against it.
   - `turnover^` reads two ways on identical code (0.43–0.46 or 0.48–0.54 ms by process): six
     runs a side at least.

1d. **`@msb235/blits-quarks` 0.3.1 is on npm**, pinned to engine 0.7.1 and published from its
   `quarks-v0.3.1` tag (0.1.0 went out by hand, because npm refuses trust for a name never
   published). Its README says how it works. magicsmoke is on engine 0.6.0 (`08d27df`, not
   pushed) but its fizz and tuning stay on its own code: the driver doesn't fit without changing
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
     A reach that changes each frame also moves subjects on and off a voice's chain and lane,
     a cost nobody has measured. Measure that relink before building; if it is near 100 ns a
     subject entering or leaving, a 2% glow saves nearly all of the 1 ms.

5. **Work nobody will see** (2026-10-07). Prompted by astv speeding 100 text animations into 2 s,
   most of them offscreen. Three cases; the first is built, the other two wait on a decision.
   - **Offscreen, built**: a lane fills only subjects probed this frame or the last (CHANGELOG
     Unreleased, the schema page's Lanes section). It pays where lanes stay busy over a part
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
   - **klieg moves to `color(last(), { lerp: 'oklch' })`** when it next bumps blits; filed in
     klieg's `TODO.md` (`84c3f8f`).
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
   is what a `queue` or `stagger` span with a budget replaces; astv pins blits 0.4.0, so this waits
   on a release.

10. **Two copies of blits loaded together share what each knows of its patches and channels**
    (`773d088`, 2026-10-08): `keys` options and the stock channels' lane facts sit in WeakMaps
    under `Symbol.for` names (`src/shared.ts`), versioned so copies that disagree on a shape keep
    apart; `test/copies.test.ts` loads a second copy of `patch.js`. Open, Mike's call: whether
    adapter packages, blits-quarks first, take blits as a `peerDependency` instead of pinning it.
    A spring made by another copy is not recognized as a motion (`instanceof MotionPatch` in
    `src/motion.ts`), so it plays through `at` off the lanes; it reads the same, untested for speed.
    `@msb235/blits/testing` (`setting`, `checkPatch`) is the authoring kit; the driver scaffold
    the survey proposed is the magicsmoke question in item 1d.

11. **A Tone.js adapter, and the windowed read it wants** (spiked 2026-10-08, undecided). The
    spike in `spikes/tone/` showed a mix driving Tone on the audio clock through `project` and
    `book` alone: booked notes land on the sample through a rate change and a seek, and curves
    stay within 0.671 Hz on a 5 ms grid, against 71.938 Hz for a host writing values each frame.
    Its README has the table and the gaps. Two things to decide and build:
    - Whether the adapter becomes a package beside blits-quarks.
    - A read of the mix over a window, returning a run of values or a `keys` voice's own
      breakpoints as exact ramps, in place of a `project` per grid point (31 a frame, about
      0.23 ms, and only as exact as the grid). Useful beyond audio.
    It would also need mix time converted to the outside clock when `mix.rate` is not 1, and
    scrubbing waits on the read-ahead item in `NOTES-ON-SCRUBBING.md`.

12. **A full docs and comments audit, once the fixes from the 2026-10-09 code review land.**
    Every doc comment in `src/` (the site's API reference is generated from them),
    `docs/schema.html`, the README, and the playground README are checked against the code as it
    then stands. Stale claims are corrected, and comments that fail the comment bar are cut.

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