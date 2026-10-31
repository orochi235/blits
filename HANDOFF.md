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

- `main` at `git@github.com:orochi235/blits.git` — **public**; release 0.16.0 (2026-10-30), with blits-panel 0.4.0, blits-quarks 0.11.0, and blits-tone 0.7.0 taking it as a `^0.16.0` peer.
  Pushing all three driver tags at once leaves the middle run canceled (the `release` concurrency
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
- **The package, `@msb235/blits` 0.15.0 on npm.** `src/` is the whole of it, with `types.ts` a
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

## Next, in order

1. **What the stress demos found** (`apps/stress`, built 2026-10-30; its README says what each
   demo loads and checks). Fleet runs: `bench/runs/2026-10-31-stress-short.txt`, from after a
   review made the checks able to fail (the first round is `2026-10-30-stress-short.txt`), with
   each run's raw records beside it. Each correctness finding below is a `test.fails` in
   `test/stress-findings.test.ts`, which flips to failing once fixed; then drop the `.fails`.
   - **`from: 'current'` keeps the speed, and the docs say it does not.** `blending.mdx` says such a
     fade carries position, not speed; CHANGELOG 0.2.0 and `src/patch.ts` bend its start to the
     subject's speed, so a still fixture's linear fade eases in, and the first such fade a mix
     plays runs straight, since no poses are kept until one is cued. Undecided which is right
     (cues demo, frame 440: 0.6501 against 0.6529 straight).
   - **`pull` on the heatmap is slow, and slower with lanes than without.** 5,000 springs with an
     `ink` channel weighted by per-cell `input` signals: 5.6 ms a frame to read with lanes on and
     4.2 with lanes off (studio, load 1.6 and 2.6, one run each), 85 ms at 50,000; `tweens^` reads
     10,000 in about 0.17. Which of the springs, the signal weights or `ink` costs it, and why lanes
     lose here, is not measured: time the heatmap with each swapped out, on a quiet node.
   - **The rig's quats read in 1.2 ms for 1,000 bones** (`pull`, 70 voices), with lanes on only
     about 20% faster than off: the off-lane path for quats in `keys`, named under item 14.
   - **Gaps, things the demos had to do themselves:** a voice's weight cannot cover some
     components of a `vec` and not others (the rig's IK y-hold; weasel's item in
     `NOTES-FROM-WEASEL.md`); a mix's `rate` cannot go below 0, so reverse is an owner turned
     back; and the role fold of three or more quats depends on cue order (documented, sound).
   - **A handle's own rate write on a child is retraced at its latest rate** when an owner above
     runs back over it (not tested): only a fit's rate change is kept for the run back
     (`Voice.earlier`, `unfit` in `src/spans.ts`), since a host's write is not made again going forward.
   - **This session's fixes cost `own N=1000` 3.4%** (0.148 to 0.153 ms, U 6 of 49; teitou, 7
     rounds, `bench/runs/2026-10-31-span-order.txt`, 008d580 against e3bfd3e); `tweens N=100000`
     +2.4% at U 13 is weaker, and churn and swap read 3% faster. Likely the per-voice checks
     `moveTo` now makes (a span's child that starts or ends this frame waits its turn, and
     `earlier`/`later` for `unfit`) and the loop body moved into `visitOne`; not profiled.
   - **Measured fine:** the feed (100 items/s, re-sorted and filtered) at 0.08 ms a read with no
     leaks; the cue stack against its model, except `from: 'current'` above; the deck's seeks and
     `done`s; the kiosk's loop phase, voice count and return to rest at short sizes.

2. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits: churn, stopping and
   replacing voices, and two design questions. Delete each item as it is dealt with, and the file
   once it is empty. At `FRAMES=5000` the bench's tween rows mostly time tweens that have landed,
   since each lasts 10 s, and `turnover^`'s `kB/frame` is mostly the row's own list copy.

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
     `distinct` count, the `subjects` store or the run tracking saved 6–10 µs. Unbuilt: skipping
     the `distinct` reads when no probe has run this frame and the list's slots never repeat
     (counted from the stamps afterward when they do), about 3% of `tweens^` by the model; and
     skipping `FILLED`/`IDLE`/`SEEN` while nothing that sets them has changed since the last pull,
     which needs a second record of when they last changed.
   - **A landed shortcut for a lane** (`runMotion`, so `weasel^`) is unbuilt: a lane's subjects share
     one clock, so it would save only the easing and two reads of each stretch (about 3% of
     `weasel^` by the profile), and it needs a number per position that a swap removal carries.
   - **A subject the host has let go entirely may be collected before the next fill** rather than
     held until it, since a probe holds its subject only while fills look subjects up (2026-10-24);
     only a later signal or `parting` lookup on that subject could notice.
   - **What `probed` still allocates is pose data**: `foldWith` copying each channel's rest value,
     and the `fn` voices' returned objects in `fill.ts`'s `call`.
   - Measured no different, so not worth re-proposing:
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

