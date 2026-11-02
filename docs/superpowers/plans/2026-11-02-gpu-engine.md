# GPU Engine Implementation Plan

**Status: unbuilt (2026-11-02).** Delete with the spec once the engine ships.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `@msb235/blits/gpu`: an engine that folds shader patches' voices on the GPU into buffers a host renders from, and the site's seven per-pixel demos moved onto it.

**Architecture:** The `gpu` engine is the stock mixer (`made(kit, opts, Lanes)`) with a GPU side attached through `gpuOf(m)`. Each frame the GPU side builds a voice table on the CPU from the mixer's voices, uploads it, and dispatches one generated WGSL compute kernel, one invocation per registered subject, writing each GPU channel's folded values into a storage buffer. Every CPU path (`probe`, `pull`, `project`, `seek`) is the mixer's own and runs each shader patch's JS `at`.

**Tech stack:** TypeScript, WebGPU/WGSL, vitest (CPU tests), esbuild + Playwright Chromium in new headless mode with `--enable-unsafe-webgpu` (GPU tests and the benchmark; `channel: 'chromium'` gets the Metal adapter, the default headless shell gets SwiftShader).

**Spec:** `docs/superpowers/specs/2026-11-02-gpu-engine-design.md`.

## Files

| File | Owns |
|---|---|
| `src/gpu.ts` | The subpath's entry: re-exports the core, plus `gpu`, `gpuOf`, `shaderPatch`, `OVER_WGSL`. |
| `src/gpu/shader-patch.ts` | `shaderPatch`, `ShaderPatch`, `with`, identifier checks. |
| `src/gpu/eligible.ts` | Which channels and voices can go on the GPU this frame, and why not. |
| `src/gpu/table.ts` | The voice table: per voice phase, pass, weight, role, patch id, parameter offset. |
| `src/gpu/wgsl/numbers.ts` | WGSL for `sum`, `mul`, `max`, `min`, `last`, `norm`: rest, scale-and-merge, role lerp. |
| `src/gpu/wgsl/color.ts` | WGSL for `color()`, the commuting blend modes, and ordered layer pushing; OKLab to linear sRGB. |
| `src/gpu/wgsl/over.ts` | `OVER_WGSL`: host helpers laying a pose over a base, matching `toHex`. |
| `src/gpu/kernel.ts` | Generates the compute shader from patches, channels, and slots. |
| `src/gpu/side.ts` | The GPU side: buffers, `subjects`, `channel`, `ready`, dispatch, twin check, device loss. |
| `src/gpu/engine.ts` | `gpu({ device })` and `gpuOf`. |
| `test/gpu-*.test.ts` | vitest: everything that needs no device. |
| `test/gpu/run.mjs`, `test/gpu/*.gpu.ts` | GPU tests in headless Chromium. |
| `site/src/live/gpu-grid.ts` | The demos' shared WebGPU draw of a grid, with a CPU fallback. |

`package.json` gains the `./gpu` export and `test:gpu`; `tsconfig.json` already compiles `src/**`.

---

### Task 1: `shaderPatch`

**Files:** Create `src/gpu/shader-patch.ts`; Test `test/gpu-patch.test.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { kit, mix, sum } from '../src/index.js';
import { gpuDescriptor, shaderPatch } from '../src/gpu/shader-patch.js';

interface C { x: number }
interface P { y: number }
const band = shaderPatch<C, P>(0, {
  params: { at: 'f32' },
  fields: { x: 'f32' },
  wgsl: 'out.y = subject.x - params.at;',
  at: (_phase, c, _s, p) => ({ y: c.x - p.at }),
  writes: ['y'],
});

describe('shaderPatch', () => {
  it('is a fn patch whose CPU paths run at with its parameters', () => {
    const m = mix<C, P>(kit<P>({ y: sum() }));
    const c = { x: 5 };
    m.cue({ patch: band.with({ at: 2 }), subjects: [c] });
    m.sync(0);
    expect(m.probe(c).y).toBe(3);
  });
  it('shares one shader between patches made with with', () => {
    const a = band.with({ at: 1 });
    const b = band.with({ at: 2 });
    expect(gpuDescriptor(a)?.shader).toBe(gpuDescriptor(b)?.shader);
    expect(gpuDescriptor(a)?.values).toEqual([1]);
  });
  it('refuses a name that is not a WGSL identifier', () => {
    expect(() =>
      shaderPatch<C, P>(0, { fields: { 'x-1': 'f32' }, wgsl: '', at: () => ({}), writes: ['y'] }),
    ).toThrow(/WGSL identifier/);
  });
  it('refuses a value missing from with', () => {
    expect(() => band.with({})).toThrow(/at/);
  });
  it('has no GPU descriptor on a plain patch', () => {
    expect(gpuDescriptor({ form: 'fn' } as never)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run test/gpu-patch.test.ts` — Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { Patch, Setting } from '../types.js';

