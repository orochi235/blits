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

- `main` at `git@github.com:orochi235/blits.git` — **public**; release 1.0.0 (2026-11-04), with blits-panel 0.9.0, blits-rapier 0.6.0, blits-quarks 0.16.0, and blits-tone 0.12.0 taking it as a `^1.0.0` peer and pinning 1.0.0 to build against. 0.17.0 through 0.20.0 were minor bumps with no Breaking section, against the changelog rule's "everything else the patch", at the owner's call (2026-11-02, 2026-11-03).
  Pushing driver tags at once leaves the middle run canceled (the `release` concurrency
  group keeps one pending run), so rerun it once the last one starts.
  blits-tone 0.2.0 was its first release through trusted publishing.
- **What shipped is in `CHANGELOG.md`; the calls made while building it are in the schema page's
  "Chosen while building"**, each the owner's to overturn, and the playground's and the DevTools
  extension's own calls are under the same heading in their READMEs (moved there 2026-10-24).
- **klieg's port is merged into klieg's `main`** (2026-10-02), and its step two shipped in klieg
  0.15.0 (merge `77d537d`, 2026-10-05). klieg reads `setting.host` through `mix<I, O, H>`. klieg
  moves onto `mix.arc` later.
- **Which blits each consumer pins**, read from each working tree under `~/src` on 2026-10-26:

  | Consumer | Pins |
  |---|---|
  | bree | `0.12.1` |
  | astv; weasel core, animator and labkit | `0.12.0` |
  | klieg | `0.11.0` |
  | wod | `^0.10.0` |
  | magicsmoke, portfolio, agnew | `0.8.1` |
  | sherpa | `0.6.0` |

  sherpa follows klieg, to keep one blits copy.
- **Locus is renamed role (2026-10-26)**: `VoiceSpec.role` and the mix option `roles`; `locus`
  and `loci` are deprecated aliases that warn once a mix, kept for one release and removed in the
  one after. Consumers still cueing with `locus`: astv `packages/engine/draw/windows/turns.ts:125`
  and `:145`; wod `src/clock/morphVoices.ts:50` and `:58`, `src/transition/voices.ts:98` and its
  test at `src/transition/voices.test.ts:131`; magicsmoke names it in an `Omit` at
  `src/smoke.ts:99`; klieg only in comments (`packages/core/src/effects/hinge.ts:54`,
  `packages/core/src/motion/compositor.ts:121`). None of them pins a blits that has `role` yet.
  The bench row `role` was `locus` before; `bench/ledger.mjs` files the old rows under `role`, and
  `bench/frame.mjs` or `bench/same.mjs` run against a build from before the rename sets no role.
