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

- `main` at `git@github.com:orochi235/blits.git` — **public**; release 0.14.0 (2026-10-24), with blits-panel 0.2.0, blits-quarks 0.9.0 and blits-tone 0.4.0 taking it as a `^0.14.0` peer.
  blits-tone 0.2.0 was its first release through trusted publishing.
- **What shipped is in `CHANGELOG.md`; the calls made while building it are in the schema page's
  "Chosen while building"**, each the owner's to overturn, and the playground's and the DevTools
  extension's own calls are under the same heading in their READMEs (moved there 2026-10-24).
- **klieg's lighting voice needs `loop: true`** since 0.11.0 made `loop` default to one pass
  (`packages/core/src/render/lighting.ts`). klieg `dee96ba` gives it that, committed on klieg's
  `main` and not pushed (2026-10-11).
- **klieg's port is merged into klieg's `main`** (2026-10-02), and its step two shipped in klieg
  0.15.0 (merge `77d537d`, 2026-10-05). klieg reads `setting.host` through `mix<I, O, H>`. klieg
  moves onto `mix.arc` later; bree (`~/src/bree`, the marquee's home) builds against this checkout
  through a file link.
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
- **The package, `@msb235/blits` 0.14.0 on npm.** `src/` is the whole of it, with `types.ts` a
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
- **blits-panel and the DevTools extension.** `@msb235/blits-panel` (`packages/panel`) is on npm at
  0.2.0 and publishes from `panel-v*` tags through trusted publishing; an agent registers trust with
  `npm trust github`, and only an npm login needs Mike. Staging its first release left a
  `0.0.0-stage` version on npm; deprecating it needs Mike's 2FA sign-in. `node
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
  signal, handle, engine, pose, contribution, setting, timestamp, duration, phase, rest, weight, locus,
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

1. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits, all of it measurement
   now: the garbage a churned voice makes was cut from 21.5 to about 13 KB on 2026-10-11, and the
   file says what the rest is. Delete each item as it is dealt with, and the file once it is
   empty. Its speed items matter only if weasel adopts blits: klieg and
   magicsmoke are expected to run about two dozen voices over tens of subjects, under 1,000 subject
   × voice pairs, where a frame costs about 0.2 ms (2026-10-01 guess, not a measured
   workload). Two things that file records about the bench change how its numbers read: at
   `FRAMES=5000` the tween rows mostly time tweens that have landed, since each lasts 10 s, and
   `turnover^`'s `kB/frame` is mostly the row's own list copy.

2. **What is still slow.** Lanes, `pull`, `tween`, subject fades, a voice per node and crowds are
   built (the schema page's Lanes and motion sections, the changelog's 0.8.0 section); Mike set the
   goal as fast and capacious as possible, not a target (2026-10-02). Measure each change on the
   fleet before the next starts. `bench/same.sh <rev>` checks a change bit for bit (random scenes
   through two builds), `SAME_LANES=off bench/same.sh <rev>` compares this tree's lanes with a
   revision's general path, and `AB_EACH=1 bench/ab.sh` times one row per process. Open, largest
   first:
     - **A voice over every subject cued among a crowd** (`swap`: 10k one-subject tween voices, a
       voice over all of them replaced every frame) costs 2.19 ms a frame on msb-uai against 3.67
       before 2026-10-25 (`bench/runs/2026-10-26-place-all.txt`). A stateless fn voice sharing one
       record takes every numbered subject on its lane when it opens, where the host probed every
       subject the frame before (`placeAll` in `qualify.ts`), and the fill makes each one's first
       call (`Lane.every`); otherwise a probe meeting the lane makes it (`foldNow` in `meet.ts`).
       What is left per subject: relinking its chain (`relink.ts` `patch`, whose walk reads each
       record's voice, `linkable`, `sight`, and the `chains` WeakMap lookup), the fill's
       `open`/`one`/`call`/`shut`, the patch call itself, and the copy out, whose
       `pose[ch.name] =` store is two thirds of `copy`. A keys voice could take `foldNow` and
       `placeAll` too through `one`'s keys branch; a motion voice cannot, since `move` numbers the
       subject. Measured no different on `swap` and reverted (2026-10-26, against `d066f9a`, seven
       own-process runs): linking a voice stepped twice since a chain's version once (teitou,
       2.10 → 2.09 ms, U = 23); handing `foldNow` its met lanes rather than looking each up by id
       (teitou, 2.11 → 2.05, U = 12); skipping the chain walk for a voice no chain ever linked
       (msb-uai, 2.64 → 2.59, U = 13); sizing a lane's `records`/`deltas` and a sharing voice's
       `deltas` up front, which cut 2.0 MB a frame to 1.6 but not the time (teitou, 2.09 → 2.17,
       U = 15).
     - **A locus, and so a blend, costs about 40% more than its voices played apart**: on keiei
       (2026-10-25, `FRAMES=5000`, seven own-process runs) three voices in a locus over 10k subjects
       take 4.35 ms a frame, a `mix.blend` of three 4.63, and three plain voices 3.11. A member's
       numbers reach the locus unboxed (`gatherScalar`, `Arg.VALUE`), which took `locus` from 4.81
       and `blend` from 5.13, and a locus allocates no more than its members apart. What is left is
       the gather itself (`meetLocus`, two arrays per channel, `foldLocus`), about 41 ns a member a
       subject, and for a blend each member's `signalled` path, about 0.3 ms. Between `3c23212`
       (2026-10-11) and 2026-10-25 the `blend` row's members ended by frame 11, so ledger rows for
       `blend` and `blend-` in that span measured an empty mix. A locus with a motion member, or a
       signal that keeps state, stays on the general path.
     - **Starting 10k one-subject tween voices** takes a first frame of 28.0–31.0 ms against
       10.0–13.6 for fn voices (teitou, 2026-10-25, `bench/start.mjs`). The tween-only part: crowd
       `join` 1.8 ms, the motion patch's off-heap first buffer 1.5, a second numbering of the
       subject 0.7, and 1.1 more of collection. Measured no different and reverted: carving motion
       buffers from a shared slab, and keeping a named subject's record out of the WeakMap. Starting tweens
       slowed in 0.14.0 and is back on `main` (teitou solo, 2026-10-25, 7 rounds,
       `LINEAGE_BENCH=start.mjs bench/lineage.sh`): first frame 25.8 ms at v0.13.0, 29.2 at v0.14.0
       (U = 7), 24.9 at `594c0af` (U = 17, level); fns 11.9–12.1 throughout.
       Where starting allocates, garbage included (`bench/allocwho.mjs`, studio, 2026-10-25): a
       tween voice 6.7 KB over its cue and first frame, a fn voice 4.5 KB. Common to both, the
       `Voice` object itself is about 790 B (charged to `cue`, which allocates it; about 100
       fields) and its field objects another 820 B. Tween-only: the crowd's `rowOf` and
       `lanes.crowdOf` entries 184 B, `mix.playing` 92 B, `fresh`/`grow`/`Motions` about 450 B.
       Most `rowOf`/`crowdOf` reads are by voice id with no voice at hand (`placed`, `watchId`,
       `forget`), so moving a row onto its voice still needs an id map.
       Kept 2026-10-25: `Named` copies an array of distinct subjects without iterating it, and a
       one-channel patch's voices share `slots`/`lerps` (6.7 → 6.3 KB a tween voice, 4.5 → 4.1 a fn
       voice; first frame tweens 23.5 → 20.7 ms, fns 10.8 → 8.9, teitou, 9 rounds,
       `bench/runs/2026-10-25-named-writing.txt`). What is left in `Voice`: about 100 fields, 12
       of them boxed doubles (192 B a voice, the ones defaulting to NaN or ±Infinity); its cold
       fields are read from 2–26 files each, so a side object for them is a wide diff.
     - **A crowd's `keys` rows** cost about 27 ns a subject by `pull` (teitou, 2026-10-25,
       `keyses^` 0.270 ms), against 25 for keys voices over every subject (2026-10-05). Rows whose
       stops share phases and easings search and ease once per phase (`KeyRows.search`, keyed by a
       timing number given when a row is added); what is left per row is its lerp and fold. The
       search has to stay out of `fold`: inside it, `fold` stopped inlining and boxed each row's
       phase (+155 kB a frame, backed out).
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
   - **Where weasel-shaped `pull` spends its frame**, by a profile of 20,000 frames on teitou
     (0.35 ms a frame, 2026-10-03): the fill about 68% (`runMotion` 30%, the fold 12%, weasel's own
     easing 9%), the read about 29% (`pullRun` 14%, the column copy 11%).
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
   - **A weasel session reruns `animator-on-blits` and `pose-overrides`** against the lanes build
     before deciding its animator step 3 (weasel `c7a183bde`, branch `pose-overrides-mix`).

