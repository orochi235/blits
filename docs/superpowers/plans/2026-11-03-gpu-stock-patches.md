# GPU stock patches (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `wave`, `keys`, `tween`, `spring` and `glide` voices fold on the gpu engine, and a `shaderPatch` can read per-voice tables.

**Architecture:** Each patch kind gets a built-in WGSL runner that the kernel includes once a voice of that kind plays. A runner reads its per-voice data from the `values` buffer (as shader-patch parameters do now) and, for motions, each subject's run from a new per-subject buffer. Per-voice data is packed once per patch and re-uploaded only when the voice set changes, not every frame.

**Tech Stack:** TypeScript, WGSL, WebGPU (declared structurally in `src/gpu/webgpu.ts`), vitest, the headless-Chromium WebGPU harness in `test/gpu/`.

**Spec:** `docs/superpowers/specs/2026-11-03-gpu-reach-design.md` (phase 1, and the "Decided" section).

## Global Constraints

- Nothing here is reachable from `@msb235/blits` or `@msb235/blits/lean`; only `src/gpu/**` and the subpath `@msb235/blits/gpu` import it. The one exception is a lookup registry in `src/easing.ts` (Task 1), which costs a WeakMap set per built curve.
- The TS functions stay the definition: every WGSL port is pinned to its TS original by a WebGPU agreement test in `test/gpu/`.
- Agreement tolerance: `close()` in `test/gpu/harness.ts` (1e-5 absolute + 1e-4 relative). Near a branch (a square wave's half, a `steps` jump, a keys segment boundary, a loop wrap), a GPU value also passes if it matches the CPU evaluated at the subject's time moved by one f32 step either way; add that as `closeNear()` in the harness in Task 2 and use it only for branchy cases.
- Every time the GPU reads is relative to the frame's `now` (or the voice's anchor), never an absolute mix time, since f32 loses whole ms after about 4.6 hours.
- A voice whose data changed must not recompile the kernel; only a new runner kind or channel set may.
- Source files stay a few hundred lines; split `kernel.ts` (220 lines) and `side.ts` (330) by responsibility as you add to them.
- WebGPU tests run only on teitou: `onto do --kind test --node teitou -task <name> -expect 5m -in blits-gpu-stock -- npm run test:gpu [file filter]`. Unit tests: one file locally with `npx vitest run <file>`; more than one file goes through `onto do --kind test`.
- Commits: imperative subject in the repo's register (`git log` for examples), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Each task adds its line to `CHANGELOG.md` under `## Unreleased` → `### Added`.
- A voice that cannot run on the GPU stays on the CPU with one sentence in `eligibility().reasons`, as now. Never a silent fallback.

## Review Focus

- **A keys voice whose easing is a plain JS function, or whose stop holds a non-number** (string, object): it must stay on the CPU with a reason, never fold garbage. Test in Task 4.
- **A motion retargeted with `.to()` in the same frame the host reads only GPU buffers, with no CPU probe**: the GPU must show the new stretch that frame. Test in Task 6.
- **A table re-given through `with` with new contents while the voice plays**: the next frame reads the new contents without a recompile. Test in Task 5.
- **Two voices of one kind with different data in one frame** (two `keys` patches, two waves): each reads its own region. Test in Tasks 3 and 4.
- **Registering a new subject list after motions have runs** (`gpuOf(m).subjects()` called again, reordered): runs re-mirror in the new order. Test in Task 6.

---

### Task 1: Curves as data

**Files:**
- Modify: `src/easing.ts`
- Create: `src/gpu/wgsl/easing.ts`
- Test: `test/easing-data.test.ts`, `test/gpu/easing.gpu.ts`

**Interfaces:**
- Produces: `curveData(c: Curve | undefined): readonly number[] | undefined` in `src/easing.ts` — `[0]` for none or `linear`, `[1, x1, y1, x2, y2]` for a bezier (the named CSS curves included), `[2, n, jumpStart ? 1 : 0]` for `steps`, `undefined` for a plain function. Always 5 numbers long, padded with 0, so a stop's slot has a fixed width: `CURVE_WIDTH = 5`.
- Produces: `EASING_WGSL` in `src/gpu/wgsl/easing.ts`, declaring `fn blits_ease(at: u32, u: f32) -> f32` that reads `values[at .. at + 5]` and evaluates as `bezier` / `steps` in `src/easing.ts` do (8 Newton steps to 1e-6, then bisection capped at 24 steps, as the spike found f32 needs).

