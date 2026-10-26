# blits

Effects over time, at once or in order. Each effect runs on its own clock with its own state and
weight. Effects that overlap are folded by a mix into one value per subject per frame, by rules
that belong to the channel, not the effect. Effects that follow one another are placed on a score,
at a time or against another effect's start or end, and the mix can be read ahead, read back, and
moved to any moment, as a scrubber does.

It is the thing klieg does three times over — motion, effects, lighting — and wod does once for
transitions, extracted so those repos, sherpa and magicsmoke can share one vocabulary and one
engine.

```ts
import { color, kit, max, mix, mul, patch, sum, vec } from '@msb235/blits';

// What a part of a sign can move on. The arithmetic lives here and nowhere else.
const PART = kit<PartPose>({
  gain: mul(),
  dark: max(),
  position: vec(3, sum()),
  color: color(),
});

const flicker = patch<Part, PartPose>(
  180,
  (phase, part) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(phase * Math.PI + part.seed)) }),
  { writes: ['gain'] },
);

const m = mix<Part, PartPose>(PART);
const handle = m.cue({ patch: flicker, loop: true, fade: { in: 300, out: 300 } });

// Once a frame: tell the mix what time it is, then ask for the parts you are about to draw.
function frame(timestamp: number) {
  m.sync(timestamp);
  for (const part of visible) apply(part, m.probe(part, scratch));
  if (m.live) requestAnimationFrame(frame);
}

// A hidden tab gets no frames; say the time away should not count, or every fade finishes at once.
document.addEventListener('visibilitychange', () => document.hidden || m.rebase());

handle.fade({ over: 500 }); // the voice ramps out and leaves
handle.rise({ over: 500 }); // or, before it is gone, climbs back from where it had got to
```

In order, on the same mix:

```ts
// Place a voice at a time on the host's clock, or against another voice's marks.
m.cue({ patch: typeIn, name: 'title', start: 1000 });
m.cue({ patch: tint, anchor: { start: { after: 'title', by: 200 } } });

// A span fits the voices it holds into a budget, one after another by default.
const intro = m.span({ duration: 2000 });
for (const line of lines) m.cue({ patch: typeIn, owner: intro });

// Read the mix half a second ahead without moving it, or move it: a scrubber.
const next = m.project(m.now + 500).probe(part);
m.seek(1200); // back as well as forward, given `history` with a tape
```

## The words

These carry the rest: **delta** (a partial record of channel values), **channel** (one field
with its own arithmetic), **kit** (the channel set for one kind of delta), **subject** (what is
driven), **patch** (a pure function of phase and a subject), **voice** (a patch with its own clock
and weight), **mix** (the live voices over one kit), **signal** (a 0..1 scalar from outside the
clock), **handle** (the live controls on one voice), **engine** (the implementation behind a mix).

For time: **score** (the plan a source's voices are placed on), **mark** (a voice's start, fade-in
done, last pass ended, fade-out begun, or end, or a named point the host announces), **anchor** (a time given by
another voice's mark), **span** (an owner fitting the voices it holds into a duration), **project**
(read the mix at another time without moving it), **seek** (move the mix to a time and play on).

The design — the full vocabulary, the channel table, the time model, blending, the engine seam, and
what is still open — is `docs/schema.html`, which ships in the package: open it from
`node_modules/@msb235/blits/`. The naming work behind it is
`docs/vocabulary.json`, which semanticore serves as a page.
That repo is private; the JSON stands on its own.

## The site

`site/` is a docs site with a live explainer for each word and the API reference, generated from the
doc comments in `src/`. It runs the working tree, not a build:

```
npm run site         # dev server on port 4880
npm run site:smoke   # build, then load every page headless and fail on any error
```

`.github/workflows/site.yml` deploys it to GitHub Pages on every push to `main`, and by hand.

## A smaller bundle

Lanes, which work a channel out for every subject at once, are about a quarter of the package. A
host with tens of subjects does not need them:

```ts
import { kit, mix, patch, sum } from '@msb235/blits/lean';
```

Everything else is the same and so are the poses. `lanes: true` is refused there.

## Dragging and flinging

`@msb235/blits/fling` drags a motion patch's subject by pointer and flings it on release:

```ts
import { fling } from '@msb235/blits/fling';

const scroll = glide<Page, Pose>('y', { from: 0 });
mix.cue({ patch: scroll });
const off = fling(element, scroll, page, { scale: -1 }); // content moves against the drag
```

A press stops the glide where it is, each move puts it under the pointer, and letting go pushes it at
the pointer's velocity. `track` reads that velocity from any `(t, x)` samples, with no listeners of
its own. Anything else in the mix can read the glide's position and velocity, so parallax, a header
that shrinks or a blur that grows with speed are voices driven by a signal over `scroll.read(page)`.

## Writing patches for blits in another library

A library that ships patches exports them with the channels they write, as a `Kit` of its own
for the host to spread into its kit, and checks them in its own tests against
`@msb235/blits/testing`:

```ts
import { checkPatch, setting } from '@msb235/blits/testing';

expect(checkPatch(glow, { subject, kit })).toEqual([]); // each string names a problem
glow.at(0.5, subject, setting({ weight: 0.5 })); // a Setting for calling a patch outside a mix
```

`checkPatch` reads the patch across its phase from fresh state and reports what a mix cannot rely
on: writing outside `writes`, a delta that changes between identical reads, a touched subject,
state shared between subjects, a `step` that lands differently from the same start, a `clone`,
`pack` or `unpack` that does not give back an equal state, a missing host field, and a kit that
`cue` would refuse. Two copies of blits loaded together read each other's patches and channels.

## Packages

`packages/quarks` is `@msb235/blits-quarks`, a driver that turns poses into
[three.quarks](https://github.com/Alchemist0823/three.quarks) particles. It is published separately
so the engine keeps no dependencies; its README says how it works.

`packages/tone` is `@msb235/blits-tone`, a driver that schedules a mix on the audio clock through
[Tone.js](https://tonejs.github.io): channels as parameter curves read ahead, and hits and marks at
their sample. It is published separately for the same reason, and its README says what it does not
do yet.

## Status

v0.14.0, with five consumers. magicsmoke runs every fault on it, wod its wheel, tricks and
transitions, weasel its animator's tweens, sherpa its seams, and
[klieg](https://github.com/orochi235/klieg) composes all three of its systems — letter motion,
part effects, and the environment a sign is lit by — on a mix each.
That port was an extraction rather than a rewrite, so it is also the evidence that the arithmetic
here is the arithmetic a working renderer already had: klieg's suite of 1974 cases and its
screenshot baselines came through it unchanged.

One thing the port sent back. klieg's three motion phases layer, so they cue as separate voices; a
`role` folds its members through each channel's `lerp` instead, which is what a crossfade between
alternatives wants and is not the same number on a multiplicative channel. Reach for a role when
one voice should replace another, not when both should be heard.

Zero runtime dependencies, ESM only, types included.

```
npm install
npm run check          # lint, typecheck, test
npm run test:general   # the tests again with lanes off
```

A lane is a channel the mix computes for every subject at once, and the general path is the same
fold made subject by subject. `test:general` turns lanes off in every mix that does not set `lanes`
itself, so the whole suite runs on the general path.

MIT.
