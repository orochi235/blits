# GPU engine spike: fold capacity

This is a spike, not an engine. Nothing here ships: the directory is outside the package's `files`,
has its own private `package.json`, and blits itself keeps zero dependencies. It measures how many
subjects × voices each fold strategy computes per frame, to inform whether weasel (a 2D canvas scene
graph that reads poses in JS during its paint walk) and the three.js consumers (klieg, magicsmoke)
should adopt blits, and whether a GPU engine is worth building.

## What it measures

One workload for every variant. A kit of `gain: mul()`, `dark: max()`, `position: vec(3, sum())`.
V `keys` voices, each with three stops (at 0, 0.5 and 1) eased by data: a CSS named curve into the
middle stop, a `cubic-bezier` into the last. Each voice fades in over an `ease-out` ramp, has a
steady weight (one in three is 0.6), and staggers every subject by a whole number of ms (0–599)
derived from the subject's index, so no two subjects share a phase. A frame is: advance time, then
compute every subject's folded pose.

| Variant | What runs per frame | Models |
|---|---|---|
| `mixer` | the real blits mix from `dist/`: `m.sync(t)`, then `m.probe(s, out)` per subject | blits as it ships |
| `dense` | one JS loop over voices × subjects, poses in `Float32Array`s (struct of arrays), stops and curve coefficients packed once | a CPU engine built for scale |
| `gpu` | a WGSL compute shader, one thread per subject; per frame a small uniform (time, voice weights), one dispatch, wait for `onSubmittedWorkDone` | three.js reading the pose buffer as instance attributes |
| `gpu+rb` | `gpu`, plus a copy into a `MAP_READ` buffer and `mapAsync`, until the pose is in a JS `Float32Array` | weasel |
| `gpu+rb2` | `gpu+rb` double-buffered: submit frame f, return frame f−1's pose | weasel, one frame late |

`dense` and the shader use blits' own fold rules (`src/channels.ts`: mul folds `1 + (v − 1)·w`, max
folds `v·w` against the pose, sum adds `v·w`), its weight clamp, fade envelope and cubic-bezier
solver (`src/easing.ts`). Before each (N, V), every variant is compared against the mix for 32
subjects at seven times from mid-fade to 12 s in; the line printed is the max absolute error.

## How to run

```sh
npm run build                     # at the repo root: the mix variant reads dist/
cd spikes/gpu-engine && npm install
node bench.mjs --smoke            # N ∈ {1k, 100k}, V ∈ {1, 8}, 60 frames
node bench.mjs                    # the full grid: N ∈ {1k, 10k, 100k, 1M}, V ∈ {1, 3, 8}
```

Each row prints as it finishes. Rows warm up 30 frames and time 200 (fewer where a frame passes
20 ms). The mix is skipped at 1M where the 100k row implies a frame over ~1 s. `results.json` is
rewritten each run and ignored by git.

`node motion-bench.mjs` (`--smoke` for N ∈ {1k, 10k}) runs the tween and spring rows below. It
needs only `dist/`, not `webgpu`, and writes `motion-results.json`.

The `webgpu` package runs Dawn in Node. Its postinstall only strips macOS quarantine from
`dawn.node`; npm's install-script allowlist skips it, and the binary loaded without it here.

## Results

Apple M2 Max, Metal (`apple-m2-max`, `metal-3`, not a fallback adapter), Node 26.10.

**Full grid, 2026-10-01, on fleet node `orochi`** (loadavg 21 at start, 17 at end, on 12 cores, so
not quiet: CPU rows are inflated and their p95s are wide; GPU rows less so). Median ms per frame;
`—` is a `mixer` row skipped because its frame would pass a second. Per-row p95 and ns per
subject·voice are in `results.json` after a run.

| N × V | `mixer` | `dense` | `gpu` | `gpu+rb` | `gpu+rb2` |
|---|---:|---:|---:|---:|---:|
|     1,000 × 1 |    0.517 |    0.039 |    0.226 |    0.258 |    0.114 |
|     1,000 × 3 |    1.510 |    0.106 |    0.241 |    0.264 |    0.126 |
|     1,000 × 8 |    4.341 |    0.276 |    0.243 |    0.295 |    0.169 |
|    10,000 × 1 |    6.802 |    0.369 |    0.198 |    0.255 |    0.118 |
|    10,000 × 3 |   23.520 |    1.341 |    0.256 |    0.267 |    0.120 |
|    10,000 × 8 |   78.265 |    2.855 |    0.273 |    0.356 |    0.170 |
|   100,000 × 1 |  110.967 |    4.058 |    0.220 |    0.349 |    0.165 |
|   100,000 × 3 |  161.574 |   11.346 |    0.299 |    0.406 |    0.209 |
|   100,000 × 8 |  483.913 |   33.191 |    0.357 |    0.457 |    0.234 |
| 1,000,000 × 1 |        — |   44.660 |    0.353 |    1.408 |    0.653 |
| 1,000,000 × 3 |        — |  147.610 |    0.556 |    1.973 |    0.658 |
| 1,000,000 × 8 |        — |  489.374 |    0.809 |    2.040 |    0.871 |