/** A WGSL scalar type a subject field or a parameter can have. */
export type Scalar = 'f32';

/** What `shaderPatch` takes. */
export interface ShaderSpec<I, O, P extends Record<string, number>> {
  /** WGSL statements setting fields of `out` from `phase`, `pass`, `subject`, and `params`. */
  wgsl: string;
  /** WGSL declarations the body uses, included once however many patches share them. */
  helpers?: string;
  /** The subject's numbers the shader reads, read on the CPU by the host's `fieldsOf`. */
  fields?: Record<string, Scalar>;
  /** Per-voice values the shader reads, bound with `with`. */
  params?: { [K in keyof P]: Scalar };
  /** The same math in JS, for every CPU path. Handed the parameter values last. */
  at(phase: number, subject: I, setting: Setting<void, unknown>, params: P): Partial<O>;
  writes: readonly (keyof O)[];
}

/** One compiled shape: shared by every patch `with` makes from the same `shaderPatch`. */
export interface Shader {
  readonly wgsl: string;
  readonly helpers: string;
  readonly fields: readonly string[];
  readonly params: readonly string[];
  readonly writes: readonly string[];
}

export interface GpuDescriptor {
  readonly shader: Shader;
  /** The parameter values, in `shader.params` order. */
  readonly values: readonly number[];
}

/** A patch carrying WGSL beside its JS. `with` binds its parameters. */
export interface ShaderPatch<I, O, P extends Record<string, number>> extends Patch<I, O> {
  with(values: P): ShaderPatch<I, O, P>;
}

const descriptors = new WeakMap<object, GpuDescriptor>();