- [ ] **Step 1: Write the failing unit test** — `curveData(curve('ease-out'))` equals `[1, 0, 0, 0.58, 1]`; `curveData(curve({ steps: 4, jump: 'start' }))` equals `[2, 4, 1, 0, 0]`; `curveData(curve('linear'))` and `curveData(undefined)` equal `[0, 0, 0, 0, 0]`; `curveData((u) => u * u)` is `undefined`.
- [ ] **Step 2: Run** `npx vitest run test/easing-data.test.ts` — expect FAIL (`curveData` not exported).
- [ ] **Step 3: Implement** a `WeakMap<Curve, number[]>` filled where `bezier`, the named table and `steps` build curves; `curveData` reads it.
- [ ] **Step 4: Run** the unit test — expect PASS.
- [ ] **Step 5: Write `test/gpu/easing.gpu.ts`** — a one-off compute pass (no mix) evaluating `blits_ease` for every named easing, two custom beziers including one with `x1 = 0`, and `steps` 1/4/7 with both jumps, at 1,025 evenly spaced `u` plus 0, 1, −0.1, 1.1; compare to the TS curve with `close`, `closeNear` at steps' jumps.
- [ ] **Step 6: Run** on teitou with filter `easing` — expect all pass.
- [ ] **Step 7: Commit** — "pack easing curves as numbers, and evaluate them in WGSL".

### Task 2: Runners in the kernel

**Files:**
- Create: `src/gpu/runner.ts`, `src/gpu/region.ts`
- Modify: `src/gpu/kernel.ts`, `src/gpu/table.ts`, `src/gpu/eligible.ts`, `src/gpu/side.ts`, `src/gpu/shader-patch.ts`, `src/gpu/wgsl/channels.ts`
- Test: `test/gpu-kernel.test.ts`, `test/gpu-table.test.ts`, `test/gpu/harness.ts` (add `closeNear`)

**Interfaces:**
- Produces, in `src/gpu/runner.ts`:
  ```ts
  /** One kind of patch the kernel can run: shader patches are one runner per Shader, each stock kind is one. */
  export interface Runner {
    /** Stable across patches of the kind: the kernel cache key includes it. */
    readonly key: string;
    /** WGSL declarations, included once per kernel. */
    readonly helpers: string;
    /** The WGSL body of `fn run_<i>(phase: f32, pass_index: f32, subject: Subject, base: u32, sub: u32) -> Out_<i>`, setting `out.<channel>` for each channel it writes. `base` is the voice's offset in `values`; `sub` its offset in the per-subject buffer for this subject (0 where it has none). */
    readonly wgsl: string;
    readonly writes: readonly string[];
    readonly fields: readonly string[];
  }
  /** What a voice's patch gives the GPU, or a sentence saying why it cannot. */
  export type Packed = { runner: Runner; values: Float32Array; perSubject?: PerSubject } | { why: string };
  export function packOf(patch: object, channels: ChannelLookup): Packed | undefined;
  ```
  `packOf` returns `undefined` for a patch no runner claims (the existing "its patch is not a shaderPatch" reason becomes "no gpu runner takes a `<form>` patch"). It caches by patch identity, so a patch's `values` are packed once.
- Produces, in `src/gpu/region.ts`: `class Regions` — appends each frame's voices' packed `values` into one `Float32Array`, keeping a voice's offset while its patch is unchanged, and reports the byte ranges that changed so `side.ts` writes only those (`writeBuffer` per range, coalesced when ranges touch).
- `ChannelCode.lerp` (added for `angle()` in bddfb8d) becomes required: `mix(x, y, u)` for every stock rule, the short way for `angle`. Rules with no WGSL lerp yet (the blend-mode colors) leave `lerp` undefined, and Task 4 keeps `keys` on those channels on the CPU.
- The table row gains no new columns: `Col.SHADER` now indexes runners.
- Binding 5, `persub: array<f32>` (read-only storage), is added to the layout now, bound to a 16-byte buffer until Task 6 fills it.