Largest N × V whose median fits the budget:

| Variant | 2 ms | 4 ms | 8 ms |
|---|---:|---:|---:|
| `mixer` | 3,000 | 3,000 | 10,000 |
| `dense` | 30,000 | 80,000 | 100,000 |
| `gpu` | 8,000,000 | 8,000,000 | 8,000,000 |
| `gpu+rb` | 3,000,000 | 8,000,000 | 8,000,000 |
| `gpu+rb2` | 8,000,000 | 8,000,000 | 8,000,000 |

8,000,000 is the largest row in the grid, not a ceiling the GPU reached.

Max abs error against the mix: `dense` ≤ 1.9e-6, the shader ≤ 3.9e-5. Both are float32 rounding;
the shader's is larger because it also does its arithmetic, including time, in float32.

Floors, measured before the grid: an empty submit awaited through `onSubmittedWorkDone` takes
0.044 ms median; a 4-byte copy awaited through `mapAsync` takes 0.194 ms.

## weasel's tweens and springs

The `keys` rows above are not weasel's workload. weasel's animator bench
(`tests/perf/bench/animator-on-blits.bench.ts` in weasel) moves N nodes' `{ x, y }` (a
`pos: vec(2, sum())` kit, string subject ids) by a tween or a spring per node, in two shapes: one
voice reading each node's endpoints, and a voice per node named with `subjects: [id]`.
`motion.mjs` and `motion-bench.mjs` time that workload, CPU only.

| Variant | Tween | Spring |
|---|---|---|
| `mixer` | `patch(60 s, fn)` easing (i, −i) to (i + 500, 300 − i) by weasel's `easeOut` | blits' `spring`, weasel's undamped settings, `settle: 0` |
| `dense fn` | the same closure, called per subject inside the loop, returning `{ pos: [x, y] }` | — |
| `dense native` | the tween written into the loop over `Float64Array`s | the underdamped closed form from `src/motion.ts`, position and velocity per subject |

In dense, one voice is one start and weight for every subject; a voice per node is N voices, each
with its own start, period, weight and endpoints, looping over voices and writing through a subject
index. The bench never retargets, so the native spring holds each subject's stretch (release time,
x0, v0, target) and never rewrites it. Every dense variant matched the mix exactly (max abs error 0,
velocity included) at seven times up to 12.3 s, for 32 subjects per row.

**2026-10-01, fleet node `orochi`** (loadavg 9.3 at start, 10.2 at end, on 12 cores). Median ms per
frame, and the mix's median over each row's.

| N | kind | shape | `mixer` | `dense fn` | `dense native` | fn × | native × |
|---:|---|---|---:|---:|---:|---:|---:|
|   1,000 | tween  | one voice  |  0.132 | 0.014 | 0.003 |  9.2 |  38.2 |
|   1,000 | tween  | voice/node |  0.307 | 0.011 | 0.007 | 27.8 |  42.1 |
|   1,000 | spring | one voice  |  0.270 |     — | 0.031 |    — |   8.7 |
|   1,000 | spring | voice/node |  0.286 |     — | 0.032 |    — |   9.0 |
|  10,000 | tween  | one voice  |  1.644 | 0.076 | 0.021 | 21.6 |  77.1 |
|  10,000 | tween  | voice/node |  2.721 | 0.107 | 0.075 | 25.3 |  36.2 |
|  10,000 | spring | one voice  |  3.820 |     — | 0.335 |    — |  11.4 |
|  10,000 | spring | voice/node |  6.179 |     — | 0.334 |    — |  18.5 |
| 100,000 | tween  | one voice  | 33.497 | 0.816 | 0.217 | 41.0 | 154.7 |
| 100,000 | tween  | voice/node | 57.621 | 1.256 | 0.786 | 45.9 |  73.3 |
| 100,000 | spring | one voice  | 79.620 |     — | 3.329 |    — |  23.9 |
| 100,000 | spring | voice/node | 94.915 |     — | 3.519 |    — |  27.0 |

The speedup survives the move to weasel's workload: a dense engine calling the host's own tween
closure is 20–25× the mix at 10k, so the gap is the mix's per-subject bookkeeping, not the fn call.
Springs gain least (11–19× at 10k); unprofiled, the likely cause is `exp`, `cos` and `sin` per subject.