/** The patch's GPU half, or undefined for a patch `shaderPatch` did not make. */
export function gpuDescriptor(patch: object): GpuDescriptor | undefined {
  return descriptors.get(patch);
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
function check(kind: string, names: readonly string[]): void {
  for (const n of names)
    if (!IDENT.test(n) || n.startsWith('__'))
      throw new Error(`blits: ${kind} name ${JSON.stringify(n)} is not a WGSL identifier`);
}

/**
 * A patch written twice: as WGSL the `gpu` engine runs on the GPU, and as a JS `at` every other
 * path runs. The two must agree; in development the `gpu` engine checks a sample against each other.
 *
 * @category gpu
 */
export function shaderPatch<I, O, P extends Record<string, number> = Record<string, never>>(
  duration: number,
  spec: ShaderSpec<I, O, P>,
): ShaderPatch<I, O, P> {
  const fields = Object.keys(spec.fields ?? {});
  const params = Object.keys(spec.params ?? {});
  check('field', fields);
  check('parameter', params);
  check('channel', spec.writes as string[]);
  const shader: Shader = {
    wgsl: spec.wgsl,
    helpers: spec.helpers ?? '',
    fields,
    params,
    writes: spec.writes as string[],
  };
  const make = (values: P | undefined): ShaderPatch<I, O, P> => {
    const p = values ?? ({} as P);
    const patch: ShaderPatch<I, O, P> = {
      form: 'fn',
      duration,
      writes: spec.writes,
      at: (phase, subject, setting) => spec.at(phase, subject, setting as never, p),
      with(next: P) {
        for (const n of params)
          if (typeof next[n] !== 'number')
            throw new Error(`blits: with() needs a number for parameter ${n}`);
        return make(next);
      },
    };
    descriptors.set(patch, { shader, values: params.map((n) => (p[n] as number) ?? 0) });
    return patch;
  };
  return make(undefined);
}
```

- [ ] **Step 4: Run it to see it pass** — `npx vitest run test/gpu-patch.test.ts`, Expected: 5 passed.
- [ ] **Step 5: Commit** — `git add src/gpu/shader-patch.ts test/gpu-patch.test.ts && git commit -m "add shaderPatch, a patch carrying WGSL beside its JS at"`

---

### Task 2: Eligibility and the voice table

**Files:** Create `src/gpu/eligible.ts`, `src/gpu/table.ts`; Test `test/gpu-table.test.ts`.

The table holds, per eligible voice in voice order, 8 f32s: `patch` (index into the kernel's patches), `values` (offset into the parameter buffer), `phase`, `pass`, `weight`, `role` (0 for none, else 1 + index of the role among this frame's roles), `first` (1 where this voice is its role's first member this frame, else 0), and one unused slot.

A voice is eligible when: `gpuDescriptor(voice.patch)` exists; `voice.state` is `live`, `frozen`, or `fading`; `typeof voice.spec.weight !== 'function'`; it has no stagger or per-subject start (`voice.spec.stagger === undefined` and no `owner` laying it per subject: `voice.owner === null`); it names no subjects, or its named set holds every registered subject; `voice.parts === null && voice.parted === null`; and its patch has no `state` or `step`. A channel is on the GPU when its kind is supported (see Task 3's `supported`) and every voice writing it this frame is eligible. Weight is `weighed(voice.weight, envelope, 1)` with `envelope = mixer.envelope(voice, mixer.now, voice.since)` times `mixer.ownedBy(voice, undefined)` as `hosts.ts` does; elapsed is `voice.elapsedAt(mixer.now)` with freezes applied exactly as `one()` in `src/fill.ts` does; phase and pass are `phaseAt`/`passAt` from `src/clock.ts`. A voice whose elapsed is NaN (before its start, hidden past its end) gets weight 0.

- [ ] **Step 1: Write the failing test**, checking the table against what the CPU reports:

```ts
import { createHistory } from '@weasel-js/history';
import { describe, expect, it } from 'vitest';
import { kit, mix, sum } from '../src/index.js';
import { eligibility } from '../src/gpu/eligible.js';
import { shaderPatch } from '../src/gpu/shader-patch.js';
import { voiceTable } from '../src/gpu/table.js';
import { mixerOf } from '../src/gpu/engine.js';

interface C { x: number }
interface P { y: number }
const K = kit<P>({ y: sum() });
const wave = shaderPatch<C, P>(1000, {
  wgsl: 'out.y = phase;', at: (phase) => ({ y: phase }), writes: ['y'],
});
const cells = [{ x: 0 }, { x: 1 }];

describe('voice table', () => {
  it('matches the phase and weight the CPU folds with', () => {
    const m = mix<C, P>(K, { history: { ms: 5000, tape: createHistory } });
    const h = m.cue({ patch: wave, subjects: cells, loop: true, fade: { in: 400 } });
    m.sync(0);
    m.sync(250);
    const t = voiceTable(mixerOf(m), eligibility(mixerOf(m), cells).voices);
    m.probe(cells[0]);
    expect(t.rows[2]).toBeCloseTo(0.25, 6); // phase
    expect(t.rows[4]).toBeCloseTo(h.weightOf(cells[0]), 6); // weight
  });
  it('keeps a channel on the CPU, with a reason, when a voice reads a weight signal', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: cells, weight: () => 0.5 });
    m.sync(0);
    const e = eligibility(mixerOf(m), cells);
    expect(e.channels.has('y')).toBe(false);
    expect(e.reasons[0]).toMatch(/weight signal/);
  });
  it('keeps a channel on the CPU when a voice misses a registered subject', () => {
    const m = mix<C, P>(K);
    m.cue({ patch: wave, subjects: [cells[0]] });
    m.sync(0);
    expect(eligibility(mixerOf(m), cells).channels.has('y')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail** — `npx vitest run test/gpu-table.test.ts`.
- [ ] **Step 3: Implement** `eligibility(mixer, subjects) → { channels: Set<string>, voices: Voice[], reasons: string[] }` and `voiceTable(mixer, voices) → { rows: Float32Array, roles: number, values: Float32Array }` as described, plus `mixerOf(m)` in `src/gpu/engine.ts` returning the `Mixer` behind a mix (the mix object is the `Mixer`; `mixerOf` is a typed cast that throws for a mix no `made` call built). Read the freeze logic from `one()` in `src/fill.ts` and reuse `phaseAt`, `passAt`, `weighed` from `src/clock.ts`.
- [ ] **Step 4: Run to pass**, then the neighboring CPU suites once: `npx vitest run test/gpu-table.test.ts test/gpu-patch.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "add the GPU side's voice table and eligibility"`

---

### Task 3: WGSL channel library

**Files:** Create `src/gpu/wgsl/numbers.ts`, `src/gpu/wgsl/color.ts`; Test `test/gpu-wgsl.test.ts`.

Each supported channel kind maps to a `ChannelCode`: `{ axes: number, rest: string, fold: string, roleLerp: string }`, WGSL snippets the kernel splices in, operating on `acc: array<f32, AXES>` and a voice's `v: array<f32, AXES>` at weight `w`. `supported(channel)` returns the code or undefined.

| Kind | Axes | Rest | Fold (`acc` ← `acc`, `v` at `w`) | Source to mirror |
|---|---|---|---|---|
| `sum` | 1 | 0 | `acc + v*w` | `channels.ts` `add`, `times` |
| `mul` | 1 | 1 | `acc * (1 + (v-1)*w)` | `product`, `toward` |
| `max` | 1 | 0 | `max(acc, v*w)` | `larger`, `times` |
| `min`, `norm` | 1 | from `stack-rules.ts` | port `stack-rules.ts` | `stack-rules.ts` |
| `last` | 1 | none: first fold replaces | `select(acc, v, w >= 0.5)` with the band of `passes` in `fold.ts` | `last()` |
| `color()` | 4 | `[0,0,0,0]` | port `color()`'s merge/scale | `color.ts` `color` |
| commuting blend modes | 5 (tag + rgba) | `blending`'s rest | port `foldInto` | `blend-modes.ts` |
| ordered modes | 2 + 4×layers | `empty(tag, layers)` | port `layOn`/`push` | `stacked-modes.ts` |

The role lerp is the running lerp of `gatherInto` (`src/gather.ts`): `values = taken == 0 ? v : mix(values, v, w / (taken + w))`.

- [ ] **Step 1: Write the failing test**: for each kind, `supported(channel)` gives code whose `rest` and `axes` match the CPU channel's `rest` and pose length (`kit` + an empty `mix` probe gives the rest pose), and `supported(quat())`, `supported(ink())` are undefined.
- [ ] **Step 2: Fail**, **Step 3: Implement** by porting each named JS function line for line into WGSL, keeping the same names in comments-free code. **Step 4: Pass.** Numeric agreement is Task 6's job.
- [ ] **Step 5: Commit** — `git commit -m "add WGSL for the numeric rules, color, and blend-mode folds"`

---

### Task 4: Kernel builder

**Files:** Create `src/gpu/kernel.ts`; Test `test/gpu-kernel.test.ts`.

`kernel({ shaders, channels, fields }) → { code: string, outputs: { name, offset, stride, axes }[] }`. The generated module has:

- `struct Subject { <field>: f32, ... }` and `@group(0) @binding(0) var<storage, read> subjects: array<Subject>;`
- `@binding(1) var<storage, read> table: array<f32>;` (8 per voice), `@binding(2) var<storage, read> values: array<f32>;`, `@binding(3) var<uniform> frame: vec4u;` (voice count, subject count),
- `@binding(4) var<storage, read_write> out: array<f32>;`, every channel's values, channel after channel, `axes` per subject,
- each shader's helpers once (deduplicated by string), then per shader `fn patch_<i>(phase: f32, pass: f32, subject: Subject, base: u32) -> Out_<i>` where `params.<name>` is rewritten to `values[base + k]` by declaring `let params = Params_<i>(values[base], ...)` at the top of the function,
- `@compute @workgroup_size(64) fn main`: per subject, rests into accumulators, then the voice loop: read the row, `switch patch { case i: { let d = patch_i(...); fold each written channel } }`, roles gathered by the role lerp and folded at the first member, then accumulators written to `out`.

- [ ] **Step 1: Failing test**: a kernel over two shaders and two channels contains `fn patch_0`, `fn patch_1`, `case 0u`, `case 1u`, a deduplicated helper appearing once, and `outputs` offsets `[0, subjects * 1]` for two scalar channels.
- [ ] **Steps 2–4**: fail, implement, pass. **Step 5: Commit** — `git commit -m "generate the GPU engine's compute kernel"`

---

### Task 5: GPU side and engine

**Files:** Create `src/gpu/side.ts`, `src/gpu/engine.ts` (extend), `src/gpu.ts`; Modify `package.json` (add `"./gpu"` export beside `"./lean"`).

- `gpu({ device }): Engine` — `name: 'gpu'`, `runs` all forms, `create` calls `made(kit, opts, Lanes)` (the same `lanesOf` `mixer` passes; read `src/mixer.ts` for it) and records a `GpuSide` for the mix in a `WeakMap`.
- `gpuOf(m)` returns that side or throws `blits: gpuOf takes a mix the gpu engine made`.
- `GpuSide.subjects(list, fieldsOf)` stores the list, uploads `fieldsOf(s)` for each into the subjects buffer (fields in the order every registered shader names them; a missing field reads 0), and marks the kernel stale.
- `GpuSide.channel(name)`: if the mixer's frame differs from the last dispatch's, run `eligibility`, rebuild the kernel when the shader or channel set changed (async `createComputePipelineAsync`; until it resolves, return null), write the table and values, dispatch `ceil(n / 64)` workgroups, then return `{ buffer, offset, stride, axes }` for the channel or null.
- `ready`: the latest pipeline promise. On a compile error: `console.error` with the shader's first line of WGSL and the message, reject `ready`, and leave those channels null.
- `device.lost` → turn the side off for good.
- Development twin check: the first dispatch including a shader copies 16 evenly spaced subjects' outputs to a mappable buffer, compares with `mixer.probe` within relative 1e-4 / absolute 1e-5, and `warnOnce`s naming the shader's written channels on a mismatch. Skip when `process.env.NODE_ENV === 'production'`, as `warn.ts` does.

- [ ] Steps: failing vitest for `gpuOf` throwing on a stock mix and `gpu({ device: fake })` creating a mix that plays on the CPU as `mixer` does (a fake device object whose methods are never called while nothing calls `channel`); implement; pass; build the package (`npm run build`) and check `dist/gpu.js` exists. **Commit** — `git commit -m "add the gpu engine and its GPU side"`

---

### Task 6: GPU test runner and agreement tests

**Files:** Create `test/gpu/run.mjs`, `test/gpu/harness.ts`, `test/gpu/rules.gpu.ts`, `test/gpu/color.gpu.ts`; Modify `package.json` (`"test:gpu": "node test/gpu/run.mjs"`).

`run.mjs` bundles every `test/gpu/*.gpu.ts` with esbuild into one ESM file (alias `@msb235/blits` to `src/index.ts`), serves it and an HTML page on `localhost` (WebGPU needs a secure context), launches `chromium.launch({ headless: true, channel: 'chromium', args: ['--enable-unsafe-webgpu'] })`, and prints one line per test as the page reports it (`7/40 ✓ mul at weight 0.3`), exiting 1 on any failure. `harness.ts` gives `test(name, fn)` and `close(a, b, tol)`.

Each agreement test builds the same mix twice, one on `gpu({ device })` and one on `mixer`, with random voices (shader patches whose WGSL and JS compute the same function of `x`, `phase`, and a parameter), registers 257 subjects, syncs both to the same times, reads the GPU channel back, and compares every subject with the CPU mix's `probe` within f32 tolerance. Cases: every numeric rule at weights 0, 0.3, 1; two voices in a role with fades; a frozen voice; a voice past its end; `color()`; each commuting mode; each ordered mode with 1, 3, and 5 voices against `layers: 4`.

- [ ] Write the runner and the tests, run `npm run test:gpu` locally once to see them fail, fix the WGSL from Task 3 until they pass, then send the run to the fleet: `onto do --kind test --task blits-gpu-tests --expect 5m --about "WebGPU agreement tests for the gpu engine" -- npm run test:gpu`. **Commit** — `git commit -m "add WebGPU agreement tests for every channel the gpu engine folds"`

---

### Task 7: Host helpers

**Files:** Create `src/gpu/wgsl/over.ts`; Test `test/gpu/over.gpu.ts`.

`OVER_WGSL` declares `fn blits_over_color(pose: vec4f, under: vec3f) -> vec3f`, `fn blits_over_blend(pose: array<f32,5>, under: vec3f) -> vec3f`, and `fn blits_over_stack(pose: ptr<storage, array<f32>, read>, at: u32, layers: u32, under: vec3f) -> vec3f`, porting `toHex`/`shows` (`color.ts`), `blendHex` (`blend-modes.ts`), and `stackHex` with the ordered formulas (`stack-blends.ts`). Colors in and out are sRGB 0..1.

- [ ] GPU test: for random poses from Task 6's mixes and random bases, the helper's output times 255, rounded, equals `toHex(pose, base)`'s bytes within 1. Implement, pass on the fleet, commit — `git commit -m "add WGSL helpers laying a pose over a base as toHex does"`

---

### Task 8: The demos' WebGPU grid

**Files:** Create `site/src/live/gpu-grid.ts`.

`gpuGrid({ canvas, cols, rows, device, side, channels, base })` draws a full-screen triangle whose fragment shader reads the cell's pose from each named channel's buffer and lays it over the cell's base color (a storage buffer of the bases as sRGB) with `OVER_WGSL`. `gpuDevice()` resolves to a device or null (no `navigator.gpu`, no adapter). Demos call it once and keep their CPU drawing as the fallback.

- [ ] Implement; check on the white-balance demo in Task 9. Commit with Task 9.

---

### Tasks 9–15: Move each demo

One task per demo, in this order: white-balance, number-rules, blend-modes, stack-order, threshold-wipe, light-board, hit-flash. For each:

- [ ] Rewrite each `patch(...)` as `shaderPatch(...)`, its WGSL beside the existing JS `at`; factories become one `shaderPatch` plus `with` (blend-modes' `band(y)`, hit-flash's flash at the click point).
- [ ] Make the mix with `engine: gpu({ device })` when `gpuDevice()` gives one, register the cells with `gpuOf(m).subjects(cells, fieldsOf)`, and draw with `gpuGrid`; otherwise keep the mix and drawing as they are.
- [ ] Check in headless Chromium with WebGPU (`channel: 'chromium'`): the canvas matches the CPU drawing's pixels within 2 per channel at the same paused time, the controls still work, and `?panel` lists the mix and seeks it.
- [ ] Commit — `git commit -m "run the <demo> demo on the gpu engine"`

---

### Task 16: Benchmark

**Files:** Modify `bench/demos.mjs`.

- [ ] Launch `channel: 'chromium'` with `--enable-unsafe-webgpu`, and add `--engine cpu|gpu`, which the demos read from `?engine=` (default `gpu` where available). Add GPU time: wrap `GPUQueue.prototype.submit` timing with `timestamp-query` where the adapter has it, else `onSubmittedWorkDone` latency.
- [ ] Run both on teitou: `onto do --kind bench --node teitou ... -- sh -c 'npm --prefix site run build && node bench/demos.mjs --engine cpu --out bench/runs/<date>-demos-cpu.json && node bench/demos.mjs --engine gpu --out bench/runs/<date>-demos-gpu.json'`. Commit the runs.

---

### Task 17: Docs and cleanup

- [ ] `site/src/pages/engine.mdx`: a "The GPU engine" section (what runs where, `shaderPatch`, `gpuOf`, the CPU fallback, eligibility, the measured numbers from Task 16), replacing the seam bullet that calls a GPU engine unbuilt.
- [ ] `CHANGELOG.md` Unreleased → Added: `@msb235/blits/gpu`.
- [ ] `npm --prefix site run api` so the reference lists the gpu exports.
- [ ] Delete the spec and this plan; move anything worth keeping into `engine.mdx`.
- [ ] Full suite and typecheck on the fleet; commit.
