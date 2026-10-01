# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. Each release lists its changes as **Breaking**, **Added** and
**Fixed**, and the release workflow refuses a tag with no section here.

## Unreleased

### Fixed

- Keyed stops, and a `from: 'current'` retarget, interpolate through the channel's own `lerp`, as
  the schema says. They used plain numeric interpolation unless `lerpBy` named one, so a keyed
  `hex` color blended its packed integer instead of its components. `lerpBy` still wins, and a
  `keys` patch read outside a mix uses the `kit` it names.

## 0.1.1

### Fixed

- Published from the release workflow through npm's trusted publishing, with a provenance
  statement. The code is 0.1.0's; only the version and this changelog differ.

## 0.1.0

First release, published by hand. A mix folds concurrent effects into one value per subject per frame: each effect runs
on its own clock with its own state and weight, and the rules for combining them belong to the
channel being written rather than to the effect writing it.

What is here: the stock channels (`sum`, `mul`, `max`, `last`, `vec`, `hex`), both authoring forms
for a patch (a function of phase, or a list of keyframes), voices with rates, loops, stagger, fade
envelopes and loci, the five signals (`peak`, `slew`, `lag`, `level`, `gate`) with their state
kept per voice and subject, per-subject state that catches up by its own gap or, under `stepMs`, at a
fixed interval so it plays the same at any frame rate, events a patch sends for the host to `drain`,
`handle.weightOf` for reading a voice's weight per subject, the checks that let one package's
patches mix into another's (`Channel.kind`, `Patch.kit` and `Patch.reads` checked at `cue`, and
`tags` to drain one package's events), and the `Engine` seam behind `mix`.

[klieg](https://github.com/orochi235/klieg) composes its motion, its effects and its lighting on
this, which is where the arithmetic was proven: that port changed no number and moved no baseline.

Zero runtime dependencies. ESM only. The design is `docs/schema.html`, shipped alongside.