3. **Next for speed: the steady frame of 10k one-voice-per-subject tweens read by `pull`** (`tweens^`,
   `weasel^`), Mike's go 2026-10-05. Bare tween rows fill in one loop (`bare.ts`) and `pull` queues
   runs since 2026-10-05: on teitou `tweens^` took 0.17 ms a frame and `weasel^` 0.22 before the
   2026-10-24 changes below, against 0.031–0.047 for a hand-written loop doing the same
   arithmetic. What is left:
   - **Where the frame goes** (teitou, `--cpu-prof`, 2026-10-24): `tweens^` is 46% `bareRows`, 28%
     `pullRun`; `weasel^` 50% `runMotion`, 23% `pullRun`. `bareRows` inlines everything it calls.
     It does not pay for the bytes each row touches: in a model of its loop (`bench/layoutsim.mjs`,
     `bench/runs/2026-10-25-layoutsim.txt`), the same fields in arrays of their own saved 7%, and
     `hot` at stride 16 instead of 19 saved 2.5%. Removing one check at a time saved: the `per`
     read 11%, the id 4%, `MSLOT`/`MET` 5%, `SAMPLED` 4%, the easing memo 2%; all together 97 → 76
     µs, against 40 for the hand loop. The rest is filling values with rest, folding into them, and
     copying out. A new layout is not worth building (2026-10-25).
   - **Kept 2026-10-25**: `keepProbed` reads `per` only where the probed weight could change, and a
     fill running to the end skips row ids. teitou, 9 runs a side at `FRAMES=5000`: `weasel^`
     0.204 → 0.198 (U = 0.5), `tweens^` 0.169 → 0.166 (within noise). `fill.ts`'s `one` and `rest`
     still do the old copy.
   - **Kept 2026-10-25**: a bare row's `MSLOT`/`MET`/`SAMPLED` checks are made once and cached
     as `Flag.READY`, which `unbare`, `restale` and `unplace` clear. teitou, 9 runs a side at
     `FRAMES=5000`: `tweens^` 0.175 → 0.163 (U = 11), `weasel^` unchanged (it fills through
     `runMotion`, which keeps the checks).
   - **Two changes kept** (2026-10-24): a probe holds its subject for the next fill only while
     the last fill looked one up (`Lanes.holds`), which a fill of bare tweens never does; and
     `runMotion` reads a run's flags once in place of `bareAt`, `scalar` and `base`, and weighs a
     shared fade once rather than once a subject. keiei, 7 own-process runs a side at
     `FRAMES=5000` against `be0aaa4` (`bench/runs/2026-10-24-steady-pull.txt`): `tweens^`
     0.300 → 0.285 (U = 7), `weasel^` 0.391 → 0.369 (U = 7); `fns^`, `probed`, `named` and `fn`
     within noise. `bench/same.sh` read 0 differ, lanes on and off. One edge: a subject the host
     has let go entirely may now be collected before the next fill rather than held until it;
     only a later signal or `parting` lookup on that subject could notice.
   - **Counting `pullRun`'s probes and distinct subjects in locals measured no different**, so
     not worth re-proposing (msb-uai, 7 runs a side: `tweens^` 0.258 → 0.258, `weasel^` 0.291 →
     0.290; backed out 2026-10-24).
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
   - `named` at 10k reads two ways on identical code too (1.23–1.26 or 1.41–1.51 ms by process,
     teitou, 2026-10-25, `bench/runs/2026-10-25-named-split.txt`): one A/B can land all one side
     in the fast mode by luck.

