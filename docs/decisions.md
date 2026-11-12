# Decisions

The owner's calls on blits that no other document records. Read it before re-proposing anything
below. Calls made on the design itself are in `docs/schema.html`; the playground's and the
DevTools extension's are in their READMEs.

## Scope and home

- **Approach**: a mixer of tracks, chosen over a signal graph and over keyframes only (2026-09-15).
- **Engine seam**: an `Engine` interface with a `runs` set and `create`. One engine ships (`mixer`);
  others are sketched only to prove the seam, which the owner asked for explicitly.
- **First consumer**: all three klieg systems at once, ported as a pure extraction with the same
  arithmetic. A klieg baseline that moves is a defect in the port, not one to re-bless.
- **Home**: its own repo, not klieg's monorepo or weasel. Where a blits name collides with a klieg
  name, klieg renames if blits earns it; blits took `kit`, so klieg keeps `domain` (2026-10-05).
- **The gpu engine** (2026-11-02) is a parallel evaluator beside the stock mixer, not GPU lanes.
  A shader patch carries WGSL and a JS `at` side by side; the host draws from GPU buffers and `pull`
  reads back; it ships as the subpath `@msb235/blits/gpu` so it can use lane internals.
- **A musical layer is a companion on the mix's clock, not Tone's `Transport`** (2026-11-04), so
  seek, history and the panel reach it. Unbuilt: the package is to be cut from the Score
  explainer's singalong (`site/src/explainers/score/sing.ts`).

## Names

- **The vocabulary is called** (2026-09-29); `docs/vocabulary.picks.json` holds it. `contribution`
  replaced `influence` (2026-10-07); `arc` replaced `series` and `plane` was added (2026-10-22);
  `role` replaced `locus` (2026-10-26).
- **Name from the point of view of the thing that experiences it**, not the machinery that makes
  it (2026-09-27). That is why the mix's clock verb is `sync`, not `step`.
- **`duration`, not `period`** (2026-10-04): only a looping voice has a period.
- **`phase`** is the normalized position within a pass, formerly `t`.
- **`plot(subjects, xy, { axes, cell })`** learns the axis count from `axes`, 2 by default; `xy`
  keeps its name (left to the agent, 2026-11-12).
- **`seek`** names both the mix's and a voice's, as in a media player (2026-10-07).

## Behavior

- **The two seek-back changes in `3fd3eac` stand** (2026-10-18): `weightOf` reads 0 after a seek
  back until the subject is probed again, and a write to the handle of a voice waiting for its cue
  after a seek back is ignored.
- **A seek moves a voice's position, never its speed or direction** (left to the agent,
  2026-11-11): a span's refit leaves a playing child its handle turned back alone until its
  handle turns it forward, so a nested span sought forward while turned back stays turned back.
- **A subject's first `dt` counts from its `since`**, where its delay runs out or its voice starts,
  not from when it was first probed (left to the agent, 2026-11-12): a stateful patch already steps
  from `since`, and a weight signal reading `dt` then sees the same start on both engines.
- **A voice keeps each subject's `stagger` answer for as long as history reaches** (left to the
  agent, 2026-11-12), so a replay or a read ahead never asks again for a subject the live mix
  asked, a dropped one included. Not until the voice ends: a long voice would keep an entry for
  every subject ever dropped.
- **Spans** (2026-10-07): fit strategies over a constraint solver or a host helper; `overrun` is
  opt-in and never the default; joins are `all`/`any`; the children's hints are plain fields on the
  spec, not under `give`.
- **`within` on a constant weight stays refused**, naming the recipe
  `weight: mix.around(circle, { steps: 1, jump: 'start' })` (2026-10-26). Unbounded voices are not
  to be deprecated: klieg's lighting and wod's transitions are unbounded by design.
- **`numeric@1` kept its version when lanes took `color({ lerp: 'oklch' })`** (2026-10-25): an older
  copy folds that channel as `'own'`, which is correct.

## Releases

- **Semver from 0.1.1** (2026-09-30). Below 1.0.0 a break bumps the minor. 1.0.0 only on the
  owner's say-so. Every release gets a `CHANGELOG.md` section, and releases go out from tags.
- **blits-panel releases in lockstep with the engine, at its version**, from 1.1.0 on (2026-11-05).

## Site

- **Priorities**: the vocabulary first, consumers' docs second, the npm pitch third. Astro, since
  it is mostly documents.
- **An explainer's transport defaults to boomerang** (2026-10-28).
- **An explainer settles to rest on blur over the frame it stopped on** (2026-11-08): its own mix
  (`site/src/explainers/kit/settle.ts`) fades the held poses to rest over 400 ms while explainer time
  holds, so the run its player replays never holds a fade.
