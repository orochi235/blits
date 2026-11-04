# GPU Readback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-04): planned, not built.**

**Goal:** `gpuOf(m).read(channel)` resolves with a channel's folded values for the registered
subjects, in registration order, from the previous frame, without ever holding up the frame being
folded. `pull` and `probe` keep running on the CPU, unchanged.

**Architecture:** A new `src/gpu/readback.ts` owns a ring of `MAP_READ` staging buffers. Each fold
is recorded as the side's last fold. When a new frame (`mix.frame`) first refreshes the side, and
before anything new is written, the last fold's channels that were read since the previous copy
are copied out of `out` into a free slot, in a submission of their own, and mapped. When a map
settles, each channel's bytes are copied into a fresh `Float32Array` and the slot is unmapped and
freed. `read` resolves with that copy. Because the copy is submitted before the new frame's fold,
its map never waits on that fold. `side.ts` (300 lines) first gives up its mirror and slot
preparation to `src/gpu/prepare.ts`, as HANDOFF item 18 asks, so it can take `read` without growing.

**Tech Stack:** TypeScript, WebGPU (the slice declared in `src/gpu/webgpu.ts`), vitest, headless
Chromium WebGPU tests on teitou (`test/gpu/*.gpu.ts`), `onto` for fleet jobs, `bench/` with
Playwright through `bench/gpu-harness.mjs`.

**Spec:** `docs/superpowers/specs/2026-11-03-gpu-reach-design.md`, section "4. Readback", bound by
"Decided", especially "Readback is a separate read, not a change to `pull`".

## Decisions

Each question the spec leaves open is decided here once. `read`'s doc comment says the same, in
the user's words.

| Question | Decision |
|---|---|
| The channel isn't on the GPU | `read` resolves `null` exactly where `channel(name)` gives null at the call: no subjects registered, a voice writing it can't fold, the kernel is compiling, too many roles, closed, or device lost. It never rejects (the null case comes up every frame while a kernel compiles) and never falls back to the CPU's values, which would mean probing every subject, with probe's side effects. |
| "Previous frame" | Frames are counted by `mix.frame`, the key the side already refolds on: a sync, a seek, and a control change, drop or touch each start one. `read` gives the newest fold made under an earlier `mix.frame`. Several folds in one frame (a cue, a `level.set()`, a retarget between syncs): the frame's last fold, since the copy is taken from `out` once the next frame begins. No sync since the last read: the same `GpuRead` object again. A control change made after a sync starts a frame, so a read after it gives the fold from before the change. |
| Which channels are copied | Only those read since the previous copy. A host reading each frame keeps its channels copied. One that stops reading pays for one more copy, then nothing. |
| A first read with nothing earlier to give | That covers a channel's first read made after this frame's fold already ran, a channel new to the GPU, the side's very first fold, and a read after `subjects()`. The current fold is copied right away, for that channel alone, and the read waits on it. This is the one case where a read waits on the fold being made. |
| The ring | `SLOTS = 3` staging buffers, made as needed: two in the steady state (one mapping, one being copied into), a third when the GPU is a frame behind. With all three busy, the frame's copy is skipped and `read` keeps resolving the newest copy it has. That copy is older, and its `timestamp` says so. The frame is never blocked and the ring never grows past three. A first read finding all three busy gets a staging buffer of its own, destroyed once its map settles. A free slot too small for a copy is destroyed and made again at the new size. |
| Layout | `values` holds `subjects.length × axes` numbers: subject `i`'s axis `a` sits at `i * axes + a`. That is how the kernel writes `out`, a `GpuChannel` with `stride === axes * 4`. Each read is one channel's own array. |
| Which frame a read belongs to | `GpuRead` carries the fold's `now` (mix time) and `timestamp` (the host's timestamp at that frame's sync), both public on `Mix`. It does not carry `mix.frame`, which isn't public. |
| After `close()` | Reads waiting on a copy resolve `null`. Every staging buffer is destroyed, and every later `read` resolves `null`. |
| After device loss | Reads waiting on a copy resolve `null`, however their map settles: rejected, or resolved with zeros on a lost device. Nothing is destroyed, as the loss path already leaves `out` alone, and every later `read` resolves `null`. |
| `subjects()` between the fold and the resolve | A read already waiting resolves with the copy it waited for, labeled with that fold's list (`GpuRead.subjects`, the side's own copy at fold time). `subjects()` throws away the last fold and the frame's copies, so no later read returns values laid out for an old list. The next read is a first read under the new list. |
| Values the host holds | Each settled copy is a fresh `Float32Array` that blits never writes again. Reads of the same copy share it. |

