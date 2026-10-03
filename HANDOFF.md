# Handoff — blits, 2026-10-02

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
once, so klieg, wod, sherpa and magicsmoke can share one vocabulary and one engine. **klieg's three
systems now run on it**, on klieg's `main`.

## State

- `main` at `git@github.com:orochi235/blits.git` — **private**; release 0.3.0 (2026-10-02).
- **The score and reading back shipped in 0.3.0**, merged from `project` with lanes, `pull` and
  blits-quarks (2026-10-02). `mix.project(t)` with `probe`/`assess`, `MixOptions.history` (control
  log, departed voices, state copies, recorded inputs and host fields), placements by anchor with
  names, scores and queries, `mix.marks`, motion history in `spring`/`glide`, and the site's Score
  page. The schema page's Score section describes it; `CHANGELOG.md` has it under 0.3.0. One
  behavior change rides along: a finite loop's fade starts when its last pass ended, not at the
  next frame.
- **klieg's port is merged into klieg's `main`** (2026-10-02), pinned to `@msb235/blits` `0.3.0`
  exactly in `packages/core/package.json`. All three systems fold through a mix: `Timeline.poseAt`
  cues a voice per layer of each phase, `EffectFrame` one per effect, and the sign's environment is
  a mix with one subject. The arithmetic did not move: klieg's 1974 vitest cases pass on the fleet,
  and its Playwright specs fail exactly the five they already failed before the port, to the pixel
  (recorded in klieg's changelog). 0.3.0 needed no change in klieg: its `color` channel is a `hex`,
  but every effect voice plays at full weight with no locus, so the OKLCH blend is never taken. The
  schema page's klieg section says what the port found.
- **The package, `@msb235/blits` 0.3.0 on npm.** `src/` is the whole of it: `channels.ts` (the stock
  channels, `kit`, `hex`/`mixHex`, `bounds`), `easing.ts` (easing as data resolved to a curve), `patch.ts` (`patch`, `keys`,
  and the stops built once per channel that `from: 'current'` reuses),
  `motion.ts` (`spring`, `glide`), `lanes.ts` (lanes, with `clock.ts`, the phase,
  envelope and weight clamp both fold paths share, and `numbers.ts`, which numbers subjects), `signals.ts` (`peak`, `slew`, `lag`, `level`, `gate`), `store.ts` (per-subject storage, WeakMap for
  objects and a Map for anything else), `mixer.ts` (the engine and `mix`), `types.ts` (the whole
  public surface, doc-commented). Zero runtime deps, ESM, vitest, biome as klieg. `npm run check`
  is lint, typecheck of both `src` and `test`, then the suite, green. `npm run bench`
  (`bench/frame.mjs`) measures a frame at scene sizes, GC counts included. Enlisted for the fleet — `.onto/tests` is
  `plugin: node`, `run: npm test`, `runner: vitest` — and green there too.
- **The site, `site/`**, built 2026-09-30: an Astro workspace with a live explainer per word and
  the API reference from the doc comments. `site/README.md` says how it works; `npm run site:smoke`
  is green on all 13 pages. Local only; `.github/workflows/site.yml` deploys to Pages by hand.
- `docs/schema.html` — the design: vocabulary, channel table, patches, voices, mix,
  signals, time model, blending, patch state, the engine seam, per-consumer rigs, the klieg port,
  decided-against, tests, open items. Status line says design under review. It reads in the called
  words; klieg's own `offset` channel, the arithmetic `add`, a `keys` patch's `stops` and the patch
  callback `step` are deliberately unrenamed.
- **The spec self-review has been done and its findings fixed** (2026-09-27). What the review
  changed, so nobody re-derives it: `sync`, `step` and `Setting.dt` now say that nothing advances
  at the call and each subject catches up by its own whole gap; `mix.mute` takes `over` like
  `handle.fade`; `duration` is `period` and `t` is `phase`, 0..1 across the period; `pose`,
  `influence`, `setting`, `period`, `phase`, `system`, `source` and `score` are defined in the
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
  cd ~/src/semanticore && node bin/semanticore.js check <job>   # 20-word rule, placeholders
  node bin/semanticore.js serve ~/src/blits/docs/vocabulary.json --port 4871
  ```

  Pinned to semanticore `7dac96e`. The built page is not committed here; `serve` rebuilds on every
  edit and adds undo/redo, snapshots, cross-off and chat, none of which the hand page had.

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
  earns it. Said about `domain`, which klieg's tube gradient uses for something else. Do the rename
  inside the port, not ahead of it.
- **`phase`** is the fixed name for the normalized position within a period, formerly `t`. It costs
  renaming klieg's `onPhase` and `PhaseEvent`, which sherpa consumes through `ctx.phase`.
- **The vocabulary is called**, every role enshrined on 2026-09-29, and
  `docs/vocabulary.picks.json` is where it lives: delta, channel, kit, subject, patch, voice, mix,
  signal, handle, engine, pose, influence, setting, timestamp, period, phase, rest, weight, locus,
  series, host, source, score, subsystem; for the score, anchor, event, mark, name, tag, query,
  resolver, projection (synonym image), doubt, snapshot, interval; cue, fade, sync, probe, project,
  assess, seek, blend, mute, drop; merge, scale, lerp, fold. The code and the schema page read in
  them. `name`, `query` and `resolver` are marked informal.
- **Blending** covers all four behaviors he was offered: fade, retarget on interruption, blend
  between alternatives, handover at rest. All reduce to a weight per voice or a channel lerp.
- **Two clocks, one of them addressable.** Mix time is a reading the host reports, not a position
  anything sets. Voice time is a position, because `phase` is computed from the reading rather than
  accumulated into. So `seek` has exactly one scope, the voice, and needs no qualifier.
  Decided 2026-09-27.
- **Reading back is a read, never a move.** The mix still only goes forward; `project(t)` copies
  state and reads at `t`, with history opt-in and nothing kept without it. A mix-level `seek` is
  decided against for that reason (2026-10-01, in `NOTES-ON-SCRUBBING.md`).
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
  share of the summed weight, and that one influence contributes at `min(1, Σw)`. On `sum` it is
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
  deleted; on magicsmoke's `main` since 0.5.0, pinned to `@msb235/blits` `0.3.0` since 2026-10-02): `lag`,
  `handle.weightOf`, `MixOptions.stepMs` and `setting.send` / `mix.drain`. Each is in the schema
  page; magicsmoke's row in the consumer table says how it uses them.

## Next, in order

1. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits: the allocation still
   in the hot path and what weasel has that blits doesn't (booking events ahead, a mix-wide time
   scale, nesting, a mix that can list what is playing). Delete each item as it is dealt with, and
   the file once it is empty. Its speed items matter only if weasel adopts blits: klieg and
   magicsmoke are expected to run about two dozen voices over tens of subjects, under 1,000 subject
   × voice pairs, where a frame costs about 0.2 ms (2026-10-01 guess, not a measured
   workload). `NOTES-ON-SCRUBBING.md` holds the one undecided reading-back item,
   `handle.seek` on a stateful voice.

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
     Next, by the last profile: `prepare`'s per-subject bookkeeping (~10%), `runMotion` itself
     (~22%), and the fold (~6%).
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
   - **A voice per node at scale is bound by memory, not calls** (measured 2026-10-02, teitou,
     `bench/split.mjs`): single-subject tween voices cost 18 ns more per voice than one shared
     voice at 1k, 48 at 10k, 226 at 100k, nearly all in the fill, plus `sync` at 2.8 ms for 100k.
     A motion patch belongs to one voice, so "voices sharing a patch" does not apply to motion.
     Proposed to Mike, not yet approved: voice clocks and weights mirrored into flat arrays, `sync`
     driven by a queue of scheduled events, motion state rows pooled per mix, then one lane over
     single-subject motion voices. Not designed.
   - **Voices sharing a patch, grouped into one lane indexed by voice**, so a voice per call costs
     what one voice does. The engine should make the natural use the fast one, so this stays
     planned for hosts that cannot share a voice — a call that needs its own pause or rate, say.
     On studio a tween per subject (`tweens`, 10k voices) cost 2.6× one tween voice over the same
     subjects, about 4 ms a frame in weasel's bench. After the item above. Not designed.

1d. **`@msb235/blits-quarks` 0.1.0 is on npm**, published by hand 2026-10-02 because npm refuses
   trust for a name never published; trusted publishing is registered since, so later versions go out
   from `quarks-v*` tags. `main` pins it to engine 0.3.0, a breaking change not yet released (0.2.0
   under its semver; the number is Mike's). Its README says how it works. Moving magicsmoke's fizz and tuning onto it
   is a follow-up in magicsmoke's repo.

2. **Step two of the port**, which is what the extraction bought: `power`, `kicks` and `dwell` lose
   their hand-rolled frame keying onto `slew`, `hinge`'s modes become `weight: signal` and
   `mix.blend`, and `FrameCtx` becomes `Setting` with klieg's fields on `host`. The schema page's
   klieg section has the list. Nothing here is started.
   klieg's `effects/signal.ts` also keeps its own `peak`, `level` and `dwell` (`dwell` is blits'
   `slew`) on a `(t, part, ctx)` signature, which is why klieg's signals are invisible to the mix.
3. **The renames the vocabulary bought, which the port deliberately left alone.** `t` is still `t`
   on `MotionPiece.offset` and `EffectPiece.at`, `onPhase` and `PhaseEvent` still carry those
   names, and the tube gradient still calls its own thing `domain`. Each is a break in klieg's
   published surface — sherpa reads `ctx.phase` — and step one had to leave every baseline where it
   was, so they wait for a version of klieg that intends to break.
4. **The remaining opens** are in the schema page: what the score still lacks (marks placed inside
   a voice; tags absorbing loci; splitting a read ahead at known events), color's lerp space and the
   stock band's width.

## Loose ends

- **A pose can hold a keyframe's own array.** When a channel has no rest and its `merge` returns
  its second argument, as a `last()` over arrays does, `apply` puts the delta's array into the
  pose uncopied. With two voices on a keyed array channel, a host that edits its pose edits the
  stop. Found 2026-10-01 and not fixed.
- **A stale served-page tab will overwrite `vocabulary.picks.json` with whatever set it
  was holding.** It has happened twice — `65d2d71` restored one, and the same loss was in the
  working tree at the start of 2026-09-27's session. Before trusting the picks file, `git diff` it;
  before reloading the served page, make sure no old tab is open on it.
