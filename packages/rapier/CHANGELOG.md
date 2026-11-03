# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `rapier-v*` tag with no
section here.

## Unreleased

### Breaking

- `PhysicsOptions` no longer takes `keyOf`: every subject in the mix is the driver's, and it keys
  them itself.

### Added

- Kinematic bodies moved by a voice: `kinematic2` and `kinematic3` add `goal` and `facing` channels
  to a body's controls, which move a kinematic body over the next step. Neither has a rest, so a
  body no voice writes stays where it is.
- History pages to a `store`. The world's state packs to plain data, its Rapier snapshot as base64.
  With a store, the log of each frame's pushes is kept for as long as the mix plays.

## 0.3.0

### Breaking

- `@msb235/blits` is a peer at `^0.18.0`, where it was `^0.17.0`. Built and tested against engine
  0.18.0; nothing here uses what that release changed.

## 0.2.0

### Breaking

- `@msb235/blits` is a peer at `^0.17.0`, where it was `^0.16.1`. Built and tested against engine
  0.17.0; nothing here uses what that release changed.

### Added

- `physics` takes `weight`, a number or a signal, for every body's simulated voice. A signal hands
  bodies between physics and authored poses with nothing written from the frame loop. Fading
  `simulated` out ended it for good, so a body could not be handed back.

### Fixed

- A body handed back to physics starts where it was shown, at the speed it was shown moving. The
  world went on simulating it while an authored voice held it, so it jumped back to wherever the
  simulation had taken it, such as against a wall that a push had sent it to.

## 0.1.0

### Added

- `physics`, which holds a Rapier world in a blits mix: bodies as subjects, `force` and `torque`
  voices on each body's controls, a simulated voice in a role that crossfades with authored
  motion, impulses and drops logged at mix time, and exact replay on a seek. 2D and 3D share the
  API through `channels2` and `channels3`.