## Spec conflicts

1. **"Double-buffered" against a ring of three.** The spec says double-buffered. With only two
   slots, a GPU one frame behind leaves no free slot, and the frame has to skip its copy every time
   it falls behind. **Resolution:** two slots in the steady state, a third made only when both are
   busy, then skip, never wait. Behavior is still double-buffered whenever the GPU keeps up.
2. **"From the previous frame" against blits' frame count.** `mix.frame` moves on a control
   change as well as on a sync, so "previous" isn't always the previous sync. **Resolution:**
   follow `mix.frame`, the one pathway the side already refolds on, and give each read `now` and
   `timestamp` so a host can tell which sync it came from.
3. **"Never waits on the frame being folded" against a first read.** With no earlier fold holding
   the channel, there is nothing earlier to give. **Resolution:** a first read waits on the current
   fold (table above). Every read after that, in a host reading each frame, takes the previous
   frame.
4. **"In registration order" across a `subjects()` call.** **Resolution:** a read in flight keeps
   the order its fold used, and says so in `GpuRead.subjects`.

Found while planning, not a spec conflict: HANDOFF item 18 still says phase 3 is "on branch
`gpu-owners`, not yet merged". It is on `main` (`81624fe` is an ancestor). Task 5 corrects it.

## Global Constraints

- The TS stays the definition: readback copies bytes the kernel wrote and computes nothing. No
  WGSL changes.
- Nothing new is reachable from `@msb235/blits` or `@msb235/blits/lean`. `GpuRead` is exported as a
  type from `src/gpu.ts` only.
- Core files (`mixer.ts`, `voice.ts`, …) cost at most a null check with no gpu engine attached, and
  change no CPU-observable state. This plan needs no core change. `read` refreshes through the same
  path `channel()` does and adds no new effect on records, met subjects, watch, trace or
  `lastPoses`.
- Every way an input to the fold changes still refolds, through `read` alone as through `channel()`:
  `mix.frame`, `mix.stirs`, `reading.inputs`, `mirrors.stirred`. A test covers each one (Task 3).
- Release everything new on `close()` (the staging buffers are destroyed and waiting reads resolve
  `null`) and on device loss (waiting reads resolve `null`, nothing is destroyed), each with a test.
- Source files stay a few hundred lines. `side.ts` splits (Task 1) before `read` is added.
- u32 data in a float buffer goes through a `Uint32Array` view of the same buffer, never as a
  float. Readback copies only f32 channels. Anything u32 added to a staging buffer (a stamp, say)
  follows this rule.
- Tests fail before the change they cover (Task 1 is a pure move and adds none). Agreement tests
  compare against a CPU twin probed every frame, and assert the channel IS on the GPU at each
  compared frame.
- Commits: imperative subject in the repo's register (see `git log`), body only where it adds
  something, trailer `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that
  wrote the commit. `CHANGELOG.md` (`## Unreleased`) only for what a blits user can see.
- Machine rules: one unit test file locally (`npx vitest run <file>`). More files, `tsc`, lint,
  builds:
  `onto do --kind <test|typecheck|lint|build> -task <unique> -expect <dur> -about "<one sentence>" -in blits-gpu-readback -- <cmd>`.
  WebGPU runs only on teitou:
  `onto do --kind test --node teitou -task <unique> -expect 8m -about "<sentence>" -in blits-gpu-readback -- npm run test:gpu <filter>`.
  Never `git stash`, never push.
- Bench: state the wall-time estimate before launching, print one progress line per row, and write
  every frame's time, its parts and the run's conditions under `bench/runs/` as each row finishes.

## Review Focus

1. **A host that awaits `read` before its next `sync`, every frame.** Expect no stall: each read
   resolves once its copy has mapped, and its `timestamp` is the previous sync's. Test: Task 4,
   `'an await-read-then-sync loop'`.
2. **A kernel change that grows `out` in the frame right after a copy was submitted** (a new channel
   folds, or more subjects). Expect the copy to read the old `out` intact, no validation error, and
   later reads under the new layout. Test: Task 4, `'a kernel change that grows out'`.