## What a dense layout could run

Two read-only surveys from 2026-10-01: every feature in `src/types.ts` at `34a3378`, and every
function-shaped effect in blits' consumers (klieg `blits-port` `aba960f`, magicsmoke `c822948`,
weasel `pose-overrides-mix` `0799659c4`). The classes are judgments from reading the code, not
measurements.

**blits' features.** Nearly everything fits flat arrays: the stock channels including `hex`'s
bands, `keys` with data easing, number weights, fades, loops, `stagger`, `subjects`, loci,
`from: 'current'`, the score, `weightOf`, `atRest`, `project`. What doesn't is opaque per-subject
code: `fn` patches and their `state`/`step`, `spring` and `glide` as written (their segments could
become arrays), signal weights, `slew`/`lag`/`gate`, `keep`, `send`, history snapshots, and
channels with non-numeric values. Nothing classed as impossible.

**Laziness is observable.** `target`, `stagger` and `state()` run at a subject's first probe; the
fade-in origin, a finite loop's end, `fade({ at: 'rest' })`'s count, `slew`/`gate` sampling,
events and `weightOf` all depend on which subjects were probed. Filling every subject each frame
changes all of these, so an eager lane is safe only for stateless voices.

**Lanes inside `mixer`** (inferred from the code): a lane filled once per frame, with `probe` a
lookup and a copy, would land within about 2–3× of pure dense at one voice and closer at eight.
Qualification is per channel but evaluation is per voice, so one `fn` voice on a shared channel
brings the per-subject overhead back for every voice writing it. Bit-for-bit agreement needs
`Float64Array`, `%` for phase, chain order for folding, and the same `Curve` closures.

**The consumers' effects**, by table row: 15 already fit a data form, 30 fit a stock form blits
could ship, 20 fit a small expression graph, 6 need a function. The six: magicsmoke's fault
process (a seeded random stream, events), klieg's `power` (a sign-wide state machine reducing
across subjects, with a sync callback), `turns` and `roving` (cross-subject; both could be baked
into tables when built), `send` from a `step`, and the composition lab's typed source. Recurring
patterns worth a stock form: an oscillator with a per-subject phase, a follower usable as a
channel value (not only a weight), per-subject endpoints, phase remaps (`clamp`, `fract`, scale),
stepped hash noise, distance falloff, stagger by index; plus `smoothstep` and spring eases and
`min()` and `angle()` channels.

**klieg hides everything behind three adapters.** Every klieg effect, motion layer and lighting
piece reaches blits through one generic `fn` (`effects/frame.ts:92`, `motion/compositor.ts:127`,
`render/lighting.ts:73`) that reads klieg's frame context from a closure. A data engine sees
nothing in klieg until the pieces emit data forms.

## Caveats

- **Nothing here is the real engine seam.** The shader knows this one kit and this one stop shape
  (three stops at 0, 0.5, 1); it has no `fn` patches, `locus`, `from: 'current'`, signals, bounds,
  rest-less channels or events. It answers what the arithmetic costs, not what a general GPU
  engine would.
- **`dense fn` may not allocate.** The closure returns a fresh `{ pos: [x, y] }` per subject, but
  in a monomorphic loop V8 can inline it and drop the allocation (not checked). A dense engine
  calling many different host closures would see more of their cost.
- **No `hex()` channel.** A rest-less channel switches on and off through a hysteresis band held
  per subject per voice, which is state a dense or GPU fold would have to carry; leaving it out
  keeps every variant stateless.
- **The shader's bezier solve is float32.** Newton stops at 1e-6 rather than 1e-7, and the
  bisection fallback is capped at 24 steps, since float32 cannot always split an interval below
  1e-7.
- **`dense` uses `floor`, not `%`, for phase.** V8's float modulo cost about 12 ns per call, a
  quarter of the loop; the result differs from the mix's only in rounding. What remains is mostly
  the cubic-bezier solve: 9–26 ns per call depending on the curve, measured in isolation.
- **GPU rows are latency, not throughput.** Frames run back to back with a wait on each, so a GPU
  row is mostly the submit-and-wait floor until N is large. `gpu+rb2` waits only on the frame
  before, which is why it can beat `gpu`.
- **Dawn in Node is not a browser.** Chrome's WebGPU adds its own IPC and scheduling to every
  submit and map; the floors above are a lower bound for a browser.
- **The GPU object has to stay referenced.** If the object `create()` returns is collected,
  dawn.node segfaults on the next wait; `gpu.mjs` holds it at module scope.
