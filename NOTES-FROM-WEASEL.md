# Notes from weasel

**For:** whoever is working on blits next. **Answers:** what a read of blits from the weasel side
turned up: bugs, where the per-frame time goes, and lessons weasel paid for that apply here.
Written 2026-09-29 against `6cd7a49`; its three bugs were fixed in `5f4b2e5`. weasel (`~/src/weasel`, published as `@weasel-js/core`) is a 2D
scene-graph canvas engine whose animator lives in `packages/core/src/animation/`.

Everything under "Speed" was run, not just read: `src/` compiled with `tsc` and driven
from plain Node 24. Anything that is a suggestion says so. When an item is dealt with, delete it,
and delete this file once it is empty.

## Speed

Four channels (`mul`, `max`, `vec(3, sum())`, `hex`), 300 frames per row after 30 warm-up frames,
with one `out` object reused across probes:

| Patch | Subjects | Voices | ms/frame | ns per subject·voice |
|---|---:|---:|---:|---:|
| fn   |   100 | 1 |  0.067 |  670 |
| fn   |  1000 | 1 |  0.496 |  496 |
| fn   |  1000 | 3 |  1.157 |  386 |
| fn   |  1000 | 8 |  3.577 |  447 |
| fn   | 10000 | 3 | 21.575 |  719 |
| keys |  1000 | 1 |  1.066 | 1066 |
| keys |  1000 | 3 |  2.147 |  716 |
| keys | 10000 | 3 | 31.041 | 1035 |

That is comfortable for a sign's parts and over a 60 fps frame by itself at 10k subjects. The
whole run, about 2,600 frames, took 1783 minor GCs (`node --trace-gc`), so most of the cost is
allocation. Where it comes from, all per probe:

- `influence` builds a fresh `Setting` for every voice, and `weightOf` builds another.
- `{ delta, weight }` is returned and then spread again into `singles` (`{ voice, ...influence }`).
- `fold` allocates `singles`, `loci` and `order` every call, and calls `Object.keys(this.kit)` —
  so does `probe` (when `wantsPose`) and `atRest`.
- A rest-less channel builds the string key `` `${at}:${key}` `` for `passes` on every frame.
- `singles.find(...)` inside the `order` loop makes the cost grow with voices squared.
- `patch.at` returns a new object every call. `vec` allocates a new array in every `merge`,
  `scale` and `lerp`, and `copy(rest)` does too for a vec channel's rest.
- `readChannel` builds a `held` array and **sorts it** on every read of every channel of every
  subject. The stops never change after `keys()` returns, so the sort and per-channel filtering
  belong at build time, with a binary search per read. weasel's `sampleTrack` does this.
- `evalKeys` calls `easeBy`, `delayBy` and `lerpBy` per channel per evaluation. They are pure
  functions of the channel and could be resolved once at `keys()`. weasel made the same mistake:
  `resolveEasing(b.easing)` still runs per sample in `timeline/sampleTrack.ts`, rebuilding a
  template-string cache key for every bezier easing every frame.
- `atRest` runs a whole second `fold`. A host that checks `atRest` and then probes pays twice.
- `probe` with no `out` stores a freshly allocated pose per subject per frame in `pose`. weasel
  measured this pattern: writing a new pose object per node per frame took major GC from 57 ms to
  549 ms over 10 s (`docs/superpowers/specs/2026-08-24-frame-loop-decoupling-design.md` in weasel).

Suggestion, not measured: channels resolved to integer slots once per kit, a per-voice scratch
`Setting` and delta reused across subjects, and a single preallocated pose buffer would remove
nearly all of the above. My guess is 5–10× faster. Counting calls in a test proves nothing about
allocation, so check any speedup with the benchmark below.

<details><summary>Benchmark script (run from a directory holding compiled <code>src/</code>)</summary>

```js
import { kit, mix, mul, max, sum, vec, hex, patch, keys } from './index.js';
const K = kit({ gain: mul(), dark: max(), position: vec(3, sum()), color: hex() });
function run(label, N, voices, useKeys, frames = 300) {
  const m = mix(K);
  const subs = Array.from({ length: N }, (_, i) => ({ seed: i * 0.37 }));
  for (let v = 0; v < voices; v++) {
    const p = useKeys
      ? keys(1000, [
          { at: 0, delta: { gain: 1, position: [0, 0, 0] } },
          { at: 0.5, delta: { gain: 0.3, position: [5, 2, 0] } },
          { at: 1, delta: { gain: 1, position: [0, 0, 0] } },
        ])
      : patch(180 + v, (ph, s) => ({ gain: 0.2 + 0.8 * Math.abs(Math.sin(ph * Math.PI + s.seed)), dark: ph * 0.1 }),
          { writes: ['gain', 'dark'] });
    m.cue({ patch: p, fade: { in: 100 } });
  }
  const scratch = {};
  let t = 0;
  for (let f = 0; f < 30; f++) { m.sync((t += 16.7)); for (const s of subs) m.probe(s, scratch); }
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) { m.sync((t += 16.7)); for (const s of subs) m.probe(s, scratch); }
  const ms = (performance.now() - t0) / frames;
  console.log(`${label.padEnd(5)} N=${String(N).padStart(6)} V=${voices} ${ms.toFixed(3).padStart(8)} ms/frame ${((ms * 1e6) / (N * voices)).toFixed(0).padStart(5)} ns`);
}
for (const [N, V] of [[100, 1], [1000, 1], [1000, 3], [10000, 3], [1000, 8]]) run('fn', N, V, false);
for (const [N, V] of [[1000, 1], [1000, 3], [10000, 3]]) run('keys', N, V, true);
```