- **sherpa runs on klieg**, with one deduped blits copy. Its seams run on a blits mix, and its klieg pages hold on clicks and stages through
  `dismiss: 'host'` and `advance()`, paced on klieg's `active` and `stage` marks. All three systems fold through a mix: `Timeline.poseAt`
  cues a voice per layer of each phase, `EffectFrame` one per effect, and the sign's environment is
  a mix with one subject. The arithmetic did not move: klieg's 1974 vitest cases pass on the fleet,
  and its Playwright specs fail exactly the five they already failed before the port, to the pixel
  (recorded in klieg's changelog). 0.3.0 needed no change in klieg: its `color` channel is a `hex`,
  but every effect voice plays at full weight with no role, so the OKLCH blend is never taken. The
  schema page's klieg section says what the port found.
- **The package, `@msb235/blits` 0.16.1 on npm.** `src/` is the whole of it, with `types.ts` a
  barrel over `types/` holding the whole public surface, doc-commented. What a probe or a fill runs
  per subject is methods, written in their modules as functions taking `this` and installed on the
  prototype at the foot of `mixer.ts`, `lanes.ts` and `motions.ts`: as plain functions they cost
  up to 9%. Zero
  runtime deps, ESM, vitest, biome as klieg. `npm run check` is lint, typecheck of both `src` and
  `test`, then the suite. `npm run bench` (`bench/frame.mjs`) measures a frame at scene sizes, GC
  counts included. Enlisted for the fleet — `.onto/tests` is `plugin: node`, `run: npm test`,
  `runner: vitest`.
- **The site, `site/`**, built 2026-09-30: an Astro workspace with a live explainer per word and
  the API reference from the doc comments. `site/README.md` says how it works; `npm run site:smoke`
  is green on every page. Deployed to `michaelbaker.tech/blits/` by `.github/workflows/site.yml` on every push to `main`;
  that workflow also runs the site's typecheck, which `npm run check` does not.
  Every explainer draws a stage of what its mix drives above its chart (2026-10-04). `site:smoke` also
  fails a page laid out wider than a 390 px viewport. The sliders whose
  right end means never (Score's `cut`, Mix's `muteAt`, Voice's `fadeAt`, State's `cap`) are on
  labkit's `endless`, which stores `Infinity` at that stop.
  Every explainer has its full source listed under it, with the site files it imports
  (2026-10-22), and imports blits as `@msb235/blits`, the alias reaching only the public entry.
  Get started, guides, examples, and a Why blits page were added (2026-10-24), with search
  (Pagefind), prev and next links, copy buttons, a 404 page, and a sitemap. Their code lives in
  `site/src/live/` and `site/src/snippets/` under the site typecheck; `site/README.md` says how.
  Each explainer plays one named mix with history for its life and seeks it to loop or scrub, so the
  panel and the DevTools extension can pick it and drive its clock (2026-10-24).
  Each explainer's transport has a loop/boomerang switch, kept per viewer in `localStorage`;
  boomerang is the default (Mike's ask, 2026-10-28).
- **blits-panel and the DevTools extension.** `@msb235/blits-panel` (`packages/panel`) is on npm at
  0.2.0 and publishes from `panel-v*` tags through trusted publishing; an agent registers trust with
  `npm trust github`, and only an npm login needs Mike. `node
  packages/panel/scripts/smoke.mjs` drives it in headless Chromium (on the fleet; it launches a
  browser). The extension is `apps/devtools`, whose README says how to load and test it; it is not
  on the Chrome Web Store, and putting it there is Mike's call. Hazards the review left standing:
  - With history on, the extension's `start.js` builds the shared registry and the
    `createHistory` tape from its own bundled copies, before the app loads. The `watch/1`
    contract covers entry methods but not the registry's own fields or the tape's API, so
    an engine that changes either needs the extension rebuilt, or a bump to `watch/2`.
  - A relay's `bye` ends whichever page agent is current, not the one its port served. The
    order of calls makes a re-attach to the same page lose that race only in theory; not
    reproduced.
- **The marquee** (an LED sign demo, one subject per dot) lives in bree; `apps/marquee` was deleted
  (2026-10-23). Its smoke run (headless, msb-uai, 2026-10-22) read mix 0.19 ms a frame at 652 lights
  and 4.33 ms at 20,548; the schema page's "Subject aliases" (decided against) and "Layered
  subjects" (open) are about that load.
- `docs/schema.html` — the design: vocabulary, channel table, patches, voices, mix,
  signals, time model, blending, patch state, the engine seam, per-consumer rigs, the klieg port,
  decided-against, chosen while building, tests, open items. Status line says design under review. It reads in the called
  words; klieg's own `offset` channel, the arithmetic `add`, a `keys` patch's `stops` and the patch
  callback `step` are deliberately unrenamed.
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

- **The playground's diagrams** (Flow, Timing, Both, editing, and the Desk) are built, and its
  README describes each. `flowOf` builds the graph from the playground's `Composition`; once the
  UI settles, a public `describe()` on `Mix` should make the same shape for any host, and `flowOf`
  becomes a thin adapter (unbuilt). An edge label is still placed without regard to nodes, so on a
  short edge it can overlap the box it leaves or enters (`anchors`: `start its end +200 ms` over
  `pair`); that gap is filed in weasel's `docs/TODO.md`.

## Decided in conversation, and in no doc

- **The gpu engine's shape** (2026-11-02): a shader patch carries WGSL and a JS `at` side by side,
  over a JS subset compiled to WGSL and over WGSL alone; the host draws from GPU buffers, with
  `pull` reading back; it ships as the core subpath `@msb235/blits/gpu`, not a companion, so it
  can use the lane internals; and it is a parallel evaluator beside the stock mixer, not GPU lanes.
  Its WebGPU tests run with `npm run test:gpu` and need a real browser with WebGPU, so `onto test`
  leaves them out: send them with `onto do --kind test --node teitou -- npm run test:gpu`.

- **The two seek-back changes in `3fd3eac` stand** (Mike, 2026-10-18): `weightOf` reads 0 after
  a seek back until the subject is probed again, and a write to the handle of a voice waiting for
  its cue after a seek back is ignored. Both stay under Fixed in the changelog.
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
  signal, handle, engine, pose, contribution, setting, timestamp, duration, phase, rest, weight, role,
  arc (renamed from series 2026-10-22), plane (a group of a kit's channels, 2026-10-22; bree's word, which blits's code does not read), host, source, score, subsystem; for the score, anchor, event, mark, name, tag, query,
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
- **A role folds by `lerp`, not by scaling and merging.** The review found the old cap's
  invariant — two voices in a role at weight 1 look like one at weight 1 — false on every channel
  but `sum`: two at 0.5 on `mul` give `(1 + (v − 1) / 2)²`, so a shared gain of 0.06 read 0.28.
  A role is alternatives, so the mix folds its members through the channel's own `lerp` by their
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
  the site takes its outline loosely.
- **`numeric@1` kept its version when lanes took `color({ lerp: 'oklch' })`** (2026-10-25): a copy
  of blits that predates `folds` folds that channel as `'own'`, which is correct.

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

- **A musical layer is a blits companion, on the mix's clock, not Tone's `Transport`** (2026-11-04).
  Tempo and meter map beats to ms, times are written in bars and beats, notes are hits whose event
  is a note, bar lines go on the score with `announce`, and a sink fed by `mix.book` sounds them
  (blits-tone, `@weasel-js/audio`, MIDI). Tone's and weasel's own sequencers keep a second clock that
  seek, history and the panel cannot reach. Unbuilt: the Score explainer's singalong
  (`site/src/explainers/score/sing.ts`) sings its hits inline first, and the package is to be cut
  from it.

## Next, in order

1. **What the stress demos found** (`apps/stress`, built 2026-10-30; its README says what each
   demo loads and checks). Fleet runs: `bench/runs/2026-10-31-stress-short.txt`, from after a
   review made the checks able to fail (the first round is `2026-10-30-stress-short.txt`), with
   each run's raw records beside it. The bugs they found are fixed (CHANGELOG, Unreleased), each
   pinned by a test in `test/stress-findings.test.ts`; what is below is still open.
   - **Mike's call: should a `from: 'current'` voice carry the subject's speed, or only where it
     is?** The code carries speed (CHANGELOG 0.2.0; the bend in `src/patch.ts` `read`), and the
     site says it does not: `site/src/pages/blending.mdx` says it "carries position, not speed" and
     calls carrying velocity a known gap. What turns on it: carrying speed makes a still
     fixture's linear fade ease in (cues demo, frame 440: 0.6501 against 0.6529 straight), and the
     first such voice a mix plays runs straight anyway, since the mix keeps no poses to take a
     speed from until one is cued. Either answer fixes one of the two: the docs, or the code and
     that first voice.
   - **`pull` on the heatmap is slower with lanes than without** (2026-11-03). 5,000 springs
     retargeted at 20–60 Hz, with three `ink` voices weighted per cell by `input` signals, read in
     5.40 ms a frame with lanes and 3.78 without (studio, solo, 7 rounds,
     `bench/runs/2026-11-03-motion-owed-ab-heatmap.txt`); 5.84 with lanes before 952abdb, which
     has a cell with a retarget waiting read only its motion voice on the general path, not every
     voice (`owableAlone`, `src/meet.ts`). `bench/heatmap.mjs` times the shape with each part
     swapped out (`bench/runs/2026-11-03-heatmap-parts-*.txt`): the signal weights against a
     constant and `ink` against `color()` cost little either way, and tweens cost what springs do.
     The lanes' loss needs a motion voice with retargets and other voices together: spring alone
     reads 1.39 ms with lanes and 1.25 without, heat alone 0.96 and 0.89 (teitou). Most of the
     base cost is the retargets themselves, about 3,000 `.to()` calls a frame, each committed when
     its cell is read. Profiled by caller (teitou, loaded, 2026-11-04,
     `bench/runs/2026-11-04-heatmap-callers.txt`; 5.22 ms on, 2.73 off): the lanes' extra is
     `one`'s own body, 22% of the lanes-on frame (about 96 ns for each of the 15,000 calls a
     frame, three `ink` voices over 5,000 cells), with `call` 2.3% and the signal's `base` 2.2%
     beside it; the general path spends 9% in `contribution` and 5% in `foldWith` for the same
     work. `one` does not keep deoptimizing (`bench/deopts.sh`: 2 deopts over 2,000 frames,
     `bench/runs/2026-11-04-heatmap-deopts.txt`), so the cost is steady; what in its body costs
     it is not split yet (V8 inlines its helpers into it). The demo itself plays a lanes twin, so
     profile `bench/heatmap.mjs`, not `bench/stressprof.sh heatmap`.
   - **The rig reads 1,000 bones in 1.2 ms** (`pull`, 70 voices), lanes on about 20% faster than
     off. Profiled (teitou, 2026-11-04, `bench/stressprof.sh rig`,
     `bench/runs/2026-11-04-rig-profile.txt`), the quat folds are not where it goes: `slerp`,
     `multiply` and `foldInto` together are about 8% of a lanes-on frame. Each character's clips
     are staggered, so every bone has a time of its own and each keys voice reads its stops once
     a subject, not once a voice: `readKeys`, `segment`, `firstPast`, `read`, `phaseAt` and the
     lerps are about 30% on and off alike, which is why lanes gain little; the role's gather and
     fold (`gatherRole`, `gatherInto`, `meetRole`, `foldAt`, `foldRole`) are another 12%. A
     staggered keys voice reading its stops once a distinct time, not once a subject, is what
     would move it.
   - **Mike's call: should a mix's `rate` go below 0?** It throws today, so the timeline demo
     plays reverse as an owner turned back. What turns on it: whether reverse is the host's to
     build from owners, or the mix's own, which would need an answer for every voice that keeps
     state or moves (springs, tweens, kept patches) when its clock runs backward.
   - **Mike's call: should a host's turn-back survive a span's fits on a seek forward?** A span
     held by a span, sought forward while turned back, takes its outer span's fits on the way;
     the latest write wins, so it ends running forward at the fit's rate (pinned by "a span held
     by a span keeps the retiming" in `test/stress-findings.test.ts`). What turns on it: whether
     a seek replays the fits as playing through would, or keeps what the host last set.
   - **A read ahead made between an owner's forward seek and the next frame** starts the
     children the seek crossed from the owner's clock as sought, where the frame starts them in
     order (`test.fails` "a read ahead over a span sought forward while turned back"). Giving the
     copy the mix's `leapt` set and an `owners` list was tried and still differs: by the end of
     its move the copy holds fewer children (2026-11-04). A read back to a frame reads it as it
     showed, so only a read ahead is wrong. A voice paged out to a history store also loses its
     `met` and `metRead`, so a seek past memory to while it played may find the mix inert when a
     subject met inside its stagger was not yet read; untested.

3. **What is still slow.** Lanes, `pull`, `tween`, subject fades, a voice per node and crowds are
   built (the schema page's Lanes and motion sections, the changelog's 0.8.0 section); Mike set the
   goal as fast and capacious as possible, not a target (2026-10-02). Measure each change on the
   fleet before the next starts. `bench/same.sh <rev>` checks a change bit for bit (random scenes
   through two builds), `SAME_LANES=off bench/same.sh <rev>` compares this tree's lanes with a
   revision's general path, and `AB_EACH=1 bench/ab.sh` times one row per process. On a node,
   `HEAD` is the node's base commit, not the one synced, so both scripts refuse it in a tree with
   uncommitted changes (2026-10-26); A/Bs of 2026-10-25 that compared `HEAD` with `.` on a node
   (ready-flag, Named/writing, foldNow) may have measured against that base, not the parent meant.
   Open, largest first:
     - **A voice over every subject cued among a crowd** (`swap`: 10k one-subject tween voices, a
       voice over all of them replaced every frame) costs 2.19 ms a frame on msb-uai against 3.67
       before 2026-10-25 (`bench/runs/2026-10-26-place-all.txt`). A stateless fn voice sharing one
       record takes every numbered subject on its lane when it opens, where the host probed every
       subject the frame before (`placeAll` in `qualify.ts`), and the fill makes each one's first
       call (`Lane.every`); otherwise a probe meeting the lane makes it (`foldNow` in `meet.ts`).
       A keys voice takes both too, its read made through `one`'s keys branch (`swapkeys`, the same
       row with the replaced voice a keys voice: 2.26 → 1.21 ms on teitou, 2026-10-26,
       `bench/runs/2026-10-26-keys-{foldnow,place-all}.txt`; `glowkeys` read 1.963 → 2.016 at
       U = 6 in the second A/B, on a row neither change runs, and 2.009 → 1.967 in the first).
       What is left per subject: relinking its chain (`relink.ts` `patch`, whose walk reads each
       record's voice, `linkable`, `sight`, and the `chains` WeakMap lookup), the fill's
       `open`/`one`/`call`/`shut`, the patch call itself, and the copy out. That copy stores each
       channel by its own name since `3c2560d` (2026-10-26, `copyout.ts` `copier`: swap 1.739 →
       1.632 ms on teitou, U = 0, `bench/runs/2026-10-26-copier-teitou.txt`), but into a host's
       `{}` out it still boxes every number: `{}` shares V8's chain of shapes with the host's own
       small literals, and `kit({ gain: mul(), ... })` puts a channel in `gain` first, so the
       field is tagged for good (`node --trace-generalization`; `FIELDS=1` in `bench/frame.mjs`
       prints the out). Probing into a pose of the mix's own shape (`OUT=blank`, `mix.pose()`)
       cuts about 310 kB a frame on swap, glow, glowbase, swapkeys, and probed, but only glowbase
       read faster (1.079 → 1.012, U = 1; the rest inside noise, teitou,
       `bench/runs/2026-10-26-out-shape.txt`). Hosts get that shape from `mix.pose()` (added
       2026-10-26), which the Mix page and Get started now probe into.
       A motion voice cannot take `foldNow` or `placeAll`, since `move` numbers the subject.
       Measured no different on `swap` and reverted (2026-10-26,
       `bench/runs/2026-10-26-{dedupe-steps,met-lanes,unchained-walk,presize-records}.txt`):
       linking a voice stepped twice since a chain's version once; handing `foldNow` its met lanes;
       skipping the chain walk for a voice no chain ever linked; sizing a lane's
       `records`/`deltas` up front (2.0 MB a frame to 1.6, no time).
     - **A role costs about 20% more than its voices played apart, and a blend about 33%**: on
       teitou (2026-10-26, `FRAMES=5000`, nine own-process runs) three voices in a role over 10k
       subjects take 2.555 ms a frame, a `mix.blend` of three 2.841, and three plain voices 2.132.
       A role whose members have no other laned or crowded voice between them in voice order, all
       playing, none keeping state, and over the same subjects in the same places runs a subject at
       a time at its first member's turn (`runRole`, `Role.inline`), which took `role` from 2.839
       and `blend` from 3.055; any other role gathers every subject first and folds in a second
       pass (`gatherRole`, `foldRole`). What is left (CPU profile, teitou, 3000 frames): in
       `role`, `gatherScalar` 6.2% of samples, `runRole` 4.7, `meetRole` 3.9 and `foldAt` 3.7;
       a blend adds each member's `signalled` path (`signalled` 5.2, `signal`, `laneRead` and
       `blended` 5.1, the signal itself 5.2). Measured no different and reverted (2026-10-26,
       `FRAMES=5000`, 7 own-process rounds, on `c276e7d`, before the locus-to-role rename): on the
       inline route, clearing a subject's `taken` once before its members and dropping `meetRole`
       there (teitou: `role` 2.608 → 2.524, U = 9.5; `blend` 2.787 → 2.628, U = 12.5; faster but
       short of U < 9; `bench/runs/2026-10-26-role-inline-taken.txt`; rerun on `3eb11ae` over 9 rounds on
       msb-uai: `role` 3.461 → 3.379, U = 23.5, `blend` 3.778 → 3.698, U = 24, both short of U < 18,
       `bench/runs/2026-10-26-role-inline-taken-r9.txt`); and priming a signalled voice's setting
       once a lane call, in `signal`, not again in `ready` (msb-uai: `blend` 3.505 → 3.574, U = 22,
       `bench/runs/2026-10-26-role-prime-once.txt`).
       Measured no different and reverted (msb-uai, 2026-10-26, against `ead195f`): clearing a
       subject once before a member-at-a-time gather and skipping the fold pass of a member first
       to no subject (`role` 3.747 → 3.678, U = 13; `blend` 4.013 → 3.988, U = 14). Raw output:
       `bench/runs/2026-10-26-locus-{meet-once,inline,inline-teitou}.txt`. A role with a motion
       member, or a signal that keeps state, stays on the general path.
     - **Starting 10k one-subject tween voices** takes a first frame of 20.7 ms against 8.9 for fn
       voices (teitou, 2026-10-25, 9 rounds, `bench/start.mjs`,
       `bench/runs/2026-10-25-named-writing.txt`). The tween-only part, profiled a build earlier:
       crowd `join` 1.8 ms, the motion patch's off-heap first buffer 1.5, a second numbering of the
       subject 0.7, and 1.1 more of collection. Measured no different and reverted: carving motion
       buffers from a shared slab, and keeping a named subject's record out of the WeakMap.
       Where starting allocates, garbage included (`bench/allocwho.mjs`, 2026-10-25): a tween voice
       6.3 KB over its cue and first frame, a fn voice 4.1 KB. Common to both, the `Voice` object
       itself is about 790 B (charged to `cue`, which allocates it) and its field objects another
       820 B. Tween-only: the crowd's `rowOf` and `lanes.crowdOf` entries 184 B, `mix.playing` 92
       B, `fresh`/`grow`/`Motions` about 450 B. Most `rowOf`/`crowdOf` reads are by voice id with
       no voice at hand (`placed`, `watchId`, `forget`), so moving a row onto its voice still needs
       an id map. `Voice` has about 100 fields, 12 of them boxed doubles (192 B a voice, the ones
       defaulting to NaN or ±Infinity); its cold fields are read from 2–26 files each, so a side
       object for them is a wide diff.
     - **A crowd's `keys` rows** cost about 27 ns a subject by `pull` (teitou, 2026-10-25,
       `keyses^` 0.270 ms), against 25 for keys voices over every subject (2026-10-05). Rows whose
       stops share phases and easings search and ease once per phase (`KeyRows.search`, keyed by a
       timing number given when a row is added); what is left per row is its lerp and fold. The
       search has to stay out of `fold`: inside it, `fold` stopped inlining and boxed each row's
       phase (+155 kB a frame, backed out).
     - **Stopping a subject's voice and cueing its replacement** (`bench/restart.mjs`, weasel's
       codec shape: a tween voice per subject read by `pull`, 100 stopped, dropped and cued again a
       frame; keiei, 2026-10-29, `bench/runs/2026-10-29-stop-seat.txt`): at 10,000 subjects the
       frame after the stops takes 0.955 ms, the next 0.386, a steady frame 0.239. A stop
       (`fade({ over: 0 })` and the `drop` after it) grows with N though nothing in it walks more:
       0.61 µs at 1,000 subjects, 1.60 at 10,000, 2.92 at 40,000, every part growing
       (`bench/stopparts.mjs`). Inferred, not counted: it pays the first touch of each line it
       reads or writes, one or more per object of the voice and one per parallel array of its
       crowd row, so a cheaper stop means fewer objects per voice and fewer arrays per row.
       Measured no different: one `Seat` per crowd voice (`eed156c`, 0.06 µs at 40,000) and
       skipping the due-queue push of a voice retiring at once
       (`bench/runs/2026-10-29-stop-due-push.txt`); one entry per subject in place of `chains`
       and `named` would save one lookup, decided against for now (2026-10-29). Neither what a
       churned voice leaves alive nor its garbage is weasel's gap: pooling everything per voice
       (2026-10-05) and cutting garbage from 21.5 to 11.7 KB a churned voice (2026-10-24,
       `bench/churnwho.mjs`) moved no row.
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
     - **Confirm any short-run regression at `FRAMES=5000` before chasing it**: 330 frames can end
       before the JIT settles.
   - **Measured no different and reverted, so not worth re-proposing**: storing stretches as
     Float64Arrays (`b4a4260`, 2026-10-02), and reading a crowd's keys stops as flat numbers
     (2026-10-03).
   - **A voice that leaves the general path or a lane**, rather than a crowd, still requalifies
     every voice.
   - **A read ahead across many events of a stateful mix costs a read per event**: each stop copies
     every voice and reads each asked-for subject once. `far` (read 5 s ahead past V-1 voices cued
     150 ms apart) and `redo` (the same voices cued by taped calls, sought back and read ahead) bench
     it at `FRAMES=100`, since a read holds the mix still. A stop hands each subject's record on to
     the next rather than copying it, and a voice starting many stops on asks only the copies that
     may hold one (`src/ahead.ts`, 2026-10-25): `far` at 1,000 subjects went from 20.5 to 14.3 ms a
     frame with 7 voices and from 182 to about 109 with 31 (teitou, `bench/ledger.tsv`). Left per
     stop and subject: a lookup and write in each voice copy's store (one WeakMap per copy per
     stop), a fold of every voice including stateless ones, and a copy of every voice. One store
     shared along a voice's copies would cut the first, and needs `Filled` in `src/store.ts`. No
     test reaches `carry`'s fallback for a copy that holds a record under copies that hold none.
   - **`ink()` folds on lanes as `'own'`, through the channel's `fold`, as a `quat` does**
     (2026-10-30, unmeasured): each contribution is a call that widens `oklab()`'s four numbers to
     five. Folding it as a plain five-axis sum (`folds: 'sum'`, as the deprecated
     `color({ lerp: 'oklch' })` does) needs the widening wherever a lane reads a contribution as
     numbers: `flatten` in `keyfill.ts`, a keys row's stops in `keyrows.ts`, a motion sample in
     `foldRun`/`sample.ts`, a role in `gatherInto`, and a crowd row. The 2026-10-25 oklch A/B
     measured the same trade on four axes: `hues` 1.38 by probe folded as a sum against 1.59
     through the channel (`bench/runs/2026-10-25-oklch-lanes.txt`). The benches still cue the
     deprecated `lerp: 'oklch'`, which warns once; an `ink` row would time this.

