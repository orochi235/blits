# Handoff — blits, 2026-09-15

**For:** the next session on blits. **Answers:** what blits is meant to be, what exists, what was
decided in conversation and lives nowhere else, and what comes next. The design is in
`docs/2026-09-15-schema.html`; the naming work is in `docs/2026-09-15-vocabulary.html`. Do not
restate either from here; read them.

## What blits is

A common language and paradigm for orchestrating effects from arbitrary sources, extensibly and
flexibly. The package follows from that: each effect runs on its own clock with its own state and
weight, and a mix folds them into one value per subject per frame by rules that belong to the
channel, not the effect. The vocabulary is the deliverable as much as the runtime is — the sources
are open by design, so the language has to be able to name a seam it does not own. It generalizes
what klieg does three times over (motion, effects, lighting) and what wod's transition voices do
once, so klieg, wod, sherpa and magicsmoke can share one vocabulary and one engine. **The package
is built and tested; nothing consumes it yet.**

## State

- `main`, no remote. Clean tree.
- **The package, v0.1.0.** `src/` is the whole of it: `channels.ts` (the stock channels, `rig`,
  `hex`/`mixHex`), `patch.ts` (`patch`, `keys`, and the stop evaluator `from: 'current'` reuses),
  `signals.ts` (`peak`, `slew`, `level`, `gate`), `store.ts` (per-subject storage, WeakMap for
  objects and a Map for anything else), `mixer.ts` (the engine and `mix`), `types.ts` (the whole
  public surface, doc-commented). Zero runtime deps, ESM, vitest, biome as klieg. `npm run check`
  is lint, typecheck of both `src` and `test`, then the suite: 55 tests, green, and they are the
  design page's own test list minus the klieg extraction.
- `docs/2026-09-15-schema.html` — the design: vocabulary, channel table, patches, voices, mix,
  signals, time model, blending, patch state, the engine seam, per-consumer rigs, the klieg port,
  decided-against, tests, open items. Status line says design under review. It reads in the called
  words; klieg's own `offset` channel, the arithmetic `add`, a `keys` patch's `stops` and the patch
  callback `step` are deliberately unrenamed.
- **The spec self-review has been done and its findings fixed** (2026-09-27). What the review
  changed, so nobody re-derives it: `sync`, `step` and `Setting.dt` now say that nothing advances
  at the call and each subject catches up by its own whole gap; `mix.clear` takes `over` like
  `handle.fade`; `duration` is `period` and `t` is `phase`, 0..1 across the period; `pose`,
  `influence`, `setting`, `period`, `phase`, `system`, `source` and `score` are defined in the
  Vocabulary section; `Easing`, `Keyframe<O>`, `StaggerSpec` and `mixHex` are given; and the
  answers a builder would otherwise have guessed are stated where they belong — `target` runs per
  subject on first sight, `seek` moves the clock and never runs state forward, `setting.weight` is
  post-cap, `from: 'current'` reads the frame before the voice contributes, a stateful signal's
  state belongs to the instance, `live` goes true on `cue` and the mix never calls back, and a
  consumer may declare its own channel, which is what sherpa's `transform` is.
- `docs/2026-09-15-vocabulary.json` — **the naming sheet, and the source of it.** 19 nouns (one
  fixed), 8 verbs, 4 operations, 20 candidates each, six consistent-set columns, relations,
  algebra. Edit this file; semanticore builds the page from it, so nothing is hand-edited in HTML
  any more:

  ```
  cd ~/src/semanticore && node bin/semanticore.js check <job>   # 20-word rule, placeholders
  node bin/semanticore.js serve ~/src/blits/docs/2026-09-15-vocabulary.json --port 4871
  ```

  Pinned to semanticore `7dac96e`. The built page is not committed here; `serve` rebuilds on every
  edit and adds undo/redo, snapshots, cross-off and chat, none of which the hand page had.
- `docs/2026-09-15-vocabulary.html` — the hand-built sheet from 2026-09-15, now frozen and no
  longer the source. Kept only until two things are true: the served page is confirmed at visual
  parity with it, and Mike's picks have been read out of the browser tab that holds them. Then it
  goes; git history and `~/src/semanticore/reference/` both keep a copy.

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
- **The vocabulary is called**, and `docs/2026-09-15-vocabulary.picks.json` is where it lives:
  delta, channel, rig, subject, patch, voice, mix, signal, handle, engine, pose, influence,
  setting, period, phase, rest, weight, group, chain, host, source, score, system; cue, fade,
  seek, sync, sample, blend, clear, drop; join, scale, lerp, fold. The schema page reads in them.
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
- **A group folds by `lerp`, not by scaling and joining.** The review found the old cap's
  invariant — two voices in a group at weight 1 look like one at weight 1 — false on every channel
  but `sum`: two at 0.5 on `mul` give `(1 + (v − 1) / 2)²`, so a shared gain of 0.06 read 0.28.
  A group is alternatives, so the mix folds its members through the channel's own `lerp` by their
  share of the summed weight, and that one influence contributes at `min(1, Σw)`. On `sum` it is
  identically `w₁a + w₂b`, so klieg's baselines hold and the port stays an extraction. Mike had no
  view and asked me to take it; decided 2026-09-27, and the alternative (per-channel
  normalization) is in the page's Decided against.
- **Two halves of "offset"** were split: the delta a patch returns (partial, relative) and the pose
  the mix returns (resolved). klieg's `ResolvedOffset` is the second.

## Open, from the design and the naming

- A **chain** (the called word for a sequence), an ordered set of voices that hand over, enter to
  active to exit, with one handle that resolves when the last has left. The design covers the
  behavior with `group` plus fades; the object is not in the API.
- **Color's lerp space**: sRGB or OKLCH, on the stock hex channel.
- **Where stagger lives**: in the package or passed in by klieg.
- **Whether magicsmoke wants blits at all**; its case is weakest.
- The schema page's own **Open** section has the rest.

## Next, in order

1. **The klieg port.** All three systems at once, extraction first: `Timeline.poseAt` becomes three
   voices in one group, `EffectFrame.resolve` becomes a mix over parts, `mergeOffsets` and
   `addScaled` become the rigs. The 40 Playwright baselines and klieg's vitest cases are the gate —
   any that moves is a defect in the port. The schema page's klieg section has the rest, including
   what step two turns on afterward.
2. **A remote**, private under orochi235 like semanticore, when Mike asks. blits is committed only
   here.
3. **`stagger`** is the one place the package knowingly departs from klieg's grammar: it takes a
   per-subject delay function, and whether `StaggerSpec` and `orderKey` move in is for the port.

## Loose ends

- No remote; the package and both design pages are committed only here.
- **A stale served-page tab will overwrite `2026-09-15-vocabulary.picks.json` with whatever set it
  was holding.** It has happened twice — `65d2d71` restored one, and the same loss was in the
  working tree at the start of 2026-09-27's session. Before trusting the picks file, `git diff` it;
  before reloading the served page, make sure no old tab is open on it.
