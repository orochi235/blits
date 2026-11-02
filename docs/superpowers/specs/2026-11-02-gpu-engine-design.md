# GPU engine and shader patches

**Status: unbuilt (2026-11-02).** This spec describes work in progress; nothing in it exists in
the code yet. Delete this file once the engine ships, after moving anything worth keeping into the
site's Engine page.

For whoever builds or reviews the GPU engine. It answers what the engine is, how a host uses it,
and what runs where.

## Why

The site's heaviest demos make every pixel a subject: 10,000 to 17,000 of them. On teitou, 2.2 to
10.4 ms of their frames is spent inside the mix, which is the most a different engine could take
off (`bench/runs/2026-11-02-demos.json`). Every other demo spends under 0.4 ms there. A GPU engine
targets exactly the first kind: many subjects, all doing the same math.

## Decided (2026-11-02)

- A GPU patch carries its math twice: WGSL for the GPU, and a JS `at` for every CPU path. Chosen
  over a JS subset compiled to WGSL (no compiler to build) and over WGSL alone (which would leave
  `probe`, `project`, `seek`, and the panel needing readbacks).
- The host gets folded values as GPU buffers it binds in its own render pass. `pull` still works,
  through a readback.
- The engine lives at `@msb235/blits/gpu`, built from the core's `src`, like `@msb235/blits/lean`,
  so it can use the lane internals without making them public.
- A parallel GPU evaluator, not GPU lanes: the mixer runs unchanged, CPU lanes included, and the
  GPU side folds the same voices into buffers once a frame.

## What a host writes

```ts
import { gpu, gpuOf, shaderPatch } from '@msb235/blits/gpu';

const band = shaderPatch<Cell, Tint>(0, {
  params: { y: 'f32' },
  fields: { x: 'f32', y: 'f32', rows: 'f32' },
  helpers: COVER_WGSL, // declares `orange` and `cover`
  wgsl: `out.tint = orange * cover(0.13 - abs(subject.y - params.y), subject.rows);`,
  at: (_, c, s, p) => ({ tint: scale(ORANGE, cover(0.13 - Math.abs(c.y - p.y), c.rows)) }),
  writes: ['tint'],
});

const device = await (await navigator.gpu.requestAdapter())!.requestDevice();
const m = mix<Cell, Tint>(K, { name: 'blend-modes', engine: gpu({ device }) });
const g = gpuOf(m);
g.subjects(cells, (c) => ({ x: c.x, y: c.y, rows: c.rows }));
m.cue({ patch: band.with({ y: 0.75 }), subjects: cells });

// each frame
m.sync(now);
const tint = g.channel('tint'); // { buffer, offset, stride, axes } or null
```

`gpuOf(m)` rather than `m.gpu`, so `Mix` keeps one type whatever engine made it. It throws for a
mix the `gpu` engine did not make.

## Units

| Unit | Owns |
|---|---|
| `shaderPatch(ms, spec)` | A `fn` patch whose `at` every CPU path runs, plus a `gpu` descriptor: `wgsl` (a body that sets fields of `out` from `phase`, `pass`, `subject`, and `params`), `helpers` (WGSL declarations the body uses, included once however many patches share them), `fields`, and `params`. `at` is handed the parameter values as a fourth argument. `patch.with(values)` returns a patch sharing the shader with those parameter values. Names are checked as WGSL identifiers at creation. |
| `gpu({ device })` | An `Engine` running every form: `made(kit, opts, Lanes)` with a GPU side attached. |
| GPU side (`gpuOf`) | `subjects(list, fieldsOf)` uploads the dense subject list's fields, a subject's index being its place in the list. `channel(name)` dispatches the frame's fold on its first call after a sync and returns that channel's buffer, or null. `ready` resolves once the current kernel has compiled. |
| Eligibility | Per frame, per channel: every live voice writing it is a shader patch, names no subject outside the registered list's cover (or names none), has no per-subject delay or start, has a weight that is a number (fades allowed), and the channel's rule is supported. Otherwise the channel stays on the CPU and `channel` returns null; a development warning names the first voice and the reason, once per voice. |
| Voice table | Per eligible voice, in voice order: patch id, parameter offset, phase, pass, weight after fade and parting, role id. Worked out on the CPU with the same helpers a lane fill uses (`phaseAt`, `passAt`, the mixer's `envelope`, `weighed`). |
| Kernel builder | One WGSL compute shader: a struct of the subject fields, one function per registered patch, a loop over the voice table that switches on patch id, then each channel's fold, with roles folded by share of summed weight. Rebuilt only when a patch or channel set it hasn't compiled appears; cueing and ending voices rewrite only the voice table. |
| WGSL channel library | Rest, fold, and lerp-by-share for `sum`, `mul`, `max`, `min`, `last`, `norm(power)`, and `color()` with its 25 blend modes, ordered modes keeping `layers` slots in voice order as the CPU does. |
| WGSL host helpers | `blits_over(pose, under)` per mode, matching `toHex(pose, under)`, so a host lays a color pose over a base in its fragment shader. Exported as a WGSL string. |

## A frame

1. The host calls `sync`. The mixer advances voices on the CPU, as today.
2. The host calls `channel(name)`. On the first call since the sync, the GPU side builds the voice
   table, writes it and any new parameters with `queue.writeBuffer`, and dispatches the kernel, one
   invocation per subject, into the channel buffers.
3. The host's render pass binds the buffer and draws.

No per-subject work happens on the CPU unless the host probes or pulls; those run the mixer's own
paths, so they are exact and need no readback (`pull` on a GPU channel reads it back instead).

## Errors

- A WGSL compile error rejects `ready`, logs the patch's name with the compiler's message, and
  leaves its channels on the CPU. Nothing throws mid-frame.
- A lost device turns the GPU side off: every `channel` returns null from then on, and `ready`
  rejects.

## Keeping the twins honest

In development, the first dispatch that includes a patch reads back a sample of subjects and
compares each GPU channel with `probe` on the CPU, within f32 tolerance (relative 1e-4, absolute
1e-5), warning with the patch's name when they disagree.

## Tests

- vitest, CPU: `shaderPatch` validation and `with`, eligibility reasons, the voice table against
  what a lane fill computes, and kernel source generation (snapshot-free: the generated WGSL is
  checked for the functions and switch arms it must hold).
- Browser, WebGPU: headless Chromium on the fleet, dispatching every channel rule and blend mode on
  random inputs and comparing with the CPU fold within tolerance, plus the seven demos' patches.

## Demos

The seven per-pixel demos (number-rules, stack-order, white-balance, blend-modes, light-board,
threshold-wipe, hit-flash) move to `shaderPatch` on the `gpu` engine and draw with a small WebGPU
pass. Without `navigator.gpu`, the same patches run on the CPU with today's drawing. Afterward
`bench/demos.mjs` runs again, with GPU time from timestamp queries added, against the
2026-11-02 run.

## Not in the first version

Each of these keeps its voice or channel on the CPU: per-subject stagger, start, or weight signal;
motions and `keys` on the GPU; the `quat`, `angle`, `ink`, `affine`, and `vec` channels; patches
with `state` or `step`.
