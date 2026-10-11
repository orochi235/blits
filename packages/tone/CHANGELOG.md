# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `tone-v*` tag with no
section here.

## 0.1.0

### Added

- `drive(mix, options?)`, `attach`, `detach`, `write`, and `cancel`: each `write` reads the mix
  ahead on a grid and schedules a subject's channels as linear ramps on the Tone parameters bound
  to them, and `take` is handed each hit and mark before it comes, at its time on the audio clock.
  Pins `@msb235/blits` 0.9.0.
