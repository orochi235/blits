# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `tone-v*` tag with no
section here.

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
