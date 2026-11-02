# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `rapier-v*` tag with no
section here.

## Unreleased

### Added

- `physics` takes `weight`, a number or a signal, for every body's simulated voice. A signal hands
  bodies between physics and authored poses with nothing written from the frame loop. Fading
  `simulated` out ended it for good, so a body could not be handed back.

## 0.1.0

### Added

- `physics`, which holds a Rapier world in a blits mix: bodies as subjects, `force` and `torque`
  voices on each body's controls, a simulated voice in a role that crossfades with authored
  motion, impulses and drops logged at mix time, and exact replay on a seek. 2D and 3D share the
  API through `channels2` and `channels3`.
