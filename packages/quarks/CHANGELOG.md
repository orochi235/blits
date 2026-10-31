# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `quarks-v*` tag with no
section here.

## Unreleased

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
