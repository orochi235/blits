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

- **A `pull`'s fill may commit a motion subject's due changes when the mix has no `history`**
  (2026-11-21), reopening `6510b1b8`'s rule that a fill changes no motion state for that case
  alone: only for a subject the pull is certain to read, and only changes already timed. Results
  stay the same to the bit, lanes on or off, with seeks and replays (`bench/same.sh`).
- **The two seek-back changes in `3fd3eac` stand** (2026-10-18): `weightOf` reads 0 after a seek
  back until the subject is probed again, and a write to the handle of a voice waiting for its cue
  after a seek back is ignored.
- **A seek moves a voice's position, never its speed or direction** (left to the agent,
  2026-11-11): a span's refit leaves a playing child its handle turned back alone until its
  handle turns it forward, so a nested span sought forward while turned back stays turned back.
- **A subject's first `dt` counts from its `since`**, where its delay runs out or its voice starts,
  not from when it was first probed (left to the agent, 2026-11-12): a stateful patch already steps
  from `since`, and a weight signal reading `dt` then sees the same start on both engines.
- **A voice keeps its `stagger` answers for as long as history reaches** (left to the agent,
  2026-11-12), in the order it gave them, so a replay or a read ahead hands back what the live mix
  asked rather than asking again. A subject dropped and met again live is asked again, as the docs
  promise, and its replay gets that second answer. Not until the voice ends: a long voice would
  keep an entry for every subject ever dropped.
- **Every valid spring constant has a closed form** (2026-11-25). Only a non-positive mass, a
  negative constant or a non-finite one is refused. Stiffness 0 coasts as a glide of
  `ms = 1000 · mass / damping`, its target ignored; stiffness and damping both 0 drift at the
  velocity given, and a drift within `settle` counts as stopped for its whole stretch, so it never
  creeps and then snaps (left to the agent).
- **A motion takes its arithmetic from the channel it writes, never from per-call ops**
  (2026-11-25). A closed form is `target + d₀·c₁(t) + v₀·c₂(t)`, so it needs only add and scale in
  the channel's space: numbers, `vec` and oklab `color` as they are; `ink`'s hue in LCh; `quat` on
  the rotation vector from a base; `affine` on its parts, as its `lerp` goes. A value blits cannot
  write as numbers is encoded at the consumer's boundary (weasel's `axesOf`), since the tape, lanes
  and GPU all need numbers. Left to the agent, same day:
  - An `angle` motion (and a `vec` of angles) keeps its value continuous and lands a whole number of
    turns from a target given the long way, rather than jumping at release to keep the target's
    number. The target is rewritten when a stretch is released, so the stretch stays a line and runs
    on crowds, lanes and the GPU as before. A glide's rest is no target, so a fling turns as far as
    it carries.
  - A `quat` motion's velocity is the quaternion's rate of change, as every other motion's is its
    value's, not an angular velocity. A spring or tween's base is its target on the sphere's side
    nearest where the stretch starts, so its value never flips sign; a glide's base is where it
    starts, so a fling may turn past a half turn.
  - Motions on `quat`, `affine` and `ink` stay off crowds and the GPU, as `ink`'s already did, and a
    glide on them refuses bounds.
- **Spans** (2026-10-07): fit strategies over a constraint solver or a host helper; `overrun` is
  opt-in and never the default; joins are `all`/`any`; the children's hints are plain fields on the
  spec, not under `give`.
- **`within` on a constant weight stays refused**, naming the recipe
  `weight: mix.around(circle, { ease: { steps: 1, jump: 'start' } })` (2026-10-26). Unbounded voices are not
  to be deprecated: klieg's lighting and wod's transitions are unbounded by design.
- **`numeric@1` kept its version when lanes took `color({ lerp: 'oklch' })`** (2026-10-25): an older
  copy folds that channel as `'own'`, which is correct.
- **The finder commit `4350a86` keeps its 10–13% cost on the glow rows** (accepted 2026-10-29;
  re-measured 2026-11-21). Profiles, GC traces, pretenuring flags and record layout were all ruled
  out (`bench/README.md`, "Tried and backed out"); no lead is left.

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
- **The time explainer's twin stays a mix of its own** (2026-11-21), not on a shared `transport()`
  with the main mix: it shows a mix that does not call `rebase()` beside one that does, and a
  shared transport would rebase both.
