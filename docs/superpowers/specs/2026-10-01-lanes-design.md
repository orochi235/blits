# Lanes in `mixer`

**Status: designed 2026-10-01, nothing built.** Delete this file once lanes land and the schema
page describes them; until then it is the plan, not the state of the code.

**For:** whoever builds lanes. **Answers:** what a lane is, which voices and channels run on one,
how the two paths stay identical, and how we know it worked. The measurements behind the decision
are in `spikes/gpu-engine/README.md`; the reason it matters is weasel's animator, which waits on
this (weasel's `docs/proposals/2026-09-30-animator-on-blits.md`).

## What a lane is

A **lane** is a channel the mix computes for every subject at once, in `Float64Array`s indexed by
a number the mix gives each subject, instead of subject by subject through the per-subject records
in `src/mixer.ts`. A channel runs as a lane only while every voice writing it qualifies; any other
channel takes the general path, which is today's code unchanged. There is one engine, `mixer`. A
consumer never chooses a lane, and `lane` is an informal term in the schema's vocabulary. The
public API changes in two places, below: a `'motion'` patch form and `MixOptions.lanes`.

## Scope

A **voice qualifies** when all of these hold:

| Part | Qualifies | Falls back |
|---|---|---|
| Patch | `keys`; `fn` with no `state` and no `step`; `spring` and `glide` | `fn` with `state` or `step`; `keys` whose `lerpBy` is not the channel's own `lerp`; under `history.inputs`, `fn` with `reads` |
| Weight | A number, with fades and `mute` | A `Signal` |
| Reach | Every subject, `target`, `subjects` | — |
| Timing | `stagger`, `loop`, `rate`, `ramp`, `seek`, anchors | — |
| Other | — | `locus`, `from: 'current'`, `fade({ at: 'rest' })` |

A **channel qualifies** when it is a channel object `sum`, `mul`, `max` or `vec` made (with or
without `bounds`; a custom channel claiming one of their kinds does not count) and every voice writing it qualifies. A voice whose channels are not all
laned runs entirely on the general path, so no patch is ever called twice in a frame; lanes are
therefore found as a fixed point over voices and channels, recomputed when a voice is cued,
retires, or starts a `fade({ at: 'rest' })`, the only handle change that affects qualifying. Never
per probe. A cue, retirement or handle change between two probes of one frame refills the lanes
at the next probe, which can call a stateless `fn`'s `at` twice for a subject that frame.

A mix with `history` keeps lanes, but a `project` reads through the general path.

## Subject numbers

The mix numbers a subject the first time it sees one, and keeps the number on the per-subject
record a probe already looks up, so numbering adds no lookup. A free list hands out numbers;
`drop(subject)` returns one, and for object subjects a `FinalizationRegistry` returns it when the
host lets the object go. A dead number holds stale values until reused; nothing reads it, since
nothing can probe a subject that no longer exists.

A subject's first probe takes the general path, which is where first sight already happens:
`target`, `stagger`, the fade-in origin `since`, the voice's `seen` and `latest`. The lane copies
`delay` and `since` into per-voice arrays at that point. A voice that starts playing after a
subject was numbered meets it the same way, at the subject's next probe, which takes the general
path for that frame; so every voice sees every subject at the same times on both paths.

## Filling a lane

The first `probe` after a `sync` fills every lane, once:

1. Per voice: the voice's elapsed time from its clock, its fade-out factor, whether it is done.
2. Per voice and numbered subject it reaches: elapsed minus that subject's `delay`, the phase, the
   fade-in from `since`, the weight; then the patch's value.
3. Fold into the channel's arrays in voice order, the order the general path folds in. A voice's
   patch is called whenever the general path would call it, weight 0 included, and folded only
   above 0. `bounds` are clamped by the general path's own `clamp` after laned values are copied
   into the pose.

Per patch form:

- **`keys`**: stops packed per voice once, at cue; the same `Curve` closures the general path
  resolves.
- **Stateless `fn`**: called per subject with a filled `Setting`, its return folded. The `Setting`
  is the voice's reused one, as today.
- **`spring` and `glide`**: become a third public patch form, `'motion'`, carrying their
  parameters as data the way a `keys` patch carries its stops: `patch.motion` holds the kind
  (`'spring'` or `'glide'`) and its parameters. `Engine.runs` lists `'motion'` like the other
  forms, so an engine that can't run it refuses at `cue`. A spring is no longer `form: 'fn'`;
  nothing in blits' consumers checks that. Its state belongs to the patch, since `to`, `push` and
  `read` address the patch, not a mix: the patch numbers its own subjects and keeps the current
  segment in its arrays, and each lane position caches the patch's number for its subject. A
  motion patch moves every subject on one axis count; mixed lengths throw. Each subject's current segment (release time, start position, start velocity, target, per
  axis) lives in the lane's arrays; older segments, kept only while the mix keeps history, live in
  per-subject lists. `to`, `push` and `read` work on whichever holds the state, and the general
  path reads the same state, so there is one copy.

A stateless `fn` that calls `setting.send` from `at` now sends each frame for every subject it has
met, not only for the ones probed that frame. Nothing in blits or its consumers does this today. A
patch that keeps per-subject state through `setting.keep` is stateful: once a call leaves kept state
on a record, its voice leaves its lane for the general path.

Later probes that frame copy each laned channel's values into the pose, and fold the rest through
the general path. `probe(subject, out)` keeps its signature.

What the per-subject records report must stay true for laned voices: `weightOf` reads the lane's
weight array; `assess`, `atRest`, a finite loop's end and the voice's retirement read what they
read today, kept current by the fill.

## Staying identical

A channel moving between a lane and the general path must not move the pose, so both paths use
the same arithmetic, literally the same functions: phase as `(elapsed % period) / period`, the
envelope, the clamp of weight to [0, 1], skipping a voice at weight 0, the channel's `fold` or
`merge`/`scale`, one closed-form spring solver. `Float64Array` throughout; the spike's dense
variants matched `mixer` exactly this way.

## Tests

- **Lanes off against lanes on.** `MixOptions.lanes: false` turns lanes off, for these tests and
  for a host that wants to rule a lane out. Every qualifying scenario runs both ways and must match with
  `Object.is` on every channel of every probe: each patch form, `stagger`, `target`, `subjects`,
  loops finite and infinite, `rate`/`ramp`/`seek`, fades in and out, `bounds`, a spring retargeted
  and pushed mid-flight.
- **Moving between paths.** A channel that gains a stateful voice mid-animation and loses it again
  gives the same poses as the lanes-off run, frame for frame.
- **Numbers.** `drop` frees and reuses a number; a reused number never shows the old subject's
  values.
- The existing suite passes unchanged.

## Measurement

`bench/frame.mjs` gains rows for a spring voice per subject and one spring voice over every
subject, and a row probing 5% of numbered subjects, which is where filling every subject costs
more than today. Then weasel's `animator-on-blits` and `pose-overrides` benches, run by a weasel
session against the build. A result is read from fleet runs alternated against `project`, never
from one local run.