4. **Reach is fixed at cue, so a voice whose contribution moves pays for every subject it might
   touch** (2026-10-07). A pointer glow is a weight signal run for every reached subject every
   frame. Its patch is not the cost: `at` has been skipped at weight 0 since 2026-10-04, and a
   `keys` patch's stops are now too (outside a locus, where a delta makes a voice a member; `step`
   still runs, since a skipped step cannot leave state as a run one would). What is left for each
   of the 98% of subjects out of range is reading the signal and keeping the record. Measured on
   msb-uai (2026-10-24, node to itself, load 2.6–3.0, `AB_EACH=1 bench/ab.sh` 7 rounds,
   `bench/runs/2026-10-24-glow-branch.txt`), a glow over 10k subjects adds to the voice under it

   | Read | glow, `gain` | glow, `gain` + `hex` | glow, `gain` + `color()` | `keys` glow, `gain` + `hex` |
   |---|---:|---:|---:|---:|
   | probe | 0.80 ms | 1.17 ms | 0.93 ms | 1.28 ms |
   | probe, lanes off | 0.92 ms | 0.90 ms | – | 1.00 ms |
   | `pull` | 0.54–0.64 ms | – | – | 2.34 ms |

   on a voice alone of 1.55 ms by probe and 0.82–0.93 ms by `pull` (which spreads across runs).
   A `hex` column still takes the glow's voice and the one under it off the lanes; `color()` runs
   on them, so that half is solved by moving to `color()`, not by reach.

   Where the glow's lane read goes, by `pull` (`bench/glowparts.py 7 glowbase^ glow^`, msb-uai,
   2026-10-24, `bench/runs/2026-10-24-glow-parts.txt`): 0.56 ms per 10k subjects, 56 ns a
   subject. Of that, the bench's own signal is about 16 ns, two-thirds of it `Math.hypot` (sqrt
   instead saves 0.10 ms). `base` around the call costs 4 ns, `prime` 5 ns, and `call` at weight
   0 another 7 ns. The rest, about 15 ns, is `one`'s own bookkeeping for the subject. No one piece
   is worth a change on its own: skipping `call`'s setup at weight 0 measured level to 4% slower
   by `pull` and was backed out (2026-10-24, ledger). A lane fills a voice's `timestamp`,
   `elapsed` and `pass` once per placing (`Arg.MARK`, 2026-10-25, built on `Setting` going
   read-only), refilling only `dt`, `weight`, `state` and `keepOn` a subject; on keiei `glow^` went
   from 1.708 to 1.657 ms and `signal` from 4.641 to 4.511, so about 3 ns of `prime`'s 5.
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

     What bounds would still save, after the skip: the glow's lane read, about 0.56 ms per
     10k subjects by `pull` on msb-uai (56 ns a subject, 16 ns of it the signal itself;
     2026-10-24). Only a bound the mix can answer without visiting
     each subject saves it: a per-subject test against a radius is the signal call again.
     So the signal bound pays only with a spatial query over the host's positions, kept current
     as they move, and the patch bound is the same query with a radius that changes by phase.
     A reach that changes each frame also moves subjects on and off a voice's chain and lane. What
     made that look dear on 2026-10-11 (moving rows allocating 1.9–2.3 MB a frame against 1.2 MB
     still) was mostly not the moving. A lane fill boxed 3–5 numbers a subject in some processes and
     none in others, on the same row, by which nested call V8 left out of line in `one`, which turns
     on the order its compiles ran. Measured 2026-10-20 (`bench/allocs.mjs`,
     `--trace-turbo-inlining`, local, Node 26.10 and 26.11): `stale:0`, with nothing moving, read
     1.19 MB a frame in some processes and 1.99 in others, and raising V8's inlining budget put
     every process at 1.19; `part:200` read 1.42–1.93 MB in every process, by node. The numbers now
     cross those calls through typed arrays (`Lanes.arg`, `Mixer.primed`), and every reach row reads
     one allocation figure in every process (local, Node 26.8, 26.10, 26.11). Under `--cpu-prof` on
     msb-uai `stale:0` still read 1.82 MB once, so profiles of these rows can land in the boxing
     shape.

     The guess that a lane refills its columns for a stale chain is wrong. Counted with a call
     counter (local, 2026-10-20): one `fillAll` and the same 10,122 `one` calls a frame at `stale:0`
     and `stale:200`. Marking 200 chains stale a frame costs 0.1–0.5 µs a chain (`stale:200` less
     `stale:0`, on msb-uai, keiei and teitou; the `stale:<K>` rows now stamp chains through
     `unlink`, so a `pull` relinks them too, which it did not before). After the fix, on teitou
     (`bench/reach.sh 3`, 2026-10-20, medians of three processes, 10,000 subjects, 200 in reach):

     | 200 pairs a frame | voice alone | full glow | `part` | `drop` | `own` | nothing moving |
     |---|---:|---:|---:|---:|---:|---:|
     | probe | 1.143 | 1.663 | 1.357 (59%) | 1.614 (9%) | 1.570 (18%) | 1.228–1.295 (71–87%) |
     | probe, lanes off | 1.361 | 2.004 | 1.544 (72%) | 1.539 (72%) | 1.680 (50%) | 1.415–1.444 (87–92%) |
     | `pull` | 0.652 | 1.117 | 0.851 (57%) | 1.191 (−16%) | 1.035 (18%) | 0.710–0.742 (81–88%) |

     (ms, median frame; in brackets the share of what the glow adds that the way keeps.) On keiei an
     earlier build of the same fix gave `part` 73%, `drop` 32% and `own` 35% by probe. A pair now
     costs `part` 0.3–0.7 µs, `drop` about 2 µs and `own` about 1.6 µs by probe. A profile of
     `part:200` against `stale:0` (msb-uai) spreads a pair over its two relinks (about 0.3 µs), the
     entering subject's first fold of the glow on the general path (about 0.5 µs) and the fade calls
     (about 0.3 µs; rough, since `stale:0` ran in the boxing shape there); no one function holds it. `drop` adds renumbering, a `WeakRef` and a registry
     entry a subject, and `own` a voice cued and retired a subject. The 2026-10-11 disagreement at
     two pairs a frame fits the boxing shapes too (inferred, not rerun).

     So bounds are worth building for a moving reach now, on `part`'s mechanics: a subject leaves
     and enters a voice's reach without the mix forgetting it, which keeps 57–73% of the glow's cost
     at 200 crossings a frame, and more as fewer cross (inferred). Not on `drop` or a voice a
     subject, which keep 9–35% with lanes on and lose by `pull`. The fix costs the `signal` row
     (three signal-weighted voices over 10k) 3–7% in three A/Bs, inside its spread each time but
     always the same way; not chased.