4. **Next for speed: the steady frame of 10k one-voice-per-subject tweens read by `pull`** (`tweens^`,
   `weasel^`), Mike's go 2026-10-05. At 5,000 frames each row's tweens have landed for most of the
   run. On studio (2026-10-29, 7 rounds of 5,000 frames, `bench/runs/2026-10-29-landed-rows.txt`)
   `tweens^` takes 0.235 ms a frame and `weasel^` 0.362; on teitou they read 0.165 and 0.198 before
   the landed shortcut (2026-10-25), against 0.031–0.047 for a hand-written loop doing the same
   arithmetic. What is left:
   - **Where the frame goes** (studio, `bench/cpuprof.sh`, 2026-10-29, after the landed shortcut,
     one run on a loaded node, `tweens^` only): `tweens^` 39% `bareRows`, 29% `pullRun`, 5%
     `foldNumber`, 4% `keepProbed`, 3% `rests`. `weasel^` before it (unchanged by it): 58%
     `runMotion`, 20% `pullRun`. In a model of `bareRows` (`bench/layoutsim.mjs`,
     `bench/runs/2026-10-25-layoutsim.txt`) a new layout was not worth building (2026-10-25).
   - **`pullRun` pays about 1 ns a subject for each thing it checks**, no one of them the cost (a
     model of its loop on this Mac, 2026-10-29, not kept): stamping alone 13 µs over 10k subjects,
     everything 58; leaving out any one of the `was` compare, the `FILLED`/`IDLE`/`SEEN` checks, the
     `distinct` count, the `subjects` store or the run tracking saved 6–10 µs. Before a frame's
     first probe it now counts `distinct` once a run (`bb450b2`, 2026-11-03; teitou, 9 rounds:
     `tweens^` 0.132 → 0.127, U = 6; `weasel^` 0.197 → 0.190, U = 9; `turnover^` 0.192 → 0.196,
     U = 14.5, and 0.202 → 0.207 on a second pass, U = 16; `bench/runs/2026-11-03-distinct-once.txt`,
     `2026-11-03-branch-turnover.txt`). Why `turnover^` pays about 2% for it is unexplained: its
     list stays in slot order, so the counting fallback (`lastStamped`) should not run.
   - **A landed shortcut for a lane** (`runMotion`, so `weasel^`) is built (`ec8888d`, 2026-11-03):
     a bare position seen landed keeps the voice time less delay it landed at in `Lane.landed`,
     which `remove` carries, and folds its `to` at any later one until it stops being bare.
     `weasel^` 0.193 → 0.186 ms, U = 10; `weasel` 0.663 → 0.653, U = 21.5, inside noise (teitou,
     9 rounds, `bench/runs/2026-11-03-lane-landed.txt`). It allocates about 1.3 kB a frame more on
     `weasel^` (5.3–6.2 against 3.9–5.0), source not found.
   - **Churn, `turnover^`**: `pull` gives the subject swapped into a dropped one's place the
     number the drop freed (`7e64030`, 2026-10-29), so list order no longer costs anything there
     (`bench/runs/2026-10-29-turnover-prof-renumber.txt`). What is left over `tweens^` is the
     per-frame stop, drop and cue (item 3) and the row's own copy of its list, most of its
     136 `kB/frame`. Not built: renumbering for lists reordered other ways (sorted, reversed,
     filtered), which needs two live subjects to swap numbers, and renumbering under history,
     roles or a bound, which `src/renumber.ts` declines.
   - **A subject the host has let go entirely may be collected before the next fill** rather than
     held until it, since a probe holds its subject only while fills look subjects up (2026-10-24);
     only a later signal or `parting` lookup on that subject could notice.
   - **What `probed` still allocates is pose data**: `foldWith` copying each channel's rest value,
     and the `fn` voices' returned objects in `fill.ts`'s `call`.
   - Measured no different, so not worth re-proposing:
     - Skipping `pullRun`'s `FILLED`/`IDLE`/`SEEN` checks at positions that passed them while a
       counter bumped by every write of them, a new `wide`, a fill running no lane, and a pull
       position's slot changing stands where it stood (teitou, 2026-11-03, 9 rounds, against
       `ec8888d`): `tweens^` 0.129 → 0.125, U = 5, but `turnover^` 0.196 → 0.204, U = 3, and
       `churn^` 0.169 → 0.177, U = 3.5, both of which bump it every frame
       (`bench/runs/2026-11-03-checked-flags.txt`; reverted in `4a80fd1`).
     - Counting `pullRun`'s probes and distinct subjects in locals (msb-uai, 2026-10-24).
     - Answering `runMotion`'s same-`since` check before calling `same`, which the profile shows
       out of line there (studio, 2026-10-29: `weasel^` 0.362 ms either way).
     - Inlining `linked` back into `probe` and `atRest` (msb-uai, 2026-10-24, against `1981422`).
     - Moving `popDue`'s loop into a function of its own (`due.ts`), though `popDue` deoptimizes
       at its tail on every frame a voice comes due (teitou).
     - Skipping `atRest`'s second `chains.get` after a probe of the same subject (teitou, against
       `13f7df1`). The probe's own lookup has no way around it short of a per-subject handle the
       host holds.
     - A public `keys` read into a reused out object: slower than `at` (0.87 against 0.78 ms),
       since V8 removes `at`'s fresh object when the caller reads one field (2026-10-08).
   - Not tried, and not to try: writing `pullRun`'s `LANE_PROBE` and `LANE_FILL` once per run
     instead of per subject. `weightOf` (`Lanes.reported`) and every pace loop (`bare.ts`,
     `sample.ts`, `crowd.ts`) read them by slot, so each would also have to find the run holding
     its slot, a second place for the same answer; and `pullRun` reads both stamps per subject
     anyway to count `distinct`, so the saving is a store per subject.
   - `turnover^` reads two ways on identical code (0.43–0.46 or 0.48–0.54 ms by process): six
     runs a side at least.
   - `named` at 10k reads two ways on identical code too (1.23–1.26 or 1.41–1.51 ms by process,
     teitou, 2026-10-25, `bench/runs/2026-10-25-named-split.txt`): one A/B can land all one side
     in the fast mode by luck.

