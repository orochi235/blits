# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `tone-v*` tag with no
section here.

## Unreleased

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
