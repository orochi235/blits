# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `panel-v*` tag with no
section here.

## 0.4.0

### Breaking

- `@msb235/blits` is a peer at `^0.16.0`, where it was `^0.15.0`. Built and tested against engine
  0.16.0; nothing here uses what that release changed.

## 0.3.1

### Fixed

- Built and tested against engine 0.15.1. The peer range, `^0.15.0`, is unchanged.

## 0.3.0

### Breaking

- `@msb235/blits` is a peer at `^0.15.0`, where it was `^0.14.0`. Engine 0.15.0 has breaking
  changes of its own, listed in its changelog.

### Added

- **◯ circles**, beside the voices, draws each bounded voice's circle on the page, in the voice's
  hue, and the voice list marks a bounded voice with ◯. The `screen` option, which `offer` takes
  too, says where a point in the mix's positions is on screen, for positions that are not client
  coordinates. The agent sends `bounded` on each voice and a `circles` event, and takes a
  `circles` command. Needs the engine's `within` on a watched voice, from 0.15.0.
- The panel shows the plan ahead of now: a lane per voice on the plots' time axis, from its start
  to its end with a tick at each mark it reaches on the way, an arrow where no end is known, and
  the marks the host announced. The axis runs 2 s past now, and on to the furthest mark known
  within 30 s. The agent sends them as a `marks` event, and the panel now passes over an event
  kind it does not know. `MarkInfo`, `AHEAD_MS`, and `AHEAD_CAP_MS` are exported, and
  `ChannelPlot` takes a `range` to draw.

## 0.2.0

### Breaking

- `@msb235/blits` is a peer at `^0.14.0`, where it was `^0.12.0`. Engine 0.13.0 has breaking
  changes of its own, listed in its changelog.

### Changed

- With one mix on the page and none picked, the panel picks it, so the clock controls work
  without opening the window first.
- The clock reads `1:05.20` past a minute and `2:03:07.50` past an hour, where it counted seconds
  only.

## 0.1.1

0.1.0 again, published from the release workflow with provenance; 0.1.0 went out by hand.

## 0.1.0

### Added

- `mount()`: a debugger window on the page for every blits mix on it. It starts as a pill in a
  corner with the clock controls, and opens into a window with the mix's subjects and voices and
  the picked subject's channels plotted over the last 10 s. It holds a mix's clock to pause, step
  and scrub it, and picks a subject from a list or by clicking it on the page. Mixes made after it
  keep 10 s of history so they can scrub back.
- `agent()` and the `Source` protocol: the page side of the panel, speaking only plain data, so a
  DevTools extension can host the same window across a message channel.
- `ChannelPlot`, the plot the window draws, which the blits playground draws too.
- `offer({ pick, outline })`: an app hands its own picking to whatever panel inspects the page,
  the in-page one or the DevTools extension's.
- `Panel`, with a `docked` layout and a `bar` slot for a host's own controls, `panelStyles`, and
  `wireSource` and `serve`, which carry the panel's protocol over any string channel.