8. **blits-quarks and magicsmoke.** magicsmoke is on engine 0.8.1 but its fizz and tuning stay on
   its own code: the driver doesn't fit without changing what magicsmoke does. Its
   `docs/HANDOFF.md` has the gaps; the likely driver changes are a per-subject emitted count from
   `write`, rate or counts settable by the host, and rounding without the `1e-6` slack. Mike's call
   whether to make them. `@msb235/blits/testing` (`setting`, `checkPatch`) is the authoring kit; the
   driver scaffold the survey proposed is this same question.

9. **blits-tone.** Its README says what it does and does not do yet. Open:
   - `mix.trace` (2026-10-29) is exact only for `keys` voices eased `linear`. A stretch eased
     otherwise, any other patch, a signal weight and a fade under way are still read every
     `grid` ms; a tween's or an eased stop's shape could be sent as a curve
     (`setValueCurveAtTime`) rather than sampled. The schema page's Mix section lists what it
     needs to be exact.
   - Mix time converted to the outside clock while `mix.rate` ramps; the driver reads
     `mix.rate` as it stands at each write, which drifts during a ramp (3.59 Hz in its test).
   - **`apps/fireworks`**, which plays one mix through this driver and the quarks one, has never
     been listened to. It still packs pan and size into each event and could read them off the
     shell, since a booked hit carries its voice's `subjects` (2026-10-11).
   - **`node-web-audio-api` 2.2.0 frees a channel's samples under a live array** (2026-10-11):
     the `Float32Array` from `getChannelData` reads freed memory once its `AudioBuffer` is
     collected, so `render` in `packages/tone/test/render.ts` copies them. Upstream knows:
     ircam-ismm/node-web-audio-api issue 80. The copy can go once that is fixed.