- [ ] **Step 1: Write failing kernel tests** — a kernel built from one shader-patch runner and one stub runner (`key: 'stub'`, `wgsl: 'out.v = 1.0;'`) contains `fn run_0` and `fn run_1` and a `case 1u` arm; `kernel()` called twice with the same runner keys returns code equal byte for byte.
- [ ] **Step 2: Run** `npx vitest run test/gpu-kernel.test.ts` — FAIL.
- [ ] **Step 3: Implement** `Runner` and `packOf` (shader patches only for now: `shaderPatch` registers itself as a runner keyed by its `Shader`), and change `kernel()` to take `readonly Runner[]`.
- [ ] **Step 4: Write failing `Regions` tests** in `test/gpu-table.test.ts` — the second frame with the same two voices reports no changed ranges; replacing the second voice's patch reports only its range.
- [ ] **Step 5: Implement `Regions`** and use it in `side.ts` in place of writing all of `values` each frame.
- [ ] **Step 6: Add `closeNear(got, cpuAt: (t: number) => number, t: number, what)`** to the harness: passes on `close(got, cpuAt(t))`, or within one f32 step of `t` either way.
- [ ] **Step 7: Run** the two unit files through `onto do --kind test`, and the whole GPU suite on teitou — expect everything that passed before to pass (this task changes no behavior).
- [ ] **Step 8: Commit** — "run gpu patches through runners, and upload each voice's values only when they change".

### Task 3: `wave` on the GPU

**Files:**
- Create: `src/gpu/runners/wave.ts`
- Modify: `src/wave.ts` (export the plan lookup the runner needs), `src/gpu/runner.ts` (register)
- Test: `test/gpu/wave.gpu.ts`

**Interfaces:**
- Consumes: `Runner`, `packOf` (Task 2).
- Produces: a runner keyed `'wave'` per written channel set; `values` = `[shape (0 sine, 1 triangle, 2 saw, 3 square), cycles, start, then (depth, rest) per channel in writes order]`. WGSL ports `waveAt` exactly (`u = x - floor(x)`).

- [ ] **Step 1: Write `test/gpu/wave.gpu.ts`** in the style of `rules.gpu.ts`: for each shape, one voice at full weight; two waves with different `cycles`/`phase`/`depth` in one frame (Review Focus); a `mul` channel resting at 1; a looped wave at t = 2.5 passes. Every subject, times 130, 470, 2600; square and saw use `closeNear`.
- [ ] **Step 2: Run** on teitou with filter `wave` — FAIL ("no gpu runner takes" reason, channel null).
- [ ] **Step 3: Implement** the runner.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — "fold wave voices on the GPU".

### Task 4: `keys` on the GPU