5. **Bounding a signal: `within`, `around`, `plot`, `moved` and `put`** (2026-10-26; released in
   0.15.0). A pointer glow is a weight signal read for every subject every
   frame, almost all of them at weight 0. A cue's `within: { x, y, r }` declares the signal 0
   outside a circle the host moves, so the mix skips it there without visiting each subject.
   `mix.around(circle, { ease })` is the stock signal of that shape (1 at the center to 0 at `r`,
   along an `Easing`), which carries its circle: a voice it weighs is bounded with no clip check,
   and plays unbounded where `within` would be refused. `mix.put(subject, x, y)` moves one plotted
   subject. Documented on the site's signal page and in `docs/schema.html` (Signals).

   Chosen by Mike (2026-10-26): positions as a list plus an `x, y` `Float64Array` read in place, with
   one call when they move; the circle on the cue; a dev-only check; positions held weakly. Mike
   picked `place`, index, `find`, and kept `within` (2026-10-28); `Circle`, `Finder`, `plot`, `moved`,
   `around` and `put` were picked by implementing sessions. `around` is a mix method, not a free
   signal like `level`, because it reads that mix's positions (2026-10-26). `put` writes into the
   array `plot` was given, or with no `plot` the mix's own, and throws for a subject past the host's
   array rather than copying it (2026-10-28).

   How it works. `src/plot.ts` holds `place`, `plot`, `moved` and `put`; `src/grid.ts` the uniform
   grid, rebuilt at the first query after `moved`; `src/places.ts` the indices over it (a `Store`, so
   objects weakly, a free list that `drop` and collection feed), with each index's lane number
   cached; `src/bound.ts` the bounding, shared by `within` and `around`, where `findAll` asks the grid
   or the host's finder and both fill from the same list; `src/around.ts` the signal. Outside the
   bound the voice is not read: the general path returns before priming (a finder is asked once a
   frame and its indices marked), and a lane fill runs `one` only for the indices found, then zeroes
   the lane weight of those that left. While
   a fill reads a place, `places.cur` holds it, so `around` skips the position lookup. A `put` that
   keeps its subject's cell changes only its numbers; one that leaves makes the place a stray,
   tested on its own by every query, until a sixteenth of the places are strays and the grid is
   rebuilt. Outside production, every 8 frames a voice bounded by `within` reads its signal for up
   to 4 subjects just beyond `r` and warns once if one is above 0. Tests: `test/bound.test.ts`,
   `test/around.test.ts` (to the bit against the hand-written signal plus `within`), and
   `test/put.test.ts` (to the bit against `plot` plus `moved`), lanes on and off. With no bound,
   output is bit-identical to `eb22788` (`bench/same.sh`, 300 scenes, 0 differ, lanes on and
   `SAME_LANES=off`).

   Measured (teitou solo, 7 rounds, each row in its own process, medians, ms a frame, 10k subjects
   read by `pull`; ledger):

   | Row | covers | ms | against | U | raw |
   |---|---:|---:|---|---:|---|
   | `glowb^` (`within`) | 2% | 0.669 | unbounded `glow^` 1.113 | | `-near-put-guard.txt` |
   | `glowbn^` (`around`) | 2% | 0.654 | `glowb^` 0.660, same build | 18.5 | `-near-put-rows.txt` |
   | `glowbp^` (`put`, 1% moving) | 2% | 0.679 | `glowbf^` (`moved`) 0.705 | 4 | `-near-put-rows.txt` |
   | `GLOWR=55 glowb^` | 60% | 1.171 | unbounded 1.269 | 0 | `-within-weak-r55.txt` |
   | `GLOWR=55 glowbm^` (all moving) | 60% | 1.402 | unbounded 1.415, other runs | | `-within-weak-r55.txt` |

   Adding `around` and `put` left `glowb^`, `glowbm^`, `glow^`, `swap`, `tweens^` and `view` within
   noise of `eb22788` (geometric mean 1.001, every U at least 13; `bench/runs/2026-10-26-near-put-guard.txt`).

   A voice naming its subjects and a role member take a bound, lifted by Mike (2026-10-27); a role
   member outside its circle is skipped on both laned role routes. An owner's child, a motion, a
   stepping patch and a `from: 'current'` voice take one too (2026-10-28): outside the circle a
   stepping patch still steps and a `from: 'current'` voice still takes its base, as at weight 0, so
   bounding them saves the signal's calls but not their steps. A mix with history takes one too
   (2026-10-28): a bound reads as its signal does, live without `inputs`, recorded with them, so the
   playground keeps history for an `around` composition now. `within` also takes the host's own
   finder, `{ find(out) }` over indices `mix.place` hands out (names Mike's, 2026-10-28; the schema
   page's Signals and "Signal bounds"). **Next here, Mike's ask: positions on k axes**, unbuilt.
   Decided by Mike (2026-10-28): 1, 2 or 3 axes, not any k (a `Finder` covers the rest); the shape
   is `Ball`, `{ x, y?, z?, r }`, read by field so a host moves it by writing, with `Circle` kept as
   an alias for the 2D case; `plot`'s array keeps the name `xy`; `put(subject, x, y?, z?)`. How
   `plot` is told the axis count is not decided; the proposal was an options object,
   `plot(subjects, xy, { axes, cell })`.
   **`4350a86` (the finder) made the glow rows 8–15% slower, cause not found, and left there by
   Mike's call (2026-10-29)** (measured 2026-10-28, revised 2026-10-29). It tips V8 into pretenuring the host patch's results, but the GC pauses that
   brings can't explain the slowdown. Measured at `FRAMES=5000`, solo msb-uai, 7 rounds: `glowb^`
   0.776 → 0.875 (U = 0), `glowbn^` 0.812 → 0.881 (U = 6), `glowbp^` 0.789 → 0.907 (U = 1); HEAD
   the same (`bench/runs/2026-10-28-finder-ab-5000.txt`). At the default 300 frames it reads
   differently by machine and mostly as warm-up, so time these rows at 5000. What was measured:
     - Removing one piece of `4350a86` at a time (the FinalizationRegistry, `findAll` on circles,
       the `contribution` change, `?? -1`), or all four, leaves it slow; reverting `places.ts`,
       `plot.ts` and `grid.ts` alone recovers it (`-finder-bisect-5000.txt`, `-finder-bisect2-5000.txt`).
       No-op edits to `c93ca73` stay inside noise. Inlining in `one` is the same at both
       (`-finder-inltrace.txt`), and `Mixer.prototype` stays in fast mode (`-proto-fast.txt`).
     - Every slow build runs about 129 GCs taking 41 ms over the run against 146 taking 25 ms, at the
       same 900 kB a frame: 42 mark-compacts against 2 (`-finder-tracegc.txt`). Nothing leaks: after
       a full GC old space is flat across 3000 frames (`-plot-leak.txt`, `bench/plotleak.mjs`).
     - `--trace-pretenuring-statistics` (`-finder-ptstats*.txt`): at `4350a86` V8 tenures the site
       in the bench's `patch.writes` (the `{ gain, dark }` each subject's call returns; 5566 of 6250
       found alive in one scavenge), so every frame's 10k results go straight to old space. Also
       `record()`'s literal and `Places.hold`'s. At `c93ca73` none of those.
     - Results survive because a fn patch's result is kept on its record (`rec.delta` in `fill.ts`
       `call`, `held.delta` in `contribution.ts`) until the next frame's call replaces it, so a
       second read the same frame (a refill, or a general-path probe after a fill) reuses it. That
       reuse is for cost and for a patch whose `at` is not pure; `step` has its own once-a-frame
       guard. Not keeping it in `call` (`rec.delta = null`) made `c93ca73` faster, `glowb^` 0.866 →
       0.776 (U = 6) (`-finder-nodelta.txt`).
     - **Keeping a copy instead ends the pretenuring and doesn't buy the time back (2026-10-29), so
       it was not kept.** Each result was copied into a delta the record owns, through a copier
       generated per voice as `copyout.ts` generates one. GC fell from 129 taking 41 ms to 274 taking
       15 ms on `glowb^`, and from 120 ms to 26 on `fn^`, but `glowb^` got 14% slower (U = 0),
       `probed-` 3% (U = 6), and the rest moved within noise (`-owned-delta-copier.txt`). A plain
       keyed loop over `writes` was 10–47% slower everywhere, from boxing each double it stored
       (`-owned-delta-keyed.txt`). And 41 ms of GC over 5000 frames is 8 µs a frame, against the
       100 µs lost: the pauses aren't where the time goes.
     - **Where the time goes, by CPU profile (2026-10-29):** spread over the code that reads and
       writes records, `primeLaned` +91 ms over the run, `call` +60, the bench's patch +46, `capped`
       +42, `ready` +26, GC +21, with the same inlining at both (`-finder-cpuprof.txt`,
       `bench/cpuprof.sh`, `bench/profsum.mjs`). Not marking's write barrier: with
       `--no-incremental-marking` on both, the gap stays 12–15% (U ≤ 1) (`-finder-noincmark.txt`).
     - **Records are laid out differently.** Of 2000 consecutive records in the flicker voice's lane,
       1910 sit 288 bytes (one record) apart at `c93ca73`, 1454 at `4350a86`, where every fourth or so
       jumps to another page (`-finder-recaddr.txt`, `bench/recaddr.sh`). That fits records going
       to old space a few at a time once `record()`'s literal is tenured. Building records with a class
       instead (`new`) left the layout (1643 of 2000) and the time unchanged (U ≥ 14), so whether
       layout is the cost is still untested (`-finder-held-class.txt`).
     - With `--no-allocation-site-pretenuring` the GC counts match, but `glowb^` stays 13% slower
       (U = 10, short of U < 9) and `glowbn^` 6% (U = 1) (`-finder-pretenure.txt`).
   `within` on a constant weight stays refused, its error naming the recipe,
   `weight: mix.around(circle, { steps: 1, jump: 'start' })` for a hard-edged disk (decided by Mike,
   2026-10-26); blits-panel draws a bounded voice's circle on the page (◯ circles, 2026-10-26). Whether unbounded voices
   are ever deprecated stays open and unlikely: klieg's lighting, a fade over a whole sign and wod's
   transitions are unbounded by design (2026-10-07).
   - **A voice weighted by `mix.around` and cued before `plot` is bound once `plot` is called**
     (2026-10-26): the first `plot` runs `bind` over the live voices, safe because `around` read 0
     for every subject until then. `test/around.test.ts` holds it to the bit against the
     hand-written signal cued `within` after `plot`, lanes on and off.
   - **Under a CSP that refuses eval, `copyout.ts` asks `Function` once per process** (2026-10-26).
     Observed in headless Chromium on a page served with `script-src` lacking `'unsafe-eval'`: every
     `new Function`, caught or not, fired a `securitypolicyviolation` event and a DevTools issue (5
     calls, 5 events; no console message), and the page sent one `report-uri` report. blits fired
     one per set of laned channels (3 kits, 3 events) until a refusal stopped further asks; now 1
     event per page, same poses. No silent probe exists, so one is the floor short of
     `lanes: false` or `blits/lean`. Documented on the Engine page and in `docs/schema.html`.

