# blits

## Demos run on blits

A demo, example, or explainer on the site shows blits working, so it runs on blits' own clock and
uses blits for anything blits does. A demo that works around the library hides it from the
debug panel and shows readers code they shouldn't write.

- **The mix's clock is the demo's clock.** Every frame calls `sync(now)` on the mix or its
  transport, and nothing else keeps time. Several mixes in one demo share a `transport()`. Never
  hold a mix at 0 and read it with `project(t)` at a time the demo keeps itself.
- **Play, pause, speed, and scrubbing go through blits:** the mix's `rate` to pause or change
  speed, and a `seek` to scrub, either the mix's (it needs `history` with a tape) or a voice
  handle's. A slider shows where the mix or voice is; it doesn't own a time of its own. Give the
  mix `history` anyway, so the panel can seek it.
- **To scrub a whole mix, pause it by not syncing it, not with `rate = 0`,** and call `rebase()` on
  resume, as `site/src/live/loop.ts` does on blur. A seek back restores the rate recorded then, and
  any host call made after a seek back (a `rate` write included) cuts off the tape ahead, so every
  later seek forward throws. `sequence.ts` scrubs this way.
- **Name every mix** (`{ name }`), so the debug panel lists it.
- **Motion is voices, not frame-loop math.** Looping, easing, fades, crossfades, and ordering are
  cues, weights, `loop`, and roles. The frame loop syncs, probes, and draws, and nothing more.
- **Check it in the panel before calling it done.** Open the page with `?panel`. The demo's mixes
  should be listed, and the panel's pause and seek should move what's on screen.
