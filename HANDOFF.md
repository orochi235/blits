# Handoff — blits, 2026-09-15

**For:** the next session on blits. **Answers:** what blits is meant to be, what exists, what was
decided in conversation and lives nowhere else, and what comes next. The design is in
`docs/2026-09-15-schema.html`; the naming work is in `docs/2026-09-15-vocabulary.html`. Do not
restate either from here; read them.

## What blits is

A small runtime package for concurrent effects: each effect runs on its own clock with its own
state and weight, and a mix folds them into one value per item per frame by rules that belong to
the channel, not the effect. It generalizes what klieg does three times over (motion, effects,
lighting) and what wod's transition tracks do once, so klieg, wod, sherpa and magicsmoke can share
one vocabulary and one engine. **Nothing is built.** The repo holds two design pages, an export of
one of them, and a script.

## State

- `main`, no remote, latest `99d913d`. Clean tree.
- `docs/2026-09-15-schema.html` — the design: vocabulary, channel table, pieces, tracks, mix,
  signals, time model, blending, piece state, the engine seam, per-consumer channel tables, the
  klieg port, decided-against, tests, open items. Status line says design under review. **It is
  written in the incumbent words** (table, offset, piece, track) and gets renamed once the
  vocabulary is called.
- `docs/2026-09-15-vocabulary.html` — the naming sheet: 19 nouns (one fixed), 8 verbs, 4
  operations, 20 candidates each, six consistent-set columns, relations, algebra, and page-wide
  substitution of the reader's picks. Its behavior is specified in `~/src/semanticore/README.md`
  and the lessons from building it in `~/src/semanticore/HANDOFF.md`.
- `docs/2026-09-15-vocabulary.json` — the sheet exported to the `Job` shape semanticore loads.
  `docs/export-vocabulary.py` regenerates it; run it after any edit to the sheet, and it exits
  non-zero if a role does not hold exactly 20 words.

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

1. **Mike calls the set.** Then rename through the schema page, regenerate the export, and copy
   both pages and the JSON into `~/src/semanticore/reference/`.
2. **Spec self-review** of the schema page (placeholders, contradictions, ambiguity, scope) and
   Mike's sign-off. This is the brainstorming skill's review gate; the design has been presented
   but not approved as a spec.
3. **Implementation plan** via the writing-plans skill: package scaffold (zero deps, ESM, vitest,
   biome as klieg), stock channels with property tests for the laws, piece and keys forms, tracks,
   the mixer engine, then the klieg extraction with baselines as the gate.
4. **A remote**, private under orochi235 like semanticore, when Mike asks.
5. **`~/src/PROJECTS.md`** entry for blits once it has code; add semanticore at the same time.

## Loose ends

- No remote; two design pages committed only here.
- The picks exist in one browser. If they matter, get the words from Mike and write them into the
  schema page and this file.
- The schema page and the vocabulary sheet disagree on nothing yet, only because the sheet
  substitutes and the schema does not. After the rename they must be read together once.
