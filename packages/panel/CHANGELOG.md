# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. The release workflow refuses a `panel-v*` tag with no
section here.

## 0.1.1

The first version on npm: 0.1.0 can never be published there.

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