5. **Work nobody will see** (2026-10-07). A lane fills only subjects probed this frame or the last
   (CHANGELOG 0.8.0), which does nothing for astv's shape, the `typing` row: at 2% probed every lane
   already rests, and astv's real text runs write `last` over row objects, which no lane runs. A
   profile of `typing` (teitou, 20,000 frames) puts about 55% in the general path's fold, 11% in lane
   bookkeeping and 11% in voice clocks. The other two cases, too fast to see and flicker, are
   decided (the schema page's Decided against). A reach that changes over time (item 4) is another
   way to say offscreen.

6. **`color({ lerp: 'oklch' })` runs on lanes** (2026-10-25), vouched `{ op: 'own', axes: 4,
   folds: 'sum' }`: a lane folds it as a plain sum and, where a lane interpolates (`foldKeys`,
   `KeyRows.add`, `gatherInto`), calls the channel's `lerp` (`Laned.straight` false), so `lerpLch`
   is the one OKLCH lerp both paths use. A copy of blits that predates `folds` folds it as `'own'`,
   correctly, so `numeric@1` kept its version. On keiei, alone on the node, 7 rounds, 10k subjects
   (`bench/runs/2026-10-25-oklch-lanes.txt`): `hues` 2.90 to 1.38 ms by probe and 3.29 to 0.67 by
   `pull`, against 5.10 with lanes off; `glowo` 3.26 to 2.63. Open, Mike's call: a `tween`,
   `spring` or `glide` on an oklch color still moves straight across each OKLab axis on both paths,
   since motions never call a channel's `lerp`.

7. **blits-quarks and magicsmoke.** magicsmoke is on engine 0.8.1 but its fizz and tuning stay on
   its own code: the driver doesn't fit without changing what magicsmoke does. Its
   `docs/HANDOFF.md` has the gaps; the likely driver changes are a per-subject emitted count from
   `write`, rate or counts settable by the host, and rounding without the `1e-6` slack. Mike's call
   whether to make them. `@msb235/blits/testing` (`setting`, `checkPatch`) is the authoring kit; the
   driver scaffold the survey proposed is this same question.

8. **blits-tone.** Its README says what it does and does not do yet. Open:
   - A read of the mix over a window, returning a run of values or a `keys` voice's own
     breakpoints as exact ramps, in place of a `project` per grid point (31 a write, and only
     as exact as the grid). Useful beyond audio.
   - Mix time converted to the outside clock while `mix.rate` ramps; the driver reads
     `mix.rate` as it stands at each write, which drifts during a ramp (3.59 Hz in its test).
   - **`apps/fireworks`**, which plays one mix through this driver and the quarks one, has never
     been listened to. It still packs pan and size into each event and could read them off the
     shell, since a booked hit carries its voice's `subjects` (2026-10-11).
   - **`node-web-audio-api` 2.2.0 frees a channel's samples under a live array** (2026-10-11):
     the `Float32Array` from `getChannelData` reads freed memory once its `AudioBuffer` is
     collected, so `render` in `packages/tone/test/render.ts` copies them. Upstream knows:
     ircam-ismm/node-web-audio-api issue 80. The copy can go once that is fixed.

9. **Two copies of blits loaded together** share what each knows of its patches and channels
   (`src/shared.ts`, `test/copies.test.ts`; the schema page's motion section). blits-quarks,
   blits-tone and blits-panel take blits as a peer dependency, so **the range has to be widened with
   each engine minor**. `@msb235/blits/lean` leaves lanes out of a bundle (the site's lean guide has
   the sizes). What lanes code still lands in a lean bundle, and why (esbuild metafile, 2026-10-21,
   51.1 kB gzipped in all): `everyone.ts` (2.8 kB), since a dozen general-path modules call its
   sharing hooks though no voice shares without lanes; `columns.ts` (2.1 kB), from `pull`; and
   `crowd.ts`'s `crowdable` (146 B), from `fits` in `hosts.ts`. History (9.3 kB gzipped) is reached
   from 24 places in 12 modules and was left in.

10. **The history adapter** (the schema page's "History behind a store") **has not been reviewed
    by Mike.** astv marked its text-run weight `input` (astv `522624e0`); it now names its mixes,
    describes its voices with `as` and gives a store once it moves to a release with this.

11. **astv's change order runs on a span** (astv `dfc8df5a`, on 0.12.0, 2026-10-23). weasel's
    packages still pin 0.11.0, which astv overrides to keep one copy.

12. **What the docs audit left** (2026-10-10).
    - **A voice cued before the mix's first sync starts at 0 on the host's clock, not at that
      sync** (measured 2026-10-11): a one-pass 1 s voice cued before `sync(5000)` has ended
      when it is first probed. `VoiceSpec.start` said "Default: the next sync" and now says
      what happens. Whether it should start at the first sync instead is Mike's call; a page
      that cues before its first `requestAnimationFrame` meets it.
    - **Not checked**: the page's timings and its table of consumers' kits, which are other
      repos' facts.
    - **Most panel fields commit on every keystroke**, so typing `1500` into a mark's time is
      four undo steps; only the stage, title, length, level, read-ahead and expression fields
      go through `Draft` or `ExprInput`. The README says so; whether the rest should commit
      on Enter too is Mike's call.

13. **The playground should offer everything in blits it feasibly can** (Mike, 2026-10-09). What
    is built is in its README; the calls made building it are under its "Chosen while building".
    What is left:
    - **Found while building, Mike's to decide** (2026-10-17; the owner marks and the backward
      past-end frame found with these are fixed, in the changelog):
      - **Should turning an owner back bring back a child that has already left?** It does not:
        two children back to back, the owner turned at 450, the first never shows again and
        the owner leaves with the second at 600. A child that left is done, its `done` resolved
        and its records let go, and only `mix.seek` brings a voice back.
        - Yes: a child leaves for good only when its owner does. The owner keeps every child
          it held, records and state, for as long as it plays, so memory grows with each one;
          a child's `done` and `played` can settle and start over with no seek, which only a
          seek does today; and a child's `end` mark is no longer final.
        - No, as built: turning back plays only what the owner still holds. A group meant to
          run back whole is cued with `freeze: 'after'` on the owner, so each child stays
          frozen at its end and runs back with it (checked 2026-10-17), and is faded when done.
          The owner table's `rate below 0` row in the schema page would say so.
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
    Every change measured goes in `bench/ledger.tsv`, kept or backed out: `LEDGER="<what it does>"
    LEDGER_NODE=<node> LEDGER_FRAMES=<frames> node bench/medians.mjs <output>` appends its rows
    (with `LEDGER_REV` naming the commit a `.` stood for, and a change backed out written
    `(backed out) ...`), and `node bench/ledger.mjs [row]` lists each row's entries with the product
    of the kept ones' ratios (Mike, 2026-10-20). Time a history row (`kept`, `seek`, `back`) at
    `FRAMES=1500`: at the default 300 its 5 s window fills only as the run ends, so nothing it lets
    go of is measured. `bench/lineage.sh <rounds> <rev>... -- <rows>` runs this tree's bench over
    any number of builds, releases included, and `bench/lineage.mjs` tables it; `frame.mjs` takes
    `form:n:v` for a row its list does not hold, such as `fns-:10000:1`. Every run's raw output goes
    in `bench/runs/<date>-<what>.txt`, headed by a `#` line naming the node and the command, before
    it is reduced; the ledger's `raw` column names it (Mike's rule, 2026-10-20). Leave `seek` out of
    a run over releases before 0.11.0, or give it its own: v0.7.1 takes 1.2 s a frame on it, so the
    first run over releases (`bench/runs/2026-10-20-releases.txt`) hit its 90-minute limit in
    round 2. What it got, one or two runs a cell at 10,000 subjects, v0.7.1 to `main`: `seek`
    1,234 to 5.37 ms. The rerun without it (`bench/runs/2026-10-20-releases-no-seek.txt`, 5 rounds)
    reads `fn` level across every release (2.29 to 2.27), `keys` 1.28 to 1.06, `kept` 5.45 to
    5.19, and allocation down at every row but `keys-`.
  - **`glow` read 5.5% slower than at 0.10.0, and most of it is back** (2026-10-20). With the
    bench reading subjects by index (its `for...of` allocated a result a subject in some processes,
    which made every probed row two-moded), v0.10.0 against `11a1471` read `glow` 1.603 to 1.691 ms
    (U = 0) and `glowbase` 1.180 to 1.120 (U = 0), so the cost was the signal-weighted glow voice's.
    It arrived in `6ef4985`, whose `frozenAt` check for a voice hiding past its end left the
    function out of line in a lane fill's `one`; writing it out there read 1.696 to 1.636 at 15
    rounds (U = 47). The rest, about 2%, is not placed. `crowd.ts` still calls `frozenAt` for a
    crowd's freezing voices, unmeasured. Runs: `bench/runs/2026-10-20-glow-*.txt` and
    `-frozenat-*.txt`.
    - **The calls this work made** (`out` arrays reused, step 7's names, the `writes` warning,
      `seek({ frame })`, `catchUp: 'fresh'`, playing backward) are in the schema page's "Chosen
      while building". Mike has not seen the first two.
    - **Undecided behavior, as found** (the fuzzers' or the build's account of each):
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
      - **A child whose owner runs backward**, left as found (2026-10-11): its `start` and `in`
        marks read where the owner's clock will next read the child's start (400 for an owner
        turned back at 200), as any retime of an owner moves them; and a child that itself runs
        backward under a backward owner, forward overall, has no test.
    - **Not built**, and nothing recorded against any of it:
      - Records shared by a read back or a standing read, and by voices `shares` (in
        `everyone.ts`) turns away that could keep their difference by subject number too: a
        stagger, a signal weight, a motion.
      - `catchUp: 'fresh'` per voice; exact catch-up is the default, and a voice keeps at most
        256 past clocks.
      - `seek({ frame })`, for an earlier frame at the same mix time.
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
      - **A seek back and its return cost about 1.9 ms at 10,000 subjects** (msb-uai,
        2026-10-20, `AB_EACH=1 bench/ab.sh a0a5bf4 c101d90 9`, medians of `a0a5bf4`'s 9 runs, ms
        a frame). The `kept` rows sync and probe a mix keeping 5 s of history and a tape; the
        `seek` rows also seek it 300 ms back and to where it was before every sync.

        | Subjects | `kept` | `seek` | A seek back and return |
        |---:|---:|---:|---:|
        |  1,000 | 0.627 | 0.861 | 0.234 |
        | 10,000 | 7.224 | 9.089 | 1.865 |

        At 10,000 subjects one build's `seek` runs spread 8.67 to 10.07 ms, so a change worth under
        about 5% there does not show in 9 rounds. The row allocates 8.2 MB a frame. A relink hands
        each voice the record the subject's old chain held for it (`linkAll` in `src/chain.ts`), and
        `Restored.find` takes it without a `WeakMap` lookup where its stamp is one that store made:
        a record the store lets go of is stamped `gone`, a copy carries no stamp, and setting a
        stamped record again turns the shortcut off for that store (`sure`), as it could then sit
        under a second key. In `bench/same.mjs` scenes with seeks 87% of finds take the shortcut and
        none turns it off (counted locally). A record put back steps once a frame, as an unsought
        one does: it takes up the state of the record the seek replaced (`left` on the copy's
        `Ahead`, `ahead` in `src/contribution.ts`), under `stepMs` with no `maxDt` for a patch that `reads`
        no host field. A seek keeps every subject's number and chain (`renew` in `src/lanes.ts`;
        `headOf` reads such a chain as absent until it is linked). A reaching record the store alone
        holds is written over with its copy (`copyHeldInto`), and a probe's kept copy is written
        over one the seek cut (`spares` on the voice). `Restored` stamps a record with the seek it
        was put back at; stamps of seeks to as early a moment are joined by union-find and the roots
        are held weakly, so what the store keeps is bounded by the records alive
        (`test/restored.test.ts`). Within one synchronous job nothing a weak reference reaches is
        collected, so a host seeking in a loop without yielding holds a stamp per seek until the job
        ends. Tried and backed out: writing a spare copy's state clone into the spare's own state
        object where no record was lent it (`7768e08`, reverted in `d1ef4fe`). It was exact and cut
        0.72 MB a frame, but read 9.52 ms against 9.32, inside the spread, and a local profile put
        4.3% in the in-place copy against 3.1% in the clone it replaced: its two walks over the keys
        cost more than the allocation saved. Also tried and backed out: putting records back through
        one class's methods (`Sought`, implementing a `PutBack` interface `Restored` calls) in place
        of the 2 closures `restoreVoice` made per voice (`c101d90`, reverted in `b6e8f88`). It was
        exact and a local profile showed the closures' self time (about 11% between them) gone, but
        `seek` read 8.852 ms against 9.089 at 10,000 subjects and 0.829 against 0.861 at 1,000, with
        rank tests short of chance (U = 28 and 22.5, where p < 0.05 needs under 17). Not built:
        skipping the put back of a record stepped on from the copy it would be put back from, which
        a profile names as the lever (9% in `keptOf`, the first read of that copy). An inexact build
        that skipped every read of the copy (`restore`, `ahead` and `own` in `src/contribution.ts`) read
        8.400 ms against 8.766 in 5 rounds with the runs overlapping (measured), so the most an
        exact skip can save is about 4%: by the profile's line the cost is a cache miss, and
        skipping that read likely moves the miss to the next read of the record rather than removing
        it (inferred, not measured). An exact skip needs every field the put back copies
        (`copyHeldInto`'s list) shown equal on the record, against writers in the probe, lanes,
        `origin`, `setting.keep` and `from: 'current'`, or the copy's fields cached on its `Ahead`,
        which grows that object by about as much as the read it saves. A narrower inexact skip (no
        field put back from the copy where its `Ahead` stepped on from fewer ticks) reads 403 of
        2,000 scenes differing under `SAME_SEEK=1`, lanes on or off, and fails 7 tests across
        `test/sought.test.ts`, `seek`, `restored` and `history`, so either catches a skip made where
        it should not be (measured). The `kept` rows do not relink; on this Mac a 10,000-subject
        `kept` run lands near 5.5 or near 7.5 ms by how far V8 grows its young generation
        (`--max-semi-space-size` 4 against 32 gives either), so read that row over many rounds. A
        `step` reading `setting.weight`, `elapsed` or `pass` shows what a mix never sought shows
        after a seek back and return (`test/sought.test.ts`); after a seek back that stays, its
        steps up from the copy still run under the probe's setting.
      - **Keeping history costs less a frame** (2026-10-20, branch `perf-history`; the ledger has
        each change's rows). A copy let go of from the 5 s window is written over as the next one
        kept (`remember` in `src/history.ts`); `reading.horizon` is worked out only for a motion
        voice, the only patch that reads it; and a stock `sum`, `mul` or `max` channel of one axis
        folds through `foldNumber` in `apply` (`src/fold.ts`) instead of the channel's `scale` and
        `merge`, whose call boxed a double. Each is exact under `bench/same.sh`. Tried and backed
        out for moving no row: storing a channel's primitive rest without `copy` (`f1523e0`).
      - **Lanes lose to the general path where each subject has one `fn` voice** (keiei,
        2026-10-20, five runs each in its own process, ms a frame, lanes on against off):

        | Row | On | Off |
        |---|---:|---:|
        | `fns`, a `fn` voice per subject | 1.93–2.15 | 1.42–1.56 |
        | `weaselfn`, weasel's animator as `fn` voices | 2.00–2.10 | 1.68–1.74 |
        | `own` at 1,000, a voice per subject | 0.225–0.233 | 0.206–0.214 |
        | `tweenfn`, one `fn` voice writing a vec | 1.51–1.59 | 1.26–1.30 |
        | `fn`, three `fn` voices over every subject | 3.38–3.56 | 4.78–4.97 |
        | `glowbase`, one `fn` voice writing a scalar | 1.69–1.76 | 2.02–2.07 |
        | `tweens`, a tween per subject | 0.95–0.98 | 1.72–1.89 |

        A crowd of per-subject voices a lane evaluates itself (`tweens`, `springs`, `keyses`,
        `weasel`) wins on lanes. **A crowd of `fn` voices writing only arrays now runs off lanes
        where no other fitting voice writes its channels** (2026-10-21, `keepCallsOff` and `calls`
        in `src/qualify.ts`): its patch is called once a subject either way, and the lane's fill
        walks the subjects a second time. One build timed with the rule on and off (`CALLS_OFF=0`
        in `bench/frame.mjs`, through `bench/rows.sh`; msb-uai, 9 rounds of 1,500 frames, ms a
        frame): `fns` 1.348 against 1.519, `named` level at 1,000 and 10,000. Before the rule was
        limited to arrays, the same sweep read `named`, a crowd writing numbers, 17% to 25% slower
        off lanes with no overlap between runs (`bench/runs/2026-10-21-calls-off-sweep.txt`), so a
        crowd writing a number stays on lanes. Comparing two builds misled here: `fns` reads in
        modes by build (about 1.10 ms with 1,333 kB a frame, or 1.34 with 1,178), and two builds
        running `fns` down the same path read 0.825 at U = 0. Time a lanes change on such a row
        with a switch in one build, not with `ab.sh`. `bench/abdirty.sh` A/Bs an uncommitted diff
        with no commit on origin. Tried and backed out: answering a probe with nothing laned at the
        top of `Lanes.prepare`, which read every row within 1% in one build
        (`bench/runs/2026-10-21-prepare-shortcut-one-build.txt`). Mixed with a tween or keys crowd on the same channel, an `fn` crowd
        still runs on lanes and pays the second walk, and that is the faster way: on `mixed` (half
        the subjects a tween, half a `fn`, both on `position`) it read 1.306 ms a frame, against
        1.441 with the channel taken off lanes and 1.380 with the mix's lanes off (msb-uai,
        2026-10-21, 9 rounds of 1,500 frames, `bench/runs/2026-10-21-mixed-crowds.txt`, where
        `CALLS_OFF=2` was an experiment switch, not kept). The 1.441 against 1.380 is what a mix with
        lanes on pays with nothing laned, about 4%. **Most of it is now gone** (2026-10-21): a
        profile put about 0.10 ms of `fns`' 0.18 ms gap in `prepare`, `begin`, `filled`, `general`
        and `linked`'s call to them (`bench/runs/2026-10-21-lanes-idle-profile.txt`), and `linked`
        in `src/fold.ts` now answers such a probe itself, still stamping the subject's
        `GENERAL_PROBE`. One build with a switch (msb-uai, 13 rounds): `tweenfn` 0.936, `weaselfn`
        0.954, `fns` 0.964, `named` level and `mixed`, which has lanes running, 1.029 inside its
        spread (`bench/runs/2026-10-21-lanes-idle-confirm.txt`). Leaving the stamp out read about
        9% on teitou, but a voice coming back onto a lane could then report a stale `weightOf`, so
        it was not built (`bench/runs/2026-10-21-lanes-idle-sweep.txt`). **So does a lone `fn` voice over many subjects writing vecs**
        (2026-10-21), where it is the only such voice on its channels; two or more fold faster on
        lanes. Same sweep (`bench/runs/2026-10-21-calls-off-lone-voice.txt`): `tweenfn` 1.163
        against 1.410 at 10,000 and 0.124 against 0.134 at 1,000, `weaselfn` 1.734 against 1.823,
        three `tweenfn` voices left on lanes and level, `named`, `glowbase` and `fn` level. The rule
        covers channels with an array rest that are not `last` (`vector`): a lone voice on
        `color(last())` stays on lanes, and one on `color()` was not timed. `own`, a voice per
        subject chosen by `target`, writes numbers and is unchanged: taking such voices off lanes as
        a crowd read 0.150 to 0.142 ms at 1,000 subjects with the runs overlapping, against 0.131
        with lanes off (teitou, `bench/runs/2026-10-21-targeted-off-experiment.txt`), so it was not
        kept. `glowc` and `glowkeys` read on lanes
        slower too (3.3 against 3.0) because nothing in them runs on lanes (their glow voice writes
        `color`, a `last` channel with its own lerp, which closes `gain` for the flicker) while the
        flicker still shares one record, which every read points at its subject and back.
      - **A voice over every subject shares one record for its first 60 frames only** (2026-10-21,
        `outgrow` in `src/everyone.ts`; not a keys voice, whose shared read costs nothing more).
        Sharing was built for voices cued and gone within frames (`swap`, 8,064 to 3,875 kB a frame,
        2026-10-09) and nobody had timed it on a voice that stays: with `shares` returning false,
        `glowc` read 0.898, `glowbase` 0.915 and `tweenfn` 0.923 (teitou, 7 rounds, U = 0 each;
        `bench/runs/2026-10-21-never-share.txt`). Against `a77c5c9`, unsharing at 60 frames read `fn` and
        `glowc` 0.89 to 0.95 and `glowbase` and `tweenfn` level, but one build timed at each count
        (`SHARE_FRAMES` in `bench/frame.mjs`; keiei, 7 rounds of 1,500 frames,
        `bench/runs/2026-10-21-share-frames-sweep.txt`) reads every count ahead of never: against
        never, 60 is `fn` 1,000×8 0.92, `glowbase` 0.95, `tweenfn` 0.96, and 1 is 0.86, 0.92 and 0.94.
        60 is a guess at where about 2 MB allocated once at 10,000 subjects pays for 0.13 ms a frame,
        not measured.
      - **What the keyed store of a rest into the pose costs**: `pose[key] = copy(rest)` in
        `foldWith` is 15% of the `tweenfn-` row's samples, a store V8 cannot specialize since `key`
        varies. Storing the bench kit's two primitive rests by name (`pose.gain = rest`), the most
        a function made per kit from source text could do, read `tweenfn-` 0.947 (U = 1) and four
        other rows level (keiei, 2026-10-20, 7 rounds against `f727ff7`; the ledger's
        "ceiling" entry), so it was not built.
      - **The `kept` row's two plain voices never run on lanes**: they write `dark`, which its
        stateful voice also writes, and `qualify` closes a channel any voice that does not fit
        writes (read 2026-10-20). So the history rows measure the general path alone.
      - **A fleet node's copy of blits may have a stale `node_modules`** (found 2026-10-11): its
        `@weasel-js/history` had no `timestampAt`, so the bench's `kept` and `seek` rows failed.
        A bench job that runs `npm ci` first works (msb-uai and keiei, 2026-10-20).
    - **Few consumers use step 7 yet.** klieg's `level` is built on `input` with a `touch()` in
      its `set` (klieg `c32d440`, unreleased); whether its level-weighted voices then run on
      lanes is not checked. The other workarounds the doc's "Universal applicability" table
      lists are still in klieg, sherpa, weasel and wod, and in `apps/playground` (`LivePanel`'s
      cast, `expr.ts`'s flag).

15. **astv's glides (+8%) and progress clocks (+39%) are unexplained** since 0.8.0, at 1 to 2 µs a
    frame with runs that disagree; the rest of what 0.8.0 cost under `history` was fixed in 0.8.1
    (the changelog's 0.8.1 section). To measure a blits build against astv's bench: `MOTION_ONLY=1
    probes/blits-version-bench.sh <out dir> 0.7.1` in `~/src/astv` on a fleet node.

16. **What the `setting.dt` fix left** (2026-10-10; the decision is in the schema page's "Chosen
    while building"):
    - **The first `dt` after a voice stops sharing its record counts from the subject's origin**,
      since each subject's own record starts fresh (`unshare` in `everyone.ts`).
    - klieg's `it.fails` test for this (klieg `TODO.md`) should pass on any blits release since
      0.9.0; nobody has checked.

## Loose ends

- **A staggered voice's end depends on which subjects the host has read** (2026-10-23). A finite
  loop leaves once the latest-staggered subject it has met is done, so a read ahead or a second seek,
  which meet no subject, can end it earlier than the live mix did. The determinism tests' `waiting`
  variant leaves those properties out, as `fresh` does. Whether a voice should end by the subjects
  the mix knows instead is Mike's call.

- **weasel gaps blits still works around** (on weasel 1.12.0 since 2026-10-22). A leaf cannot set
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

- **A host editing a pose the mix allocated changes what `from: 'current'` reads.** `probe`
  without `out` keeps the pose it returns as the subject's last, by reference, so a held voice at
  `[10]` whose pose the host set to `[500]` was retargeted from 500 (checked 2026-10-04). Whether
  that is wrong is undecided: it is what the host showed, and copying would cost every probe
  without `out` an allocation.

- **A stale served-page tab overwrote `vocabulary.picks.json` four times**, most recently three
  times on 2026-10-07: the page kept its own picks in the browser and posted them whole on every
  click. semanticore `0c1df0c` posts only the roles a change touched. Until every browser that had
  the page open has reloaded on that build, `git diff` the picks file before trusting it.