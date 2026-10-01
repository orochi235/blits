# Handoff — blits, 2026-09-30

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
systems now run on it**, on a branch that is not merged.

## State

- `main` at `git@github.com:orochi235/blits.git` — **private**, and 43 commits ahead of it on 2026-09-30, unpushed. The remote had been
  configured and pushed once on 2026-09-16 and then went unmentioned; two handoffs since have said
  there was none. Check `git remote -v` before believing any of this.
- **klieg's port is done and green, on `blits-port` in `~/src/klieg`** — four commits, the last following the 2026-09-29 rename; not merged,
  no remote push. All three systems fold through a mix: `Timeline.poseAt` cues a voice per layer of
  each phase, `EffectFrame` one per effect, and the sign's environment is a mix with one subject.
  The arithmetic did not move: klieg's 1970 vitest cases pass, and its Playwright specs fail exactly
  the five they already failed on `main`, to the pixel (recorded in klieg's changelog). The schema
  page's klieg section says what the port found; do not re-derive it from here.
- **klieg depends on this checkout by path** — `"blits": "file:../../../blits"` in
  `packages/core/package.json` — so the branch resolves on this machine and nowhere else. That is
  the one thing standing between the branch and a merge.
- **The package, v0.1.1.** `src/` is the whole of it: `channels.ts` (the stock channels, `kit`,
  `hex`/`mixHex`), `easing.ts` (easing as data resolved to a curve), `patch.ts` (`patch`, `keys`,
  and the stops built once per channel that `from: 'current'` reuses),
  `signals.ts` (`peak`, `slew`, `lag`, `level`, `gate`), `store.ts` (per-subject storage, WeakMap for
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
- **The mix keeps no history**, so it cannot be moved to an earlier reading: stateful patch state
  and slew-driven weights have no inverse, and voices that finished their fade are gone with no
  record that they existed. A purely stateless mix would evaluate at any reading; the obstruction
  is accumulation and membership, not time. Going back would mean re-adding voices and replaying
  forward from a point still held. That is a capability the design lacks, not one the ontology
  forbids — the schema constrains only the source (`monotonic clock`) and says nothing about
  scrubbing. Noted 2026-09-27.
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
  deleted; branch `blits-engine` in magicsmoke, unmerged, `file:` dependency): `lag`,
  `handle.weightOf`, `MixOptions.stepMs` and `setting.send` / `mix.drain`. Each is in the schema
  page; magicsmoke's row in the consumer table says how it uses them.

## Next, in order

0. **`NOTES-FROM-WEASEL.md`** holds what is left of weasel's read of blits: the allocation still
   in the hot path, velocity on retarget, and what weasel has that blits doesn't (booking events
   ahead, a mix-wide time scale, nesting, a mix that can list what is playing). The site's ledger
   can now show a voice's weight after fades through `handle.weightOf`; nothing draws it yet.
   Delete each item as it is dealt with, and the file once it is empty.
   `NOTES-FROM-ASTV.md` is astv's: the operations and cases a reading-back API has to serve, for
   whoever builds the score. Same rule.

1. **Point klieg and magicsmoke at the published `@msb235/blits@0.1.1`.** It is on npm, from the
   release workflow with provenance. klieg's `packages/core/package.json` trades
   `"@msb235/blits": "file:../../../blits"` for an exact `"0.1.1"`, which makes `blits-port`
   mergeable and lets klieg's suite run on the fleet again; magicsmoke's `blits-engine` does the same.
2. **Step two of the port**, which is what the extraction bought: `power`, `kicks` and `dwell` lose
   their hand-rolled frame keying onto `slew`, `hinge`'s modes become `weight: signal` and
   `mix.blend`, and `FrameCtx` becomes `Setting` with klieg's fields on `host`. The schema page's
   klieg section has the list. Nothing here is started.
3. **The renames the vocabulary bought, which the port deliberately left alone.** `t` is still `t`
   on `MotionPiece.offset` and `EffectPiece.at`, `onPhase` and `PhaseEvent` still carry those
   names, and the tube gradient still calls its own thing `domain`. Each is a break in klieg's
   published surface — sherpa reads `ctx.phase` — and step one had to leave every baseline where it
   was, so they wait for a version of klieg that intends to break.
4. **The remaining opens** are in the schema page: how the score comes inside (decided it does; unbuilt),
   color's lerp space and the stock band's width.

## Loose ends

- **A semanticore `serve` has held port 4872 since 2026-09-20** (pid 17237, cwd this repo), on
  `docs/2026-09-15-vocabulary.json`, a file since renamed. It is the kind of stale tab the next
  item warns about; the site moved to 4880 rather than touch it.
- **klieg's `blits-port` branch is local, unmerged and unpushed**, and its `file:` dependency means
  no other machine can build it.
- **A stale served-page tab will overwrite `vocabulary.picks.json` with whatever set it
  was holding.** It has happened twice — `65d2d71` restored one, and the same loss was in the
  working tree at the start of 2026-09-27's session. Before trusting the picks file, `git diff` it;
  before reloading the served page, make sure no old tab is open on it.
