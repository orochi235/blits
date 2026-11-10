# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `quarks-v*` tag with no
section here.

## Unreleased

### Changed

- An emitter cues and drops through the engine's `bind`, so a cue naming `subjects` or made after
  `drop` throws the engine's message, prefixed `blits:`.
- Needs `@msb235/blits` 1.3.0 or later, for `bind`: the peer range rises with the next engine release.

## 0.17.2

### Changed

- Built and tested against engine 1.2.0.

## 0.17.1

### Changed

- Built and tested against engine 1.1.1.

## 0.17.0

### Added

- `drive`'s `carry: 'float'` sums `rate` in doubles, as a host's own loop sums `rate * dt`, so it
  emits on the frames that loop does, a frame late where rounding leaves the sum a hair under a
  whole particle. A host can move its own emitter onto `rate` without moving a particle. The exact
  carry stays the default, since it emits the same however syncs split the time, across a `rebase`
  included, which a float sum does not.

### Changed

- A driver owes the mix time played since it was made, where its first write owed nothing. A
  driver made for a mix already playing emits for the frame after it was made, as an emitter
  started then would; on a mix that has not synced nothing changes.

## 0.16.0

### Breaking

- `@msb235/blits` is a peer at `^1.0.0`, where it was `^0.20.0`. Built and tested against engine
  1.0.0; nothing here uses what that release changed.

## 0.15.0

### Breaking

- `@msb235/blits` is a peer at `^0.20.0`, where it was `^0.19.0`. Built and tested against engine
  0.20.0; `write` owes by its `mix.played`.

### Fixed

- `write` owes what the mix's syncs played since the last write, `mix.played`, so a long frame
  emits no more than the mix's `maxDt` allows, as patches step. It emitted the whole gap. A seek no
  longer needs a `write` right after it: a seek back lost the frame after it, and a seek ahead made
  while the host was not syncing was emitted on resume. A frame that sets the rate and starts a
  ramp owes the ramp in full, where it came up short (4 particles where 5 were owed).

- Two drivers on one mix that share a `bursts` tag no longer lose each other's bursts. A drain
  takes every event under its tag, so the driver that wrote first dropped the bursts it drained for
  the other's subjects; it now hands them to that driver, which emits them at its next `write`.

## 0.14.0

### Breaking

- `@msb235/blits` is a peer at `^0.19.0`, where it was `^0.18.0`. Built and tested against engine
  0.19.0; nothing here uses what that release changed.

### Added

- `write` returns `quarks.emitted`, a map from each subject that emitted at that write to how many
  particles it did, bursts included. A host that does something per particle, such as a crackle
  sound, reads it rather than counting again. It still holds the other subjects' counts when
  `write` throws.
- `attach`'s `rate`, a number or a function asked every write, adds particles per second of the
  host's own to the pose's `rate`. No voice weight scales it, and it emits whether or not a voice
  plays.
- `quarks.burst(subject, n)` emits `n` particles at an attached subject on the next write, as
  `emitter.burst` does.
- `drive`'s `capture: 'write'` reads each system's start values at every write instead of once at
  `attach`, so a host can rescale or replace them live. `'attach'` stays the default.
- `attach`'s `frame: 'world'` emits at a pure translation, ignoring the emitter's world rotation
  and scale. `'emitter'` stays the default.
- `source.at(position, opts?)` takes `attach`'s other options.

### Fixed

- `write` no longer emits a particle a frame early when a subject's carry falls within a billionth
  of a particle of a whole one. The carry is now summed in twice a double's precision and floored
  exactly, where it added that much slack before flooring to absorb float drift.

## 0.13.0

### Breaking

- `@msb235/blits` is a peer at `^0.18.0`, where it was `^0.17.0`. Built and tested against engine
  0.18.0; nothing here uses what that release changed.

## 0.12.0

### Breaking

- `@msb235/blits` is a peer at `^0.17.0`, where it was `^0.16.0`. Built and tested against engine
  0.17.0; nothing here uses what that release changed.

## 0.11.1

### Fixed

- `write` no longer emits too few particles while the mix's rate ramps down: it bounded the
  frame's mix time by the rate at its end, not the higher of the two ends.

## 0.11.0

### Breaking

- `@msb235/blits` is a peer at `^0.16.0`, where it was `^0.15.0`. Built and tested against engine
  0.16.0; nothing here uses what that release changed.

## 0.10.1

### Fixed

- Built and tested against engine 0.15.1. The peer range, `^0.15.0`, is unchanged.

## 0.10.0

### Breaking

- `@msb235/blits` is a peer at `^0.15.0`, where it was `^0.14.0`. Engine 0.15.0 has breaking
  changes of its own, listed in its changelog.

## 0.9.0

### Breaking

- `@msb235/blits` is a peer at `^0.14.0`, where it was `^0.12.0`. Engine 0.13.0 has breaking
  changes of its own, listed in its changelog.

## 0.8.0

### Added

- `quarks.particles(options)` and `quarks.wire(system)` return a `Source`: a quarks system wired to
  the mix. `source.at(position)` adds an `Emitter`, an emission point that is the mix's subject for
  it, sharing the source's one system.
- `emitter.cue(spec)` cues a voice on that emitter alone; `emitter.burst(n)` emits `n` particles at
  the next `write`; `emitter.drop()` ends its voices, detaches it and drops its subject.
- `source.copy()` wires a clone of the system as a new source with no emitters, and `source.drop()`
  drops every emitter on it.

## 0.7.0

### Breaking

- `@msb235/blits` is a peer dependency, `^0.11.0`, where it was a dependency pinned to one
  version. The host installs the engine, so the driver and the host share one copy. Engine
  0.11.0 has breaking changes of its own, listed in its changelog: a voice now plays one pass
  unless given `loop`.

## 0.6.0

### Breaking

- `write()` takes nothing. It owes each subject its `rate` for the mix time since the last write,
  read from the mix: the first write owes nothing, a mix at half rate emits half, and time
  `rebase` took out or a seek ahead emits nothing. It took the frame's `dt` in ms.
- Pins `@msb235/blits` 0.10.0, which has the `mix.timestamp` it reads; that package's changelog
  has its breaking changes since 0.9.0.

## 0.5.0

### Breaking

- Pins `@msb235/blits` 0.9.0, whose breaking changes since 0.8.1 are in that package's changelog.

## 0.4.0

### Breaking

- Pins `@msb235/blits` 0.8.1, whose breaking changes since 0.7.1 are in that package's changelog.

### Added

- `channels` is typed `Kit<Emission>`, so it goes where the engine takes a kit with no cast.

## 0.3.1

### Fixed

- Pins `@msb235/blits` 0.7.1, whose fixes are in that package's changelog.

## 0.3.0

### Breaking

- Pins `@msb235/blits` 0.7.0, whose breaking changes since 0.6.0 are in that package's changelog.

## 0.2.0

### Breaking

- Pins `@msb235/blits` 0.6.0, whose breaking changes since 0.2.1 are in that package's changelog.

## 0.1.0

### Added

- `drive(mix, { kit, bursts? })`, `attach`, `detach` and `write`: a subject's `rate` emits particles
  at its position on a system it may share with other subjects, each born with its own subject's
  `speed`, `size`, `life` and `tint`; events tagged for bursts emit `count` more. `channels` holds
  the stock channels for those fields.