3. **A host that reads some frames and not others, or calls `channel()` before `read()` in a
   frame.** Expect the previous frame's fold wherever it read the frame before, and the current
   fold otherwise. Never a copy from before a gap. Test: Task 3, `'reads now and then'`.
4. **`close()` or device loss while a read is waiting.** Expect `null`, with no throw and no
   unhandled rejection. Test: Task 2 (both map outcomes) and Task 4 (a real `device.destroy()`).
5. **A `GpuRead` held by the host across later frames.** Expect its values unchanged, since the
   ring reuses staging buffers, never the arrays it handed out. Test: Task 2, `'a held read keeps
   its values'`.

---

## File map

| File | Change | Owns |
|---|---|---|
| `src/gpu/prepare.ts` | create | the mirror, timing, read and slot preparation of a fold, moved out of `side.ts` |
| `src/gpu/side.ts` | modify | `refresh()` shared by `channel` and `read`; `read`; wiring readback into `subjects`, `close` and loss |
| `src/gpu/readback.ts` | create | `Readback<I>`, `GpuRead<I>`, `Fold<I>`, `SLOTS` |
| `src/gpu.ts` | modify | `export type { GpuRead }` |
| `src/gpu/engine.ts` | modify | `gpu()`'s doc names `read` |
| `test/gpu-device.ts` | create | a fake device with byte-backed buffers, copies run at submit, maps the test settles |
| `test/gpu-readback-ring.test.ts`, `test/gpu-readback.test.ts` | create | unit tests |
| `test/gpu/readback.gpu.ts` | create | agreement tests on teitou |
| `bench/gpu-readback.mjs` | create | the readback bench |

---

### Task 1: Move a fold's preparation out of `side.ts`

A pure move: no behavior changes and no new test. The existing gpu unit files and the gpu suite are
the check.

**Files:**
- Create: `src/gpu/prepare.ts`
- Modify: `src/gpu/side.ts` (`dispatch`, from `const mirrors` through `voiceTable(...)`; `channel`)

**Interfaces:**
- Produces:
  ```ts
  export interface Preparing<I> {
    readonly mix: Mixer<I, unknown>;
    readonly voices: readonly Voice<I, unknown>[];
    readonly runners: readonly Runner[];
    readonly index: ReadonlyMap<string, number>;
    readonly codes: ChannelLookup;
    readonly list: readonly I[];
    readonly answers: Answers<I>;
    readonly mirrors: Mirrors;
    readonly timings: Timings;
    readonly reads: Reads<I>;
    readonly regions: Regions;
    readonly limit: number;
  }
  /** The frame's table and placement, or 'unfit' where a mirror's stride disagreed and was unpacked. */
  export function prepare<I>(p: Preparing<I>): { table: Table; placed: Placement } | 'unfit';
  ```
  - `GpuSide.refresh(): void` (private): the trigger check now in `channel()` (`mix.frame`,
    `mix.stirs`, `reading.inputs`, `mirrors.stirred`), which resets `outputs` and dispatches.
    `channel(name)` becomes `refresh()` then the lookup.

- [ ] **Step 1: Move the code.** `dispatch` calls `prepare`, re-dispatches on `'unfit'`, and keeps
  the role-limit check, `met.mark`, `submit` and the twin check. `side.ts` ends under 230 lines.
- [ ] **Step 2: Verify on the fleet.**
  `onto do --kind test -task readback-t1-unit -expect 2m -about "gpu unit files after moving fold preparation out of side.ts" -in blits-gpu-readback -- npx vitest run test/gpu-`
  and `--kind typecheck ... -- npx tsc --noEmit` both pass. Then
  `onto do --kind test --node teitou -task readback-t1-gpu -expect 8m -about "the whole gpu agreement suite after the move" -in blits-gpu-readback -- npm run test:gpu`
  prints `all passed`.
- [ ] **Step 3: Commit**
  ```bash
  git add src/gpu/prepare.ts src/gpu/side.ts
  git commit -m "move a gpu fold's mirror and slot preparation out of side.ts"
  ```

---

### Task 2: `Readback`, the ring of staging buffers

**Files:**
- Create: `src/gpu/readback.ts`, `test/gpu-device.ts`
- Test: `test/gpu-readback-ring.test.ts` (create)