**Files:**
- Create: `src/gpu/runners/keys.ts`
- Read (port, don't change): `src/patch.ts` (`builtOf`, `Track`, `shift`, `locate`, `segment`), `src/lch.ts`, `src/blend-modes.ts`
- Modify: `src/gpu/runner.ts`, `src/gpu/wgsl/channels.ts` (a `lerp` for each blend-mode color rule)
- Test: `test/gpu/keys.gpu.ts`, `test/gpu-keys-pack.test.ts`, `test/gpu/color.gpu.ts`

**Interfaces:**
- Consumes: `curveData`, `CURVE_WIDTH`, `EASING_WGSL` (Task 1); `Runner`, `packOf`, `ChannelCode.lerp` (Task 2).
- Produces: a runner keyed `'keys'` plus the written channels and each one's axes. Per-voice `values`: per track, `[delay, n, then per stop: at, curve (5 numbers), value (axes numbers)]`, tracks in `writes` order, `duration` first.
- WGSL per track: `shift()` (as `src/patch.ts`), the binary search `locate` makes, `fraction`, `blits_ease`, then the channel's `ChannelCode.lerp` per axis. A phase at or before the first stop gives the first value, at or past the last gives the last, as `segment` does.
- `packOf` returns `{ why }` for: an easing `curveData` cannot pack ("its easing is a function"); a stop value that is not a number or an array of numbers of the channel's input width ("a stop holds a value the GPU cannot read"); a channel whose rule has no `lerp` WGSL ("the GPU cannot interpolate `<channel>`"); a track with its own `lerpBy` lerp that is not the channel's ("`<channel>` interpolates by its own lerp"). `from: 'current'` voices are excluded in `eligible.ts` ("it starts from the subject's current pose").

- [ ] **Step 1: Write the failing pack test** — for `keys(1000, [{at:0, delta:{v:0}}, {at:0.5, delta:{v:2}, ease:'ease-in'}, {at:1, delta:{v:1}}])` the packed values equal `[1000, 0, 3, 0, 0,0,0,0,0, 0, 0.5, 1,0.42,0,1,1, 2, 1, 0,0,0,0,0, 1]`; a stop eased by a function packs to `{ why: 'its easing is a function' }`; a string stop packs to the stop reason.
- [ ] **Step 2: Run** `npx vitest run test/gpu-keys-pack.test.ts` — FAIL.
- [ ] **Step 3: Implement packing.**
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Write `test/gpu/keys.gpu.ts`**: three stops with mixed easings on `sum`, `mul`, `max`; a `vec(3, sum())` track; an `angle()` track crossing 0; `delayBy` on one channel; `steps` easing (`closeNear`); two keys patches with different stops in one frame (Review Focus); a role of two keys voices; past the end without loop; looped at 2.3 passes. Every subject, times 0, 130, 499, 500, 501, 870, 2300.
- [ ] **Step 6: Run** on teitou with filter `keys` — FAIL, then **implement the WGSL**, then PASS.
- [ ] **Step 7: Port each blend-mode color rule's `lerp`** (OKLab, hue the short way, `src/lch.ts`) into its `ChannelCode.lerp`; add to `test/gpu/color.gpu.ts` a keys voice on a blend-mode color channel crossing hue 0 and one through gray, and a role of two color voices. Run on teitou with filter `color` — PASS. The spec decided stops lerp in the channel's own space; until this step lands those channels keep `keys` on the CPU with the lerp reason.
- [ ] **Step 8: Commit** — "fold keys voices on the GPU, color stops interpolated as their channel does".

### Task 5: Tables for shader patches

**Files:**
- Modify: `src/gpu/shader-patch.ts`, `src/gpu/runner.ts`
- Test: `test/gpu-patch.test.ts`, `test/gpu/tables.gpu.ts`

**Interfaces:**
- `ShaderSpec` gains `tables?: { [name: string]: { width: number; height: number } }`. `with(values)` takes each table's contents as `values[name]: ArrayLike<number>` of `width * height` (row-major, row `y` at `y * width`); a missing or wrong-length table throws `blits: with() needs <width × height> numbers for the table <name>`.
- WGSL: `table_<name>(x: i32, y: i32) -> f32`, 0 where `x` or `y` is outside `[0, width)`/`[0, height)`. JS: `at`'s `params` argument carries `params.<name>(x, y)` with the same rule (integer coordinates; `Math.floor` applied to non-integers on both sides).
- Contents go in the voice's `values` region after its scalar parameters, so `Regions` (Task 2) uploads them once and again only when `with` gives new ones.

- [ ] **Step 1: Write failing unit tests** — `with` rejects a 6-number table declared 2 × 4; `at` reads `params.bitmap(1, 0)` as the second number and `params.bitmap(-1, 0)`, `params.bitmap(2, 0)`, `params.bitmap(0, 4)` as 0.
- [ ] **Step 2: Run** `npx vitest run test/gpu-patch.test.ts` — FAIL; **implement**; PASS.
- [ ] **Step 3: Write `test/gpu/tables.gpu.ts`** — bree's shape: a 40 × 7 bitmap and a width-1 row map (−1 for gaps, stored as given); a patch writing `v = table_bitmap(i32(subject.x) - i32(phase * 40.0), table_rows(0, i32(subject.y)) )`-style lookups at a shifted position; out-of-range reads; two voices with different tables in one frame; a voice given new contents through `with` mid-play reads them the next frame without the kernel recompiling (count `createComputePipelineAsync` calls through a wrapped device) — Review Focus.
- [ ] **Step 4: Run** on teitou with filter `tables` — PASS after implementing the WGSL accessor.
- [ ] **Step 5: Commit** — "let a shader patch read per-voice tables".

### Task 6: Motions on the GPU

**Files:**
- Create: `src/gpu/runners/motion.ts`, `src/gpu/mirror.ts`, `src/gpu/wgsl/closed.ts`
- Modify: `src/motions.ts` (a changed-subject hook), `src/gpu/side.ts`, `src/gpu/runner.ts`
- Test: `test/gpu-mirror.test.ts`, `test/gpu/motion.gpu.ts`

**Interfaces:**
- `Motions` gains `watch(listener: ((slot: number) => void) | null): void`, called with a subject's slot whenever its run changes (commit of a change, `set`, `to`, `push`). With no listener attached the CPU path pays one null check.
- `src/gpu/mirror.ts`: `class Mirror` per motion voice — holds the run region for the registered subjects in registration order (GPU subject `i` ↔ the slot `Motions` gives it), marks rows dirty from `watch`, and before each dispatch: (1) commits every registered subject's pending change due by the voice's time this frame, as a live `sample` would (`src/changes.ts`), keeping changes timed ahead on a due list; (2) writes dirty rows, coalesced into ranges. Times are written relative to the frame's `now`. Rebuilt in full when `subjects()` is called again.
- `src/gpu/wgsl/closed.ts`: WGSL of `closed()` in `src/closed.ts` for every law (`UNDER`, `CRITICAL`, `OVER`, `COAST`, `EASED` via `blits_ease`, `BOUND`), each pinned by `test/gpu/motion.gpu.ts`.
- Runner keyed `'motion:<law form>:<axes>'`; per-voice `values` = the law's numbers; per-subject = the run (`stride` numbers per subject, f32).
- Motion voices read back through `reading.back` (history) stay on the CPU: excluded in `eligible.ts` while the mix is reading back.

- [ ] **Step 1: Write failing mirror tests** — after `to()` on 3 of 1,000 subjects, the mirror reports exactly those 3 rows dirty; after `subjects()` reorders the list, row 0 holds the run of the subject now first (Review Focus); an untimed `to()` with no probe is committed by the mirror at the voice's time; a `to(s, x, at)` timed 500 ms ahead stays pending until the frame reaching it.
- [ ] **Step 2: Run** `npx vitest run test/gpu-mirror.test.ts` — FAIL; **implement** `watch` and `Mirror`; PASS.
- [ ] **Step 3: Write `test/gpu/motion.gpu.ts`** — springs under-, critically and over-damped; a tween with `ease-in-out` and one with `steps` (`closeNear`); a glide with and without bounds, released past an edge; 1,000 subjects each retargeted at a different time; a `.to()` in the frame being read with no CPU probe (Review Focus); scalar and `vec(2)` motions. Compare every subject at five times.
- [ ] **Step 4: Run** on teitou with filter `motion` — FAIL; **implement** the runner and WGSL laws; PASS.
- [ ] **Step 5: Commit** — "fold tween, spring and glide voices on the GPU".

### Task 7: Measure, demos and docs

**Files:**
- Create: `bench/gpu-stock.mjs`, `bench/runs/2026-11-0x-gpu-stock.txt` (the run's raw records beside it)
- Modify: `site/src/live/examples/*.ts` that use `shaderPatch` where a stock patch says the same thing; `site/src/pages/engine.mdx`; `docs/schema.html` (gpu section); `CHANGELOG.md`; `HANDOFF.md`; the spec's status line
- Test: the site's demos under `?panel`, headless

- [ ] **Step 1: Write `bench/gpu-stock.mjs`** — in headless Chromium on teitou (reuse `test/gpu/run.mjs`'s server), the same mix (`keys` × 3, `wave` × 1, `spring` × 1 retargeting 5% of subjects a frame) on `mixer` (reading every subject with `pull`) and on `gpu` (dispatch plus `onSubmittedWorkDone`), at 10k, 100k and 1M subjects; one line per row as it finishes; every frame's time written to the records file.
- [ ] **Step 2: Run** on teitou (`onto do --kind bench --node teitou`); record medians and p95 in the runs file.
- [ ] **Step 3: Move the demos** whose shader patch is a wave or keyframes to the stock patch, keeping `shaderPatch` where it computes something no stock patch does; open each with `?panel` and confirm its mixes list and pause/seek move the picture.
- [ ] **Step 4: Update docs** — engine page and schema page: what runs on the GPU now, what stays on the CPU and why, tables, the f32-near-a-branch rule. Spec status line: phase 1 built. Handoff: phases 2–4 still to build, pointing at the spec.
- [ ] **Step 5: Commit** — "measure the gpu engine's stock patches, and move the gpu demos onto them".
