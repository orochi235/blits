# Handoff — blits, 2026-09-15

**For:** the next session on blits. **Answers:** what blits is meant to be, what exists, what was
decided in conversation and lives nowhere else, and what comes next. The design is in
`docs/2026-09-15-schema.html`; the naming work is in `docs/2026-09-15-vocabulary.html`. Do not
restate either from here; read them.

## What blits is

A common language and paradigm for orchestrating effects from arbitrary sources, extensibly and
flexibly. The package follows from that: each effect runs on its own clock with its own state and
weight, and a mix folds them into one value per item per frame by rules that belong to the
channel, not the effect. The vocabulary is the deliverable as much as the runtime is — the sources
are open by design, so the language has to be able to name a seam it does not own. It generalizes
what klieg does three times over (motion, effects, lighting) and what wod's transition tracks do
once, so klieg, wod, sherpa and magicsmoke can share one vocabulary and one engine. **Nothing is
built.** The repo holds two design pages, an export of one of them, and a script.

## State

- `main`, no remote, latest `c011070`. Clean tree.
- `docs/2026-09-15-schema.html` — the design: vocabulary, channel table, pieces, tracks, mix,
  signals, time model, blending, piece state, the engine seam, per-consumer channel tables, the
  klieg port, decided-against, tests, open items. Status line says design under review. It reads
  in the called words as of `c011070`; klieg's own `offset` channel, the arithmetic `add`, a
  `keys` patch's `stops` and the patch callback `step` are deliberately unrenamed.
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
- **The vocabulary is not settled.** Mike's picks live in his browser only. Last seen: frame,
  dimension, image, target, curve, voice, identity, coefficient for the nouns; play, probe, jump,
  wipe, shed, combine, attenuate for verbs and operations. My recommendation, which the sheet loads
  as defaults: domain (or space), axis, term, curve; track, mix, signal, handle, engine kept. He
  has leaned toward `voice` for track and `feature` or `axis` for channel, and away from `domain`
  after deciding the range reading was as valid.
- **Blending** covers all four behaviors he was offered: fade, retarget on interruption, blend
  between alternatives, handover at rest. All reduce to a weight per track or a channel lerp.
- **Two clocks, one of them addressable.** Mix time is a reading the host reports, not a position
  anything sets. Voice time is a position, because `phase` is computed from the reading rather than
  accumulated into. So `seek` has exactly one scope, the voice, and needs no qualifier.
  Decided 2026-09-27.
- **The mix keeps no history**, so it cannot be moved to an earlier reading: stateful piece state
  and slew-driven weights have no inverse, and voices that finished their fade are gone with no
  record that they existed. A purely stateless mix would evaluate at any reading; the obstruction
  is accumulation and membership, not time. Going back would mean re-adding voices and replaying
  forward from a point still held. That is a capability the design lacks, not one the ontology
  forbids — the schema constrains only the source (`monotonic clock`) and says nothing about
  scrubbing. Noted 2026-09-27.
- **`mix.step(now)` becomes `sync`**, and `step` stays on the piece callback, where it takes a `dt`
  and means an advance. The mix method takes an absolute reading and publishes it; nothing advances
  at the call, and each item catches up when it is next sampled. Both were called `step`, meaning
  opposite things. Carry this into the schema rename. Decided 2026-09-27.
- **Name from the point of view of the thing that experiences it**, not the machinery that
  produces it. A pattern does not meet a fresh object each frame; it looks again and the world has
  moved on, so an argument from allocation is not an argument about the concept. The same cut
  settled the mix's clock verb: `step` named the consequence, `sync` names the act. Stated
  2026-09-27.
- **Two halves of "offset"** were split: what a piece returns (partial, relative) and what the mix
  returns (resolved). The sheet names them separately; klieg's `ResolvedOffset` is the second.

## Open, from the design and the naming

- A **sequence** role, an ordered chain of tracks that hand over, enter to active to exit. The
  design covers it with `group` plus fades; klieg's `Sequence` and `Timeline` would port more
  directly onto a first-class object. `movement` is the musical word for one.
- **Color's lerp space**: sRGB or OKLCH, on the stock hex channel.
- **Where stagger lives**: in the package or passed in by klieg.
- **Whether magicsmoke wants blits at all**; its case is weakest.
- The schema page's own **Open** section has the rest.

## Next, in order

1. **Spec self-review** of the schema page — placeholders, contradictions, ambiguity, scope — and
   Mike's sign-off. This is the brainstorming skill's review gate; the design has been presented
   but never approved as a spec. It is the gate on everything below.
2. **Two rows are still open** on the sheet: `group` and `sequence`. The page recommends `seat`
   and `arc`; neither is the incumbent, so neither can be taken by default.
3. **Implementation plan** via the writing-plans skill: package scaffold (zero deps, ESM, vitest,
   biome as klieg), stock channels with property tests for the laws, patch and keys forms, voices,
   the mixer engine, then the klieg extraction with the 40 Playwright baselines as the gate.
4. **A remote**, private under orochi235 like semanticore, when Mike asks.
5. **`~/src/PROJECTS.md`** entry for blits once it has code; add semanticore at the same time.

## Loose ends

- No remote; two design pages committed only here.
- The schema page and the sheet now use the same words. They have not been read side by side
  once since the rename.
- `handle.fade` takes `over` for its ramp, renamed from `fade` so the verb and its argument are
  not the same word. Nothing else was consulted about that.