10. **Two copies of blits loaded together** share what each knows of its patches and channels
   (`src/shared.ts`, `test/copies.test.ts`; the schema page's motion section). blits-quarks,
   blits-tone and blits-panel take blits as a peer dependency, so **the range has to be widened with
   each engine minor**. `@msb235/blits/lean` leaves lanes out of a bundle (the site's lean guide has
   the sizes). Since 2026-10-30 no lanes module lands in a lean bundle (58.7 kB gzipped for `mix`
   alone, by an esbuild metafile): the sharing hooks reach the general path through `mix.share`,
   which an engine with lanes sets and a projection's copy keeps, and `pull`'s lane runs through
   `Lanes.pulls`. History (9.3 kB gzipped) is reached
   from 24 places in 12 modules and was left in.

11. **The history adapter** (the schema page's "History behind a store") **has not been reviewed
    by Mike.**

12. **What the docs audit left** (2026-10-10).
    - **A voice cued before the mix's first sync starts at 0 on the host's clock, not at that
      sync** (measured 2026-10-11): a one-pass 1 s voice cued before `sync(5000)` has ended
      when it is first probed. Whether it should start at the first sync instead is Mike's call;
      a page that cues before its first `requestAnimationFrame` meets it.
    - **Not checked**: the page's timings and its table of consumers' kits, which are other
      repos' facts.
    - **Panel fields should also commit once typing rests; waits on a weasel release**
      (2026-10-30). Enter, blur and Escape already work: weasel's typed `PropertyControl`s
      hold a draft, `ControlPanel` rows do too since 1.11.0, and `c79df53` deleted the
      playground's `Draft` for it, (read from the 1.12.0 code, not run). weasel `875b5aacf` adds
      the idle commit, and `07671ccb6` turns it on by default (800 ms, the kit setting
      `typing.idleMs`). Once a release carries it:
      - Move every `@weasel-js/*` pin off 1.12.0 to that release, which also brings in
        1.13 and 1.14.
      - `ExprInput` still commits only on Enter or blur. Either have it call weasel's
        `useIdleSettle`, or delete it in favor of a string `PropertyField` with `error`,
        once that is checked to keep `aria-invalid`, the error under the field, and
        spellcheck off. `CodePane` stays, since weasel's textarea has no Tab indent or
        Cmd-Enter.

13. **The playground should offer everything in blits it feasibly can** (Mike, 2026-10-09). What
    is built is in its README; the calls made building it are under its "Chosen while building".
    What is left:
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
      with history, so a scrub back there replays rather than seeks. Not offered: `within` with a
      signal of the author's own, `put`, and moving dots, all of which want a way to say where a dot
      is beyond its grid place. Checked headless 2026-10-26: the glow follows the pointer playing
      and paused, and the stage canvas is capped at 400 px.
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
  - **The calls this work made** (`out` arrays reused, step 7's names, the `writes` warning,
    `seek({ frame })`, `catchUp: 'fresh'`, playing backward) are in the schema page's "Chosen
    while building". Mike has not seen the first two.
  - **Undecided behavior, as found** (the fuzzers' or the build's account of each):
    - **A projection's copy keeps no `owners` list**, so `lapse` never runs on one; no pose was
      found to depend on it, and a copy given the list read the same (2026-10-10).
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
      a role's `gatherInto`, a crowd's `KeyRows.fold`, and what `host.signal` returns. Under
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
    - **Tried and backed out for moving no row**: storing a channel's primitive rest without
      `copy` (`f1523e0`, 2026-10-20).
    - **Which `fn` voices run off lanes** (2026-10-21, `keepCallsOff` and `calls` in
      `src/qualify.ts`): a crowd of `fn` voices writing only arrays, and a lone `fn` voice
      writing vecs, where no other fitting voice writes its channels, since a lane's fill walks
      the subjects a second time. A crowd writing numbers stays on lanes (17% to 25% slower off,
      `bench/runs/2026-10-21-calls-off-sweep.txt`), and so does an `fn` crowd mixed with a tween
      or keys crowd on its channel (`bench/runs/2026-10-21-mixed-crowds.txt`). A lone voice on
      `color()` was not timed. `fns` reads in modes by build, so time a lanes change on such a
      row with a switch in one build, not with `ab.sh`; `bench/abdirty.sh` A/Bs an uncommitted
      diff with no commit on origin.
    - **Measured no different, or not built** (2026-10-21): answering a probe with nothing laned
      at the top of `Lanes.prepare`; taking `own`'s targeted voices off lanes as a crowd;
      leaving `GENERAL_PROBE` unstamped in `linked`, which read about 9% faster but could leave
      a voice coming back onto a lane reporting a stale `weightOf`.
    - **`glowc` and `glowkeys` read slower on lanes** (3.3 against 3.0 ms, 2026-10-21): nothing
      in them runs on lanes (their glow voice writes `color`, a `last` channel with its own lerp,
      which closes `gain` for the flicker) while the flicker still shares one record, which every
      read points at its subject and back.
    - **A voice over every subject shares one record for its first 60 frames only** (2026-10-21,
      `outgrow` in `src/everyone.ts`; not a keys voice). Every count timed beats never unsharing
      (`bench/runs/2026-10-21-share-frames-sweep.txt`); 60 itself is a guess, not measured.
    - **Storing a rest into the pose by name** (`pose.gain = rest`), the most a function made
      per kit from source text could do, was measured and not built (keiei, 2026-10-20; the
      ledger's "ceiling" entry).
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

## Loose ends

- **A staggered voice's end depends on which subjects the host has read, for a `target` voice**
  (2026-10-23; narrowed 2026-10-29). A voice cued with `subjects` asks `stagger` for each at cue
  and ends by all of them, through seeks too, so the determinism tests' `named` variant passes every
  property. A voice reaching its subjects by `target` still ends by the latest-staggered subject it
  has met, as `VoiceSpec.stagger` documents (decided 2026-10-29), so a read ahead or a replay with
  no reads can end it earlier than the live mix did, and `waiting` leaves those properties out.

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

- **A stale served-page tab overwrote `vocabulary.picks.json` four times**, most recently three
  times on 2026-10-07: the page kept its own picks in the browser and posted them whole on every
  click. semanticore `0c1df0c` posts only the roles a change touched. Until every browser that had
  the page open has reloaded on that build, `git diff` the picks file before trusting it.