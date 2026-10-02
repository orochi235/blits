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

The `webgpu` package runs Dawn in Node. Its postinstall only strips macOS quarantine from
`dawn.node`; npm's install-script allowlist skips it, and the binary loaded without it here.

## Results

Apple M2 Max, Metal (`apple-m2-max`, `metal-3`, not a fallback adapter), Node 26.10.

**Smoke run, under load** (loadavg 12.5 at start, 12.7 at end, on 12 cores: other benchmarks were
running). CPU rows are inflated by the load; GPU rows less so. The full grid replaces this table.

| N | V | variant | median ms | p95 ms | ns / subject·voice |
|---:|---:|---|---:|---:|---:|
|   1,000 | 1 | mixer   |   0.522 |   0.701 | 522.0 |
|   1,000 | 1 | dense   |   0.051 |   0.116 |  50.6 |
|   1,000 | 1 | gpu     |   0.251 |   0.638 | 250.8 |
|   1,000 | 1 | gpu+rb  |   0.237 |   0.477 | 237.1 |
|   1,000 | 1 | gpu+rb2 |   0.115 |   0.524 | 115.1 |
|   1,000 | 8 | mixer   |   4.840 |   6.219 | 605.1 |
|   1,000 | 8 | dense   |   0.296 |   0.604 |  37.0 |
|   1,000 | 8 | gpu     |   0.239 |   0.917 |  29.9 |
|   1,000 | 8 | gpu+rb  |   0.248 |   0.896 |  31.0 |
|   1,000 | 8 | gpu+rb2 |   0.138 |   0.252 |  17.3 |
| 100,000 | 1 | mixer   |  95.585 | 117.160 | 955.9 |
| 100,000 | 1 | dense   |   3.817 |   5.173 |  38.2 |
| 100,000 | 1 | gpu     |   0.260 |   1.023 |   2.6 |
| 100,000 | 1 | gpu+rb  |   0.355 |   1.769 |   3.6 |
| 100,000 | 1 | gpu+rb2 |   0.204 |   0.476 |   2.0 |
| 100,000 | 8 | mixer   | 402.831 | 621.778 | 503.5 |
| 100,000 | 8 | dense   |  29.166 |  46.916 |  36.5 |
| 100,000 | 8 | gpu     |   0.284 |   0.485 |   0.4 |
| 100,000 | 8 | gpu+rb  |   0.368 |   0.821 |   0.5 |
| 100,000 | 8 | gpu+rb2 |   0.205 |   0.806 |   0.3 |

Max abs error against the mix: `dense` ≤ 1.9e-6, the shader ≤ 3.2e-5. Both are float32 rounding;
the shader's is larger because it also does its arithmetic, including time, in float32.

Floors, measured before the grid: an empty submit awaited through `onSubmittedWorkDone` takes
0.044 ms median; a 4-byte copy awaited through `mapAsync` takes 0.194 ms.

## Caveats

- **Nothing here is the real engine seam.** The shader knows this one kit and this one stop shape
  (three stops at 0, 0.5, 1); it has no `fn` patches, `locus`, `from: 'current'`, signals, bounds,
  rest-less channels or events. It answers what the arithmetic costs, not what a general GPU
  engine would.
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