6. **Work nobody will see** (2026-10-07). A lane fills only subjects probed this frame or the last
   (CHANGELOG 0.8.0), which does nothing for astv's shape, the `typing` row: at 2% probed every lane
   already rests, and astv's real text runs write `last` over row objects, which no lane runs. A
   profile of `typing` (teitou, 20,000 frames) puts about 55% in the general path's fold, 11% in lane
   bookkeeping and 11% in voice clocks. The other two cases, too fast to see and flicker, are
   decided (the schema page's Decided against). A reach that changes over time (item 5) is another
   way to say offscreen.

8. **blits-quarks and magicsmoke.** magicsmoke emits fizz through quarks' `rate` (its `10a6ec9`,
   2026-11-04, unpushed) with `drive`'s new `carry: 'float'` (Unreleased here), which sums
   `rate * dt` in doubles as magicsmoke's own carry did; it matched magicsmoke's 650bd28 byte for
   byte over 1,200 stubbed-random frames, with a fault cued mid-run and under reduced motion. The
   exact carry stays the default because `checkDriver`'s rebase check fails under a float sum. A
   driver now owes from when it was made, not from its first write. Left: magicsmoke links
   `file:../blits/packages/quarks` until a quarks release carries `carry`, then pins it; its
   typecheck, fleet suite and bench have not run against the link. The default exact carry also
   matched on those 1,200 frames, so whether `'float'` earns its place is Mike's call.
   `@msb235/blits/testing` (`setting`, `checkPatch`) is the authoring kit; the driver scaffold
   the survey proposed is this same question.