**Interfaces:**
- Consumes: `GpuChannel` (`side.ts`); `GpuBuffer`, `GpuDevice`, `Usage`, `MAP_READ` (`webgpu.ts`).
- Produces (`src/gpu/readback.ts`):
  ```ts
  /** @category gpu */
  export interface GpuRead<I> {
    /** subjects.length × axes numbers; subject i's axis a at i * axes + a. Never written again. */
    readonly values: Float32Array;
    readonly axes: number;
    /** The mix time of the fold these came from. */
    readonly now: number;
    /** The host's timestamp at that frame's sync. */
    readonly timestamp: number;
    /** The registered subjects the fold used, in its order. */
    readonly subjects: readonly I[];
  }
  /** A fold the side made: where its channels sit, and when it was made. */
  export interface Fold<I> {
    readonly out: GpuBuffer;
    readonly outputs: ReadonlyMap<string, GpuChannel>;
    readonly frame: number;   // mix.frame
    readonly now: number;
    readonly timestamp: number;
    readonly list: readonly I[];
  }
  export const SLOTS = 3;
  export class Readback<I> {
    constructor(device: GpuDevice);
    /** Marks `name` read since the last copy, so the next turn copies it. */
    want(name: string): void;
    /** Records the side's newest fold. */
    fold(f: Fold<I>): void;
    /** At a frame's first refresh, before anything is written: copies the last fold's wanted channels, if it is another frame's and not yet copied. Clears `want`. */
    turn(frame: number): void;
    /** The newest copy of `name` from a fold before `frame`; else the current fold, copied now. */
    read(name: string, frame: number): Promise<GpuRead<I> | null>;
    /** Forgets the last fold and the frame's copies (subjects() was called). */
    forget(): void;
    /** Resolves waiting reads with null and answers null from now on; destroys the staging buffers where `destroy`. */
    close(destroy: boolean): void;
  }
  ```
- Produces (`test/gpu-device.ts`): `fakeDevice(opts?: { compile?: 'held' }): { device: GpuDevice; log: string[]; fill(buffer: GpuBuffer, f: (data: Float32Array) => void): void; onDispatch(f: (out: Float32Array, serial: number) => void): void; compiled(): void; settle(): Promise<void>; refuse(): void; lose(): void; made(label: string): number; destroyed: string[] }`.
  `compile: 'held'` keeps every `createComputePipelineAsync` pending until `compiled()`.
  `onDispatch` runs at each submitted dispatch on the buffer labeled `blits gpu out`.
  Buffers are backed by `ArrayBuffer`s. `writeBuffer` copies bytes. `submit` runs the recorded
  `copyBufferToBuffer` calls in order and logs `copy <src>-><dst> <srcOffset>+<size>`, `dispatch`
  and `submit`. `mapAsync` logs `map <label>` and stays pending until `settle()` resolves every
  pending map in order (`refuse()` rejects them instead). Destroying a buffer with a map pending
  rejects that map. `getMappedRange` throws unless mapped. Labels drop the `blits gpu ` prefix.

