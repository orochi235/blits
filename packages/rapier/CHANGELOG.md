# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `rapier-v*` tag with no
section here.

## 0.6.0

### Breaking

- `@msb235/blits` is a peer at `^1.0.0`, where it was `^0.20.0`. Built and tested against engine
  1.0.0; nothing here uses what that release changed.

## 0.5.0

### Breaking

- `@msb235/blits` is a peer at `^0.20.0`, where it was `^0.19.0`. Built and tested against engine
  0.20.0; a physics mix on a transport reads its `Transport.history`.

### Added

- A physics mix plays on a shared `transport`: the host syncs the transport and calls the new
  `sim.step()`, and the world seeks with the transport's other mixes. `physicsStore(store)` wraps
  the transport's history store so the world's log of pushes pages through it. `sim.sync` on a
  transport throws, as does `physics` on a transport whose store is not wrapped.
- The mix is named `'physics'` when `physics` is given no `name`, so the debug panel lists it.

### Fixed

- A seek forward after playing on from a seek back replays the world with the pushes logged the
  first time. Playing on dropped every frame logged ahead, so the world replayed that stretch with
  one frame's push.
- An `impulse`, `drop` or `body` call made after a seek lets go of the calls logged ahead of it
  before the seek. A host making its calls again on the way did each twice, and a call it did not
  make again still happened.
- A body shows the time sought as soon as a seek lands, and `sim.world()` returns that world. It
  showed the world from before the seek until the next frame, and on that frame too if no time
  had passed.
- A mix given no `history` keeps the one a debugger's `watched().history` gives it. The world
  logged only one frame of pushes, so the debugger's seek replayed every step with that frame's.
- Without a history `store`, the log of `impulse`, `drop` and `body` calls lets go of what history
  can no longer reach. It grew for the session, holding every body's Rapier description.

## 0.4.0

### Breaking

- `@msb235/blits` is a peer at `^0.19.0`, where it was `^0.18.0`. Built and tested against engine
  0.19.0; nothing here uses what that release changed.
- `PhysicsOptions` no longer takes `keyOf`: every subject in the mix is the driver's, and it keys
  them itself.

### Added

- Kinematic bodies moved by a voice: `kinematic2` and `kinematic3` add `goal` and `facing` channels
  to a body's controls, which move a kinematic body over the next step. Neither has a rest, so a
  body no voice writes stays where it is.
- History pages to a `store`. The world's state packs to plain data, its Rapier snapshot as base64,
  and the log of each frame's pushes pages out beside it, so memory stays bounded.

### Fixed

- Pushes, impulses, drops and added bodies are logged at the mix's time (`mix.now`), not the host's
  timestamp, so a seek, `rebase` or rate other than 1 no longer files them at the wrong step.
- The log of each frame's pushes reaches back to the world copy a replay at the edge of memory
  starts from, not just `history.ms`.
- `channels2`'s `rotation` takes a turn as `2 * Math.PI`. It was `angle()`, whose turn is 360, so
  two radian angles either side of ±π blended the long way round, through 0.

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
