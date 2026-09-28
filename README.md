# blits

Concurrent effects, mixed. Each effect runs on its own clock with its own state and weight, and a
mix folds them into one value per subject per frame by rules that belong to the channel, not the
effect.

It is the thing klieg does three times over — motion, effects, lighting — and wod does once for
transitions, extracted so those repos, sherpa and magicsmoke can share one vocabulary and one
engine.

```ts
import { hex, max, mix, mul, patch, rig, sum, vec } from 'blits';

// What a part of a sign can move on. The arithmetic lives here and nowhere else.
const PART = rig<PartPose>({
  gain: mul(),
  dark: max(),
  position: vec(3, sum()),
  color: hex(),
});

const flicker = patch<Part, PartPose>(
  180,
  (phase, part) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(phase * Math.PI + part.seed)) }),
  { writes: ['gain'] },
);

const m = mix<Part, PartPose>(PART);
const handle = m.cue({ patch: flicker, fade: { in: 300, out: 300 } });

// Once a frame: tell the mix what time it is, then ask for the parts you are about to draw.
function frame(now: number) {
  m.sync(now);
  for (const part of visible) apply(part, m.sample(part, scratch));
  if (m.live) requestAnimationFrame(frame);
}

handle.fade({ over: 500 }); // the voice ramps out and leaves
```

## The words

Ten of them carry the rest: **delta** (a partial record of channel values), **channel** (one field
with its own arithmetic), **rig** (the channel set for one kind of delta), **subject** (what is
driven), **patch** (a pure function of phase and a subject), **voice** (a patch with its own clock
and weight), **mix** (the live voices over one rig), **signal** (a 0..1 scalar from outside the
clock), **handle** (the live controls on one voice), **engine** (the implementation behind a mix).

The design — the full vocabulary, the channel table, the time model, blending, the engine seam, and
what is still open — is `docs/2026-09-15-schema.html`, which ships in the package: open it from
`node_modules/blits/`. The naming work behind it is
`docs/2026-09-15-vocabulary.json`, which semanticore serves as a page.
That repo is private; the JSON stands on its own.

## Status

v0.1.0, and one real consumer: [klieg](https://github.com/orochi235/klieg) composes all three of
its systems — letter motion, part effects, and the environment a sign is lit by — on a mix each.
That port was an extraction rather than a rewrite, so it is also the evidence that the arithmetic
here is the arithmetic a working renderer already had: klieg's suite of 1974 cases and its
screenshot baselines came through it unchanged.

One thing the port sent back. klieg's three motion phases layer, so they cue as separate voices; a
`group` folds its members through each channel's `lerp` instead, which is what a crossfade between
alternatives wants and is not the same number on a multiplicative channel. Reach for a group when
one voice should replace another, not when both should be heard.

Zero runtime dependencies, ESM only, types included.

```
npm install
npm run check   # lint, typecheck, test
```

MIT.
