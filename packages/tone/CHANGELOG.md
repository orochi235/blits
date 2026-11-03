# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `tone-v*` tag with no
section here.

## 0.10.0

### Breaking

- `@msb235/blits` is a peer at `^0.19.0`, where it was `^0.18.0`. Built and tested against engine
  0.19.0; `write` uses its `mix.time`, `mix.when` and `trace`'s `bends`.

### Added

- An eased `keys` stop and a tween's stretch are written as the curve the mix plays, at any
  `grid`, where they were read every `grid` ms: ramps that stand no further off the curve than
  1/10,000 of its size. On the tests' sweep the worst error at a 25 ms grid fell from 1.8 Hz to
  0.08, and the sweep alone stays within 0.04 Hz at any grid.

### Fixed

- Curves land where the mix will be while `mix.rate` ramps. The driver converted mix time with the
  rate as it stood at each `write`, which drifted 3.6 Hz on the tests' sweep for a ramp from 1 to
  0.5 over 600 ms; it now converts through the ramp, within 0.04 Hz.
- A `write`, `detach`, `cancel` or `drop` whose hold fell within a microsecond of a point the last
  `write` scheduled lost the line into that point, and could flatten the curve before it. The hold
  now lands on the point.

## 0.9.0

### Breaking

- `@msb235/blits` is a peer at `^0.18.0`, where it was `^0.17.0`. Built and tested against engine
  0.18.0; nothing here uses what that release changed.

## 0.8.0

### Breaking

- `@msb235/blits` is a peer at `^0.17.0`, where it was `^0.16.0`. Built and tested against engine
  0.17.0; nothing here uses what that release changed.

## 0.7.1

### Fixed

- A node wired by a cancelled driver can be wired by the driver that replaces it. `cancel` left
  it marked as wired, so `wire` threw that it was already wired.

## 0.7.0

### Breaking

- `@msb235/blits` is a peer at `^0.16.0`, where it was `^0.15.1`. Built and tested against engine
  0.16.0; nothing here uses what that release changed.

## 0.6.0

### Breaking

- `@msb235/blits` is a peer at `^0.15.1`, where it was `^0.15.0`: `write` reads the mix through
  the engine's `mix.trace`, which 0.15.1 adds. Where a `keys` voice's shape is known, its
  breakpoints are scheduled as they are, exact at any `grid`, and a jump as `setValueAtTime`;
  anywhere else the mix is still read every `grid` ms. On the tests' sweep the worst error at the default grid fell from 0.68 Hz to 0.12.
- `Target` needs `setValueAtTime`. Tone's `Param` and `Signal` and a native `AudioParam` have it.

## 0.5.0

### Breaking

- `@msb235/blits` is a peer at `^0.15.0`, where it was `^0.14.0`. Engine 0.15.0 has breaking
  changes of its own, listed in its changelog.

## 0.4.0

### Breaking

- `@msb235/blits` is a peer at `^0.14.0`, where it was `^0.12.0`. Engine 0.13.0 has breaking
  changes of its own, listed in its changelog.

## 0.3.0

### Added

- `tone.wire(node)` wires any Tone node to the mix as a `Sound`, the mix's subject for it. Each of
  the node's parameters with a channel of its name in the kit is driven, moved from the value it had
  when wired: added to for a channel resting at 0, scaled for one resting at 1.
- `tone.synth`, `polySynth`, `oscillator` and `noise` build that class from Tone's options and wire
  it.
- `sound.cue(spec)` cues a voice on that sound alone; `sound.copy()` wires a new node built from its
  settings; `sound.drop()` ends its voices, puts its parameters back and drops its subject.
- `channels`: `detune` and `volume` as `sum()`, `gain` as `mul()`.
- `kit` on `drive`'s options, which `wire` reads.

## 0.2.0

### Breaking

- `@msb235/blits` is a peer dependency, `^0.11.0`, where it was a dependency pinned to one
  version. The host installs the engine, so the driver and the host share one copy. Engine
  0.11.0 has breaking changes of its own, listed in its changelog: a voice now plays one pass
  unless given `loop`.

## 0.1.0

### Added

- `drive(mix, options?)`, `attach`, `detach`, `write`, and `cancel`: each `write` reads the mix
  ahead on a grid and schedules a subject's channels as linear ramps on the Tone parameters bound
  to them, and `take` is handed each hit and mark before it comes, at its time on the audio clock.
  Pins `@msb235/blits` 0.10.0.
