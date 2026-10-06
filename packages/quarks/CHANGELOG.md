# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `quarks-v*` tag with no
section here.

## 0.2.0

### Breaking

- Pins `@msb235/blits` 0.6.0, whose breaking changes since 0.2.1 are in that package's changelog.

## 0.1.0

### Added

- `drive(mix, { kit, bursts? })`, `attach`, `detach` and `write`: a subject's `rate` emits particles
  at its position on a system it may share with other subjects, each born with its own subject's
  `speed`, `size`, `life` and `tint`; events tagged for bursts emit `count` more. `channels` holds
  the stock channels for those fields.