</details>

## Lessons weasel paid for

**A hidden tab arrives as one enormous frame.** rAF stops while a tab is hidden, so the first
`sync` after an hour away is an hour past the last one. In blits that finishes every fade and
every finite loop at once, and hands `step` a `dt` of 3.6 million ms. `Setting.dt` says catching
up by the whole gap is deliberate, which is a fine rule for state. weasel decided the opposite for
clocks: its frame gate, `useVisibleRaf`, calls an `onResume` hook, and every animation's clock
rebases there, so hidden time never counts as elapsed. Whichever way blits goes, it wants a way
to say "the clock was away": a `mix.rebase()` or a `sync(t, { resumed: true })`. It should also
state in the time model which way it went.

**Cap the step an integrator sees.** weasel's physics step is `min(0.064, Δms / 1000)` seconds.
Semi-implicit Euler blows up on a large `dt`, and so will any spring written as a blits `step`
unless the patch caps it itself, which every author will forget once.

**`performance.now()` and `Date.now()` have different origins.** weasel's tweens broke when one
path defaulted to `Date.now`. rAF timestamps share `performance.now()`'s origin. blits never reads
a clock itself, which is right, but `VoiceSpec.start` is "mix-clock ms", and saying in the
docs that this means the rAF / `performance.now()` timeline would save someone passing
`Date.now()`.

**An easing that is only a function can't be data.** weasel's `EasingSpec` is a function, a name
from a registry, or `{ bezier: [x1, y1, x2, y2] }`, so an editor can show it and a clip can be
saved. blits' `keys` form exists "so an engine that reads data can", but `Keyframe.ease` and
`KeysOptions.ease` are bare functions. A GPU or WAAPI engine can't read them. That makes easing
the seam the engine split is most likely to trip on.

**Build an interpolator once, not every frame.** weasel takes both `interpolate(a, b, t)` and
`interpolator(a, b) => (t) => T`, the second for pairs with setup cost (d3-interpolate's shape).
`mixHex` unpacks both colors on every call. A `keys` segment's endpoints are fixed, so the
unpacking could happen once per segment.

**Retargeting position without velocity leaves a kink.** `from: 'current'` starts a keys voice
where the subject is now, but its first segment starts from zero speed wherever the old motion was
heading. weasel's `physics` has `setTarget` and `setVelocity` for this. The one place weasel
doesn't carry velocity (reflow glides) is written up as a known gap.

## What weasel has that blits doesn't

Open design questions rather than asks. blits may rightly say some of these belong in a host.

- **Events on a timeline.** weasel's event tracks fire only on forward crossings of
  `(previous, playhead]`, and report `lateBy` in ms. With a `booking` they are scheduled 100 ms
  ahead against an outside clock (an audio engine's `now()`), and a pause, seek, rate change or
  edit retracts the booking. Sound cues in wod or magicsmoke will want this. A blits voice can
  only produce values.
- **Pause and time scale at every level, multiplied.** weasel scales the whole animator, a key and
  a handle, and multiplies the three. blits has `rate` per voice and nothing mix-wide.
- **Nesting.** A weasel timeline can hold child timelines at offsets, and the parent owns their
  playback. A blits voice is flat.
- **Observability that costs nothing unwatched.** weasel's `watch(listener)` and `live()` build
  event objects only while something is subscribed. A mix can't currently answer "what is
  playing and at what weight" without a debugger.

## What weasel would need before depending on blits

For context. weasel has no stacking model: two animations writing the same property resolve as
last-writer-wins, which its vertex-color and animation specs both flag as unsolved. blits' channel
model is the answer to that. For weasel to use it, blits has to be on npm (`@weasel-js/core`
can't take a `file:` dependency), the out-object bug has to be fixed, and the hot path has to run
at scene sizes: thousands of nodes, probed from the paint walk every frame.