9. **blits-tone.** Its README says what it does and does not do yet. Open:
   - `mix.trace` (2026-11-03) knows `keys` voices, any easing as a bend under `bends`, and tweens
     with no retarget timed inside the window. Still read every `grid` ms: other patches, a signal
     weight, a fade under way, and a voice whose own rate is ramping (the 0.078 Hz left at a 25 ms
     grid in `curves.test.ts`). The schema page's Mix section lists what it needs to be exact.
   - **`apps/fireworks`**, which plays one mix through this driver and the quarks one, has never
     been listened to. It still packs pan and size into each event and could read them off the
     shell, since a booked hit carries its voice's `subjects` (2026-10-11).
   - **`node-web-audio-api` 2.2.0 frees a channel's samples under a live array** (2026-10-11):
     the `Float32Array` from `getChannelData` reads freed memory once its `AudioBuffer` is
     collected, so `render` in `packages/tone/test/render.ts` copies them. Upstream knows:
     ircam-ismm/node-web-audio-api issue 80. The copy can go once that is fixed. It also lets a
     native `setValueCurveAtTime` play on through a `cancelAndHoldAtTime` (2026-11-03), which is
     why the driver writes curves as ramps.

10. **Two copies of blits loaded together** share what each knows of its patches and channels
   (`src/shared.ts`, `test/copies.test.ts`; the schema page's motion section). blits-quarks,
   blits-tone and blits-panel take blits as a peer dependency, so **the range has to be widened with
   each engine minor**. `@msb235/blits/lean` leaves lanes out of a bundle (the site's lean guide has
   the sizes). Since 2026-10-30 no lanes module lands in a lean bundle (58.7 kB gzipped for `mix`
   alone, by an esbuild metafile): the sharing hooks reach the general path through `mix.share`,
   which an engine with lanes sets and a projection's copy keeps, and `pull`'s lane runs through
   `Lanes.pulls`. History (9.3 kB gzipped) is reached
   from 24 places in 12 modules and was left in.

12. **What the docs audit left** (2026-10-10).
    - **Not checked**: the page's timings and its table of consumers' kits, which are other
      repos' facts.

13. **The playground should offer everything in blits it feasibly can** (Mike, 2026-10-09). What
    is built is in its README; the calls made building it are under its "Chosen while building".
    Built 2026-11-04: save and open by file, the live mix's `ramp` and `mute`, a "read back and
    ahead" section under the inspector (`project`, `assess`, `trace`, `atRest`, `inert`), and score
    links for anchors on groups and to them, `angle` as a fold rule for `turn`, and blits' debug
    panel on `?panel`, over named mixes, with finished compiles `close`d. What is left:
    - **Unbuilt, each waiting on a call from Mike** (2026-11-04):
      - **Where a dot is beyond its grid place.** `put`, `within` with a signal of the author's
        own, and moving dots all need the composition to say where a subject is: a per-subject
        position expression, a voice whose channel moves the dot, or something else. That choice
        is a new composition field `load` must accept, and it decides whether `put` is offered.
      - **Recording level moves.** A slider move today plays live and is dropped by the next edit
        of that level. Recording it means a new composition field (a level's moves over score
        time), which then saves, shares and undoes with everything else.
      - **A booker with a clock other than the player's**, and **dragging a link from or onto a
        group header** (header lanes take no link drags), are both in the README's "Not in this
        version"; neither is blocked on anything but whether it is wanted.
    - **Found while building, Mike's to decide** (2026-10-17; the owner marks and the backward
      past-end frame found with these are fixed, in the changelog; whether turning an owner back
      brings back a child that left was decided yes under `history` and built, 2026-10-30):
      - **Does a staggered subject that has finished its passes show its last frame while its
        voice waits for the others?** Playing forward it does, with no `freeze`: staggers of 0
        and 200 on a 100 ms pass show the first subject's last frame from 100 to 300. Running
        back, the mirror case shows nothing (`waits for a subject staggered ahead of it` in
        `test/backward.test.ts`). The schema page says a voice shows nothing outside its passes
        unless it freezes, which only the backward case keeps.
        - Hold: running back, a subject that reached its start holds its first frame until the
          voice leaves, and the schema page would say a subject holds the edge it finished at
          while its voice plays.
        - Show nothing: forward, each subject drops its contribution at its own end, a visible
          change to every staggered finite voice shipped in 0.10.0. A staggered entrance would
          snap each subject back as it finishes, rather than hold until the voice fades.
    - **Timed, small and accepted under the tuning bound** (2026-10-17, `4a6cc4e`): a voice
      running back past its end showing nothing put one comparison per subject on the general path,
      a keys lane and a fn lane. On studio (7 rounds, `AB_EACH=1 bench/ab.sh 0b51634 6ef4985`, 19
      rows) the geometric mean is 1.008: `own` 1.02–1.03, `typing` 1.03, `keys` and `fn`
      1.00–1.02, the rest within 1.00 ± 0.02. If it is worth winning back, `own` and `keys` are
      where to look.
    - **Found while building** (measured 2026-10-17): a seek lands at the end of a frame, so a
      live change made at score frame f shows on seeking back to f, though play first showed it
      at f + 1; `player.test.ts` holds this. And in the Player, which meets every subject every
      frame, `catchUp: 'fresh'` differs from `exact` only for a voice starting partway through a
      frame with a `stepMs` under one frame; a `stagger` changes nothing.
    - **A bounded glow is offered through `around`** (2026-10-26): a weight's code can call
      `around(r, { ease })`, blits' `mix.around` over a circle of `r` dots on the stage's pointer, and
      the "bounded glow" preset uses it over 960 dots. Chosen while building (2026-10-26): no new
      composition field, since the circle is the pointer and the positions are the dots' column and
      row; and a composition whose code calls `around` keeps no history, since blits refuses a bound
      with history, so a scrub back there replays rather than seeks. Checked headless 2026-10-26: the glow follows the pointer playing
      and paused, and the stage canvas is capped at 400 px.
    Not worth offering: `mixer`/`Engine` (one engine), `as`, the color helpers, history paging
    without a store, and `ticker`, which would change only how the playground drives its frames.
    Also not offered (2026-11-04): `onWake` and `rebase`, which are about driving frames;
    `prepare`, which needs a history store; `affine`, `matrix` and `quat`, which flat dots and
    letters have no use for; and `waveAt` and `layersOf`, helpers a field could show but none asks
    for yet.