- [ ] **Step 1: Write the failing tests** (`describe('gpu readback ring')`). Each fold is
  hand-made: an `out` buffer from the fake device with `fill`ed contents, `outputs` for `s`
  (axes 1, offset 0) and `p` (axes 3, offset `n * 4`), `n = 4`, `list = ['a','b','c','d']`.
  - `'copies the wanted channels of the last fold into one staging buffer, then maps it'`:
    `want('s')`, `fold(f1 at frame 1)`, `turn(2)`. The log shows one `copy out->readback 0+16`, then
    `submit`, then `map readback`. After `settle()`, `read('s', 2)` gives `values` equal to `out`'s
    first 4 floats, `axes` 1, and `now`, `timestamp`, `subjects` from `f1`.
  - `'copies nothing when nothing was read, the fold is this frame's, or it was copied already'`:
    `turn(2)` with no `want` logs no copy. `turn(1)` after `fold(f1 at 1)` logs none. A second
    `turn(2)` after one that copied logs none.
  - `'lays a multi-axis channel out subject by subject'`: `out` filled with `j` at index `j`. After
    `want('p')`, `turn`, `settle`, `read('p')` gives `[4, 5, …, 15]` with `axes` 3.
  - `'gives the same read to every call in a frame'`: two `read('s', 2)` resolve to the same object
    (`toBe`).
  - `'copies the current fold for a channel the turn did not copy'`: with `fold(f2 at 2)` and no
    turn, `read('s', 2)` logs `copy out->readback 0+16` from `f2.out`. It resolves after `settle()`
    with `f2.timestamp`. A second `read('s', 2)` logs no new copy.
  - `'holds three staging buffers at most, and skips a frame rather than wait'`: maps never
    settled. Frames 1–4 each `want('s')`, `fold`, `turn` the next. `made('readback')` is 3, and
    the fourth turn logs no copy. After `settle()`, `read('s', 5)` gives the third copy's
    `timestamp`, which is older than the fourth fold's.
  - `'a first read with every slot busy takes a staging buffer of its own'`: with three busy,
    `read('p', frame)` for an uncopied channel makes a fourth buffer. After `settle()` it resolves
    and that buffer is in `destroyed`.
  - `'reuses a free staging buffer, and remakes one only when it is too small'`: after settle, the
    next turn makes no buffer. A turn wanting `s` and `p` (64 bytes) after one wanting only `s` (16)
    destroys one `readback` and makes one.
  - `'a held read keeps its values'`: hold the frame-2 read, then run five more frames with
    different fills. The held `values` are unchanged.
  - `'forget: a waiting read keeps its own list, and the next read copies the current fold'`:
    `read` waiting on f1's copy, then `forget()`, then `fold(f2 with list ['d','c'])`. The waiting
    read resolves with `subjects` `['a','b','c','d']`. `read('s', f2.frame)` copies from `f2` and
    resolves with `['d','c']`.
  - `'close resolves waiting reads with null and destroys every staging buffer'`: `close(true)`
    while a map is pending. The read resolves `null`, every `readback` buffer is in `destroyed`, and
    `read` afterward resolves `null` with no copy logged.
  - `'device loss resolves waiting reads with null and destroys nothing'`: `close(false)`, once with
    `refuse()` and once with `settle()` (a lost device's map may resolve). Both give `null`,
    `destroyed` is empty, and no unhandled rejection happens (vitest fails on one).

- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run test/gpu-readback-ring.test.ts`. Expected: FAIL, `src/gpu/readback.ts`
  does not exist.

- [ ] **Step 3: Implement `Readback<I>`.** A copy is one command encoder with one
  `copyBufferToBuffer` per channel, packed back to back in the slot (each `n * axes * 4` bytes; a
  channel whose `stride !== axes * 4` throws, since the kernel never makes one). The encoder gets
  its own `queue.submit`, then `mapAsync(MAP_READ)`. The map's settlement, resolved or rejected,
  builds a `Map<string, GpuRead<I>>` from `getMappedRange().slice(at, at + bytes)` per channel,
  unmaps and frees the slot. After `close` it resolves `null` and does neither. Staging buffers
  are labeled `blits gpu readback`, with usage `MAP_READ | COPY_DST`. `turn`'s copy becomes the
  frame's copy only when a slot was free. A skipped turn leaves the previous one in place.

- [ ] **Step 4: Run to verify they pass**
  Run: `npx vitest run test/gpu-readback-ring.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**
  ```bash
  git add src/gpu/readback.ts test/gpu-device.ts test/gpu-readback-ring.test.ts
  git commit -m "copy a gpu fold's read channels into a ring of three mapped staging buffers"
  ```

---

### Task 3: `gpuOf(m).read(channel)`

**Files:**
- Modify: `src/gpu/side.ts`, `src/gpu.ts`, `src/gpu/engine.ts`, `CHANGELOG.md`
- Test: `test/gpu-readback.test.ts` (create)

**Interfaces:**
- Consumes: `Readback`, `Fold`, `GpuRead` (Task 2); `refresh()` (Task 1); `fakeDevice` (Task 2).
- Produces:
  - `GpuSide.read(name: string): Promise<GpuRead<I> | null>`: `want(name)`, `refresh()`, then
    `null` where `outputs` lacks `name`, else `readback.read(name, mix.frame)`. Its doc comment
    states the Decisions table in a host's terms.
  - `refresh()` calls `readback.turn(mix.frame)` before `dispatch()`. `dispatch` calls
    `readback.fold({ out, outputs, frame: mix.frame, now: mix.now, timestamp: mix.timestamp, list })`
    after `submit`. `subjects()` calls `readback.forget()`. `close()` calls `readback.close(true)`,
    and the device-lost handler calls `readback.close(false)`.
  - `src/gpu.ts`: `export type { GpuRead } from './gpu/readback.js';`

- [ ] **Step 1: Write the failing tests** (`describe('gpu read')`, through
  `mix(…, { engine: gpu({ device: fake.device }) })`, with `onDispatch` writing the dispatch's
  serial into every float so each fold is recognizable)
  - `'resolves null wherever channel() is null'`: before `subjects()`; for a channel only a `fn`
    patch writes; while the kernel compiles (the fake's pipeline held pending); after `close()`;
    after `lose()`.
  - `'a read alone folds again after each kind of change'`: with no `channel()` call anywhere, the
    dispatch count goes up on `read` after each of `m.sync(t)`, `m.cue(…)`, `level.set(…)` on a
    voice weighted by that level, and `spring.to(subject, x)`. A `read` with none of them adds no
    dispatch.
  - `'copies the previous frame's last fold before the new frame writes anything'`: in frame 1,
    read, then cue (two folds, serials 1 and 2). `m.sync`, then `read`. In the log, the
    `copy out->readback` comes before the frame's first `write table` and `dispatch`, and the read
    resolves with every value `2` and the frame-1 `timestamp`.
  - `'gives the same read again with no sync between'`: two reads in one frame, same object.
  - `'a control change starts a frame'`: after `sync(100)` and a read, `handle.rate = 2`, then
    `read`. It resolves with the fold made before the change (`now` 100, the earlier serial).
  - `'reads now and then'`: a host reading in frames 1, 2, 4. Frame 2 gives frame 1's fold. Frame 4,
    with `channel()` called in frame 3 and no read there, copies frame 4's own fold. A host calling
    `channel()` before `read()` in a frame where it read the frame before gets the previous fold.
  - `'subjects() between a fold and its read resolving'`: a read waiting on frame 1's copy, then
    `subjects(reversed)`. The waiting read resolves with the old list. The next read gets the new
    list and the current fold.
  - `'close() destroys the staging buffers; device loss destroys nothing'`: `destroyed` includes
    `readback` after `m.close()` and not after `lose()`. Reads waiting in each case resolve `null`.
- [ ] **Step 2: Run to verify they fail**
  Run: `npx vitest run test/gpu-readback.test.ts`. Expected: FAIL, `read` is not a function.
- [ ] **Step 3: Implement** the wiring above. `gpu()`'s doc in `engine.ts` adds that
  `gpuOf(m).read(name)` gives a channel's values in JS from the previous frame. `CHANGELOG.md` gets,
  under `## Unreleased` → `### Added`: "`gpuOf(m).read(channel)` resolves with a channel's values
  from the GPU for the registered subjects, from the previous frame, without waiting on the fold
  being made; `null` where the GPU does not fold that channel."
- [ ] **Step 4: Verify**
  `npx vitest run test/gpu-readback.test.ts` passes locally. On the fleet, these pass:
  `--kind test ... -- npx vitest run test/gpu-`, `--kind typecheck ... -- npx tsc --noEmit`, and
  `--kind build -task readback-t3-build ... -- sh -c 'npm run build && for e in index lean; do npx esbuild dist/$e.js --bundle --format=esm --log-level=error | grep -q "blits gpu readback" && exit 1; done; true'`.
  The last bundles each entry point and fails if either carries readback.
- [ ] **Step 5: Commit**
  ```bash
  git add src/gpu/side.ts src/gpu.ts src/gpu/engine.ts CHANGELOG.md test/gpu-readback.test.ts
  git commit -m "read a gpu channel's previous-frame values back into JS with gpuOf(m).read"
  ```

---

### Task 4: Agreement tests on teitou

**Files:**
- Create: `test/gpu/readback.gpu.ts`

**Interfaces:**
- Consumes: `read` (Task 3); `test`, `close` from `test/gpu/harness.ts`.

Mix for the first three tests: 64 subjects with a kit of `s: sum()`, `p: vec(3, sum())` and
`q: vec(2, sum())`, and these voices: a looping `keys` on `s`, a `keys` on `p` staggered by
`(c) => c.i * 9` with `fade: { in: 200 }`, and a `spring` on `q` retargeting subject `f % 64` each
frame `f`. The CPU twin is the same mix on `mixer`, probed for every subject every frame, with each
frame's probes kept.

- [ ] **Step 1: Write the tests**
  - `'readback: each read gives the previous frame's fold of every subject'`: 40 frames of 16 ms.
    Each frame syncs both mixes, asserts `channel(name) !== null` for `s`, `p` and `q`, and awaits
    `read` of each. From frame 2 on, `timestamp` is the previous frame's, and every subject's every
    axis is `close()` to the twin's previous-frame probe. In frame 1 (a first read), the values
    match the current frame's probe.
  - `'readback: an await-read-then-sync loop'`: 60 frames of `await read('s')`, then `sync`.
    Finishes within 60 × 50 ms, and every read's `timestamp` is the sync before it.
  - `'readback: a kernel change that grows out'`: read `s` and `p` in frame 1. Before frame 2's
    sync, cue a `keys` voice writing a new channel `r` (kit made with `r`). With
    `pushErrorScope('validation')` around frames 2–3: frame 2's read of `s` matches frame 1's twin,
    frame 3's matches frame 2's, and the scope pops `null`.
  - `'readback: subjects() in another order'`: after 5 frames, `subjects(reversed)`. The next read
    is laid out reversed, with `subjects` the reversed list, and matches the twin.
  - `'readback: a lost device resolves a waiting read with null'`: a device of the test's own
    (`requestAdapter` then `requestDevice`, so the shared one survives), `read` without awaiting,
    then `device.destroy()`. The read resolves `null`, a later `read` resolves `null`, and nothing
    is thrown.
  - `'readback: close() while a read waits'`: as above with `m.close()`. Expect `null`.
- [ ] **Step 2: Verify they fail on the commit before Task 3.** Check out `HEAD~1` into a scratch
  worktree, copy the test file in, and run
  `onto do --kind test --node teitou -task readback-t4-before -expect 4m -about "readback agreement tests against the tree without read" -in blits-gpu-readback-before -- npm run test:gpu readback`.
  Expected: FAIL (`read` is not a function). Remove the scratch worktree afterward.
- [ ] **Step 3: Run on this branch**
  `onto do --kind test --node teitou -task readback-t4 -expect 6m -about "readback agreement tests" -in blits-gpu-readback -- npm run test:gpu readback`.
  Expected: `all passed`. Then run the whole suite (`npm run test:gpu`, `-expect 8m`). Expected:
  `all passed`.
- [ ] **Step 4: Commit**
  ```bash
  git add test/gpu/readback.gpu.ts
  git commit -m "check gpu readback against a CPU twin probed every frame, on WebGPU"
  ```

---

### Task 5: Measure readback, document it, and retire the spec and this plan

**Files:**
- Create: `bench/gpu-readback.mjs`, `bench/runs/<date>-gpu-readback.{jsonl,txt}`
- Modify: `docs/schema.html` (`#gpu`), `site/src/pages/engine.mdx`, `HANDOFF.md` (item 18),
  `CHANGELOG.md` if Task 3's line needs the measured cost
- Delete: `docs/superpowers/specs/2026-11-03-gpu-reach-design.md` (if all four phases are built),
  `docs/superpowers/plans/2026-11-04-gpu-readback.md`

**Interfaces:**
- Consumes: `run`, `digest`, `digested` from `bench/gpu-harness.mjs`.
- Produces: `bench/gpu-readback.mjs`, `MIX=readback`. The kit is `x: sum()`, `y: sum()`,
  `p: vec(3, sum())` and `q: vec(3, sum())`, 8 floats per subject, matching the spike's 100k × 8.
  Voices, all looping over every subject and cued before frame 1: `keys` on `x` and `y`, a `wave` on
  `p` and a `keys` on `q`. Rows:
  - `mixer:N`: `sync`, then a `pull` of every channel.
  - `gpu:N`: `sync`, `channel()` of each, then `onSubmittedWorkDone`.
  - `gpuread:N`: `sync`, then `await Promise.all` of `read()` for each channel, then
    `onSubmittedWorkDone`.

  Parts per frame: `sync`, `fold` (the calls up to their return), `read` (awaiting the reads),
  `wait`, and `behind`, the frames between each read's `timestamp` and this frame's sync, whose
  median should be 1. The page throws if any read or channel is `null`.

- [ ] **Step 1: Write the bench, and check it on teitou** with
  `ROWS=gpu:10000,gpuread:10000 FRAMES=20 WARM=5` (`--kind bench`, `-expect 2m`). Expected: two
  progress lines, two records.
- [ ] **Step 2: Estimate, then measure.** Rows
  `gpu:100000,gpuread:100000,mixer:100000,gpu:1000000,gpuread:1000000,mixer:1000000`, with
  `FRAMES=300 WARM=30`. From `2026-11-03-gpu-stock.txt` (mixer 1M about 300 ms a frame), the mixer
  1M row takes about 100 s and mixer 100k about 10 s. The four gpu rows take under 20 s each: the
  spike's 0.23 ms per 100k × 8 copy, plus Chromium's IPC and a 32 MB JS copy a frame at 1M, keep a
  frame well under 60 ms. About 3–4 minutes in all. Say so in chat before launching:
  `onto do --kind bench --node teitou --solo -task gpu-readback -expect 6m -about "readback cost against folding without it and against pull, at 100k and 1M" -in blits-gpu-readback -- env MIX=readback ROWS=... FRAMES=300 WARM=30 node bench/gpu-readback.mjs --out bench/runs/<date>-gpu-readback`.
  Collect the `.jsonl`, run `--digest`, and write `<date>-gpu-readback.txt` with the machine, the
  command, the mix, the progress lines and the digest, as `2026-11-04-gpu-owned.txt` does.
- [ ] **Step 3: Document**, each piece in its surrounding register (read it first):
  - `docs/schema.html` `#gpu`: replace **Not built yet** with **Reading values back**: what `read`
    resolves and when, as the Decisions table in prose. Move the spec's decision ("a separate read,
    not a change to `pull`", 2026-11-03) in with its reason, and add the date of this plan's calls
    (2026-11-04). Add **What a read costs**, from `<date>-gpu-readback.txt`: `gpuread` against
    `gpu` and `mixer` at 100k and 1M, and the median `behind`.
  - `site/src/pages/engine.mdx`: one sentence and a line in the code sample
    (`const r = await gpuOf(m).read('glow'); // r.values, r.axes, r.timestamp — or null`) after the
    `channel` example, and a readback row in the measured table with its source file.
  - The spec: if phases 1–3 are on `main` and phase 4 is now built, check each **Decided** bullet,
    each Constraint and each "Left to the builder" answer against the schema page's `#gpu`. Move
    anything durable that isn't there, with its date: the f32 rule, color stops lerping in the
    channel's space, the fade-in origin coming from the CPU, and motion changes committed by the
    upload are the ones to check first. Then delete the spec, as its opening says. Remove the
    references to it from `docs/schema.html`, `HANDOFF.md` and `site/` (`grep -rn gpu-reach-design`).
    Otherwise, set its status line to "phase 4 built (<first>..<last> and the commit measuring it)".
  - `HANDOFF.md` item 18: phase 4 is built, and phase 3 is on `main` (correcting "not yet merged").
    With every phase built, remove item 18. Move its "Open from phase 1/2/3" lists, plus anything
    this phase leaves open (each one line, for instance: readback copies only after a frame's first
    refresh, so a host that stops calling `channel`/`read` never gets its last frame copied), into
    a fresh item at the end, **What the gpu engine's reach left open**, which points at the
    schema page's `#gpu`.
  - Delete this plan file in the same commit if every task is done. Otherwise, rewrite it down to
    what is left.
- [ ] **Step 4: Verify** on the fleet: `tsc` (`--kind typecheck`), lint (`--kind lint`), the site
  build (`--kind build`), and the unit suite (`onto test`). Expected: all pass.
  `grep -rn gpu-reach-design` finds nothing outside git history if the spec was deleted.
- [ ] **Step 5: Commit**
  ```bash
  git add bench/gpu-readback.mjs bench/runs/<date>-gpu-readback.* docs/schema.html site/src/pages/engine.mdx HANDOFF.md CHANGELOG.md
  git rm docs/superpowers/specs/2026-11-03-gpu-reach-design.md docs/superpowers/plans/2026-11-04-gpu-readback.md
  git commit -m "measure the gpu engine's readback in Chromium at 100k and 1M, and record its reach as built"
  ```
  (Body: the `gpuread`, `gpu` and `mixer` medians at 100k and 1M, and the median `behind`.)