14. **What the 2026-10-09 code review left: consumers still working around step 7.** klieg's
    `level` is built on `input` with a `touch()` in its `set` (klieg `c32d440`, unreleased); whether
    its level-weighted voices then run on lanes is not checked. The other workarounds the review's
    "Universal applicability" table lists are still in klieg, sherpa, weasel and wod, and in
    `apps/playground` (`LivePanel`'s cast, `expr.ts`'s flag). The rest of the review is closed:
    what was chosen is in the schema page's "From the code review", what was left unbuilt is in its
    "Open", and how to measure, with what was tried and backed out, is in `bench/README.md`.

15. **astv's glides (+8%) and progress clocks (+39%) are unexplained** since 0.8.0, at 1 to 2 µs a
    frame with runs that disagree; the rest of what 0.8.0 cost under `history` was fixed in 0.8.1
    (the changelog's 0.8.1 section). To measure a blits build against astv's bench: `MOTION_ONLY=1
    probes/blits-version-bench.sh <out dir> 0.7.1` in `~/src/astv` on a fleet node.

16. **blits-rapier** (`packages/rapier`, built 2026-10-31; 0.1.0 published by hand 2026-11-01,
    trusted publishing registered after it, so later versions go out from `rapier-v*` tags). Its README
    says what it does and does not do. Kinematic bodies (`kinematic2`/`kinematic3`, `goal` and
    `facing` on core's rest-less `last` channels) and paging to a `store` are released in 0.4.0
    (2026-11-03). Open:
    - A seek's catch-up steps read the host as it is now (`sought.test.ts`, "steps a patch that
      reads the host again"), so the world keeps its own log of each frame's pushes, paged to a
      store as `host` records, and looks a step's up half a step early, since replayed step times
      round apart from the first pass's. If blits ever replays recorded host input on a seek, that
      log can go.
    - On a shared `transport` (released in 0.5.0, 2026-11-03) the host calls `sim.step()` after the
      transport's sync, and a store must be wrapped by `physicsStore`, since a transport's store is
      the transport's and the world has no other way to page into it (chosen over an engine hook
      for a mix's host records, 2026-11-03).
    - Calls logged by `impulse`, `drop` and `body` are never pruned or paged, by design, since a
      replay through them does them again; they grow per call, not per frame.
    - A kinematic goal's voice weight only switches it on or off (`last`); goals cannot crossfade
      by weight without a core channel that blends rest-less values.

17. **Drivers** (2026-11-03). `docs/drivers.md` lists what a driver has to handle, each rule with
    the bug that taught it, and `checkDriver` in `@msb235/blits/testing` checks what generalizes;
    blits-quarks, blits-tone and blits-rapier were audited against it and each runs it
    (`packages/*/test/conformance.test.ts`). Open, for the engine:
    - **Drivers cannot hear a seek.** rapier works out where one landed from `seq`, timestamps and
      `project({ frame: seq - 1 })`; `onWake` fires once until the next sync, so seeks while paused
      are missed. A seek notification, or a way to put a driver's own calls on the tape, would end
      the guessing, and make the tape's `switchBranch` and a plain `cue` after a seek cut rapier's
      calls ahead as they cut the tape.
    - **A store's `cut(seq)` on a seek back drops what a driver paged** (rapier's pushes), which a
      later seek forward past memory needs.
    - **`project` and `trace` show a body at the last synced world**: a patch cannot read another
      subject's state.

18. **What the gpu engine's reach left open.** All four phases are built: stock patches, staggered
    voices and voices reaching some subjects, owners and weight signals, and readback
    (`gpuOf(m).read`). The schema page's `#gpu` ("The gpu engine") says what folds, why, and what
    each part costs. Open from phase 4:
    - **At 1M subjects, 14 of 300 frames awaiting four `read`s took over 16.7 ms**, up to 147 ms,
      against a 3.155 ms median (`bench/runs/2026-11-04-gpu-readback.txt`): 10 mostly awaiting the
      reads, 4 mostly in `onSubmittedWorkDone`; unexplained.
    - `Readback` keeps each channel's newest `GpuRead` until `subjects()` or `close()`, about 32 MB
      at 1M subjects × 8 numbers, even after the host stops reading.
    - After a stretch of frames with no fold, `turn` copies the last fold, which `read` then turns
      down as more than one sync old before copying the current one: one wasted copy.
    - A spring's first fold leaves `mirrors.stirred` true, so the next `channel()` or `read` in that
      frame folds it a second time.
    - In `twins.ts`, a throw inside `check` (after the map settles) is an unhandled rejection, and a
      refused map leaves its staging buffer undestroyed.
    Open from phase 3:
    - **A frame where a scene starts costs 195–241 ms at 1M on the gpu engine**, about half in
      `sync` and half in the fold, against a 0.515 ms median (`bench/runs/2026-11-04-gpu-owned.txt`);
      unexplained.
    - `Met` keeps a voice met after `park()` (a seek back before its cue) and after a subject is
      dropped, where the CPU drops its records; storing `voice.seeks` with the mark would fix it.
      `read()`/`landed()` answering from that hook on a gpu mix is untested.
    - `Reads` forgets a voice's read times when it is absent from one read, so its next `dt` jumps
      to `now - since`; `dt` is per voice, not per subject (a subject met late gets the voice's);
      it resets `dt` on every seek, the CPU only on seeks that send back; no test pins `dt`
      within one frame.
    Open from phase 2:
    - **Answers never forgets a subject.** After a drop, or a part and unpart, a CPU-only mix asks
      `target` again, while one with a gpu side answers from what it kept; they differ only for a
      `target` that is not deterministic.
    - `Answer.reach` shows a faded-out named subject as reached. Harmless while parting voices stay
      on the CPU; lifting "it is parting from subjects" has to fix it first.
    - The kernel's pass index is `pass_base + q` in f32, exact only to 2^24 passes (a short loop
      played for many hours).
    - An unstarted voice that holds its first frame, after a seek ahead, shows time 0 in the kernel
      where the CPU's `shownAt` gives `anchorElapsed - delay`. Untested.
    - The timing-block span test compares against records made at the end; probing each frame
      would test records that moved.
    - `Mirror.prepare` takes positional optionals (`holds`, `unread`).
    Open from phase 1:
    - **One motion patch folded by two voices at once**, on one mix or two live ones, rebuilds
      their mirrors every frame, each taking the patch's one watch back from the other, unwarned.
    - **A motion whose `from` or `velocity` is not deterministic** can jump on the GPU when a subject
      is met and whenever its mirror is rebuilt: say so in the docs, or cache the first segment.
    - While a kernel compiles, a mirror with changes waiting re-runs the dispatch's start on every
      `channel()` call.
    - A function easing on a `keys` patch's first stop, which is never evaluated, still sends the
      patch to the CPU.
    - The binding-size guard keeps a voice on the CPU when `values` or `persub` would pass the
      device's `maxStorageBufferBindingSize`, but not the `out` and `subjects` buffers, whose
      `createBindGroup` still fails.
    - At 1M subjects a motion voice's re-anchor, every 2^14 ms of voice time, still costs one
      6.6 ms frame against a 0.4 ms median (`bench/runs/2026-11-03-gpu-anchor-after.jsonl`), most
      of it uploading every row's new time.
    - The light-board demo on the gpu engine still probes about 1,230 subjects a frame on the CPU
      (`bench/runs/2026-11-03-demos-keys-gpu.json`); unexplained.

## Loose ends

- **A staggered voice's end depends on which subjects the host has read, for a `target` voice**
  (2026-10-23; narrowed 2026-10-29). A voice cued with `subjects` asks `stagger` for each at cue
  and ends by all of them, through seeks too, so the determinism tests' `named` variant passes every
  property. A voice reaching its subjects by `target` still ends by the latest-staggered subject it
  has met, as `VoiceSpec.stagger` documents (decided 2026-10-29), so a read ahead or a replay with
  no reads can end it earlier than the live mix did, and `waiting` leaves those properties out.

- **weasel gaps blits still works around** (found on weasel 1.12.0, 2026-10-22; not rechecked since the move to 1.16.1, 2026-11-03). Since 1.16, labkit's `ControlPanel` lays rows out inline by default and sets layout only per panel or section, never per row; an inline `PropertyRow` keeps its label at full width, so a long label beside a slider widened three explainer pages at 390 px. The site now lets a slider row wrap (`.explainer-controls label:has(> input[type='range'])` in `site/src/styles/explainer.css`, 2026-11-04), which is close to 1.12 but not the same; worth reporting to weasel as a missing per-row layout. A leaf cannot set
  its own row layout or an accessible name apart from its label, so the booker's two rows and the
  level rows keep `fieldRow` in `CompositionControls.tsx`. The number leaves stay custom, since
  labkit's `.clearable()` takes only a fixed placeholder and a voice's `start` names its default
  by the voice's rate. `DiagramView` never reports where its first layout put nodes, so the Both
  tab reads it back by hand through `diagramLayoutOf(specs)`. Not used on purpose: a plain
  `ControlMatrix` grid, since `ChannelTiming` inherits.

- **Rows run earlier in one process change a later row's numbers.** Traced 2026-10-04 to the
  100k-subject `tweens` row: `fns^` reads about 117 ns a subject alone, 79 after the 10k
  `tweens` row and 214 after the 100k one (teitou). A dropped mix is freed
  (`bench/memory.mjs`), so it is the heap that row grew, not a leak. `AB_EACH=1 bench/ab.sh`
  runs each row in a process of its own.

- **A stale served-page tab overwrote `vocabulary.picks.json` four times**, most recently three
  times on 2026-10-07: the page kept its own picks in the browser and posted them whole on every
  click. semanticore `0c1df0c` posts only the roles a change touched. Until every browser that had
  the page open has reloaded on that build, `git diff` the picks file before trusting it.
- **A probe still pays for every channel in the kit, written or not** (2026-11-01). It resets
  each to rest. Blend-mode channels used to copy their rest anew each probe; they now reset the
  array `out` holds in place, as the stock array channels do (`foldsInto` in `channels.ts`). On
  16,128 subjects, 25 unwritten `multiply` channels went from 20.8 to 13.6 ms a pass, the cost of 25
  plain `color()` channels, and 25 `overlay` channels from 23.1 to 17.1, the rest of it writing
  their 18 numbers back (`bench/kitwidth.mjs`, `bench/runs/2026-11-01-kitwidth-ab.txt`). Skipping
  channels no voice writes would need the pose to stop promising rest in every channel. The blend
  modes example still gives its large view a mix whose kit holds only the mode it shows.
