# GPU Per-Subject Timing and Reach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-04): planned, not built.**

**Goal:** A voice that staggers its subjects, or reaches only some of the registered ones
(`subjects` naming fewer than registered, or `target`), folds on the GPU for every runner kind phase 1
supports (`shaderPatch`, `wave`, `keys`, `tween`/`spring`/`glide`), agreeing with `mixer` subject by
subject.

**Architecture:** The gpu side asks `stagger` and `target` once per registered subject per voice into
a side table (`Answers`), which the CPU's `held()` also reads through a one-field hook on `Voice`. Each
such voice gets a timing block in the `persub` buffer, after the motion mirrors: its delays, a reach
bit mask, and (for a staggered voice that fades in) each subject's fade-in origin worked out on the
CPU with `sinceOf`/`shownOf`. The table row grows from 8 to 20 numbers and carries the voice's shared
clock relative to the start of the pass it is in; the kernel subtracts each subject's delay and runs
`before`/`shownAt`/`phaseAt`/`passAt`/`phaseBefore` and the fade in per subject, through WGSL ports
in `src/gpu/wgsl/timing.ts`. A role's leader becomes per subject, decided in the kernel's first pass.

**Tech Stack:** TypeScript, WGSL (WebGPU compute), vitest, headless Chromium WebGPU tests on teitou
(`test/gpu/*.gpu.ts`), `onto` for fleet jobs.

**Spec:** `docs/superpowers/specs/2026-11-03-gpu-reach-design.md`, section "2. Per-subject timing and
reach", bound by its "Decided" section.

## Spec conflicts

1. **"A finite loop that waits for its last-staggered subject is already decided by the CPU, which
   knows every delay once subjects are met; the row carries the result."** With the side table, a
   host that reads only GPU buffers never meets its subjects, so a voice with an unnamed `stagger`
   keeps `voice.latest` at 0 and goes `done` (or `frozen`) at its span while its later subjects
   still play. **Ruling (controller, 2026-11-04):** the gpu side does not raise `voice.latest` or
   reschedule anything. A voice with an unnamed `stagger` (its delays asked as subjects are met)
   and a finite span stays on the CPU, with the reason "its stagger is asked as subjects are met,
   so when it ends depends on which were read". A looping-forever one runs on the GPU, since its
   end never depends on its delays. This keeps the rule that the gpu side changes nothing the CPU
   observes.
2. **Fade-in stalls.** The spec has the CPU upload one fade-in origin per subject, but `fadeInAt`
   also subtracts `voice.stalls` (fade outs that were turned back), which depend on each subject's
   origin. **Resolution:** a staggered voice that fades in and has `stalls` stays on the CPU, with a
   reason. Rare: it takes a fade out turned back while subjects were still fading in.
3. **Fade easing.** Phase 1 computes the fade on the CPU, so any `fade.ease` works. A per-subject
   fade in runs on the GPU, which cannot run a function easing. **Resolution:** a staggered voice
   that fades in with a function `ease` stays on the CPU, with a reason.

Found while planning, not a spec conflict: **phase 1 folds a `target` voice into every registered
subject.** `why()` in `src/gpu/eligible.ts` checks `named` coverage but never `spec.target`. Task 7
fixes it and pins it with a test.

## Global Constraints

- The TS functions stay the definition; every WGSL port is pinned to its TS original by a WebGPU
  agreement test in `test/gpu/` (`agree`-style: every subject, several times, fades, roles, loops,
  past the end, seeks and rate changes where timing is involved). Tolerance: `close()` in
  `test/gpu/harness.ts`; `closeNear()` only for samples near a branch.
- Every time the GPU reads is relative to the frame's `now` or a voice anchor, never an absolute mix
  time (f32 loses whole ms after about 4.6 hours).
- A voice whose data changed must not recompile the kernel; only a new runner kind or channel set
  may. Offsets in the table are u32 bit patterns.
- Nothing new is reachable from `@msb235/blits` or `@msb235/blits/lean`; changes to core files must
  cost the CPU path nothing measurable when no gpu engine is attached (a null check at most), and
  must not change CPU-observable state (what counts as met, `read()`, watch, `knows`).
- Source files stay a few hundred lines; split by responsibility.
- A voice that cannot run on the GPU stays on the CPU with one sentence in
  `eligibility().reasons`.
- Commits: imperative subject in the repo's register, a
  `Co-Authored-By: Claude <model> <noreply@anthropic.com>` trailer naming the model that wrote it.
  CHANGELOG lines (under `## Unreleased` → `### Added`/`### Fixed`) only for changes a blits user can
  see.
- Machine rules: the controller's machine is the user's workstation. One unit test file locally
  (`npx vitest run <file>`); more files, `tsc`, builds go to the fleet:
  `onto do --kind <test|typecheck|build|bench> -task <unique-name> -expect <dur> -in blits-gpu-timing -- <cmd>`.
  WebGPU tests only on teitou:
  `onto do --kind test --node teitou -task <name> -expect 6m -in blits-gpu-timing -- npm run test:gpu <filter>`.
  Never `git stash`, never push.
- Bench: estimate wall time before launching; one progress line per row; every frame's time and the
  run's conditions to disk under `bench/runs/`.
- u32 data in a `Float32Array` (offsets, flags, mask words) is written through a `Uint32Array` view
  of the same buffer, never as a float: a NaN bit pattern written as a float may come back
  canonicalized.

## Review Focus

1. **A `stagger` answering `NaN`, `±Infinity` or a non-number for some subject.** Expect the voice on
   the CPU with "its stagger gives a subject a delay that is not a finite number", not garbage on
   the GPU. Test in Task 7 (`eligible` unit test).
2. **`subjects()` called again, reordered and grown, after the CPU has met some subjects.** Expect
   no second `stagger`/`target` call for a met subject or one already answered, and the met ones
   keeping the record's answer. Test in Task 2.
3. **A host that never probes, with an unnamed `stagger` on a finite loop.** Expect the voice on the
   CPU with the reason in Spec conflict 1's ruling, and its end unchanged from `mixer` (Spec
   conflict 1). Test in Task 2 (unit) and Task 8
   (agreement past the end).
4. **Negative delays, and a staggered voice cued backward (`rate < 0`, beginless).** Expect the same
   phase and pass as `mixer`, before 0 included. Test in Task 3 (port grid) and Task 8 (agreement).
5. **A rate change or seek while some subjects are still inside their delay and fading in.** Expect
   only the subjects whose origin is still ahead to move, as `reorigin` moves the CPU's early
   records. Test in Task 4 (unit) and Task 8 (agreement).

---

## File map

| File | Change | Owns |
|---|---|---|
| `src/asked.ts` | create | `Asked<I>`: the hook interface the core reads; types only |
| `src/voice.ts` | modify | `asked: Asked<I> \| null = null` field |
| `src/delay.ts`, `src/chain.ts` | modify | read `voice.asked` before calling `stagger`/`target` |
| `src/gpu/answers.ts` | create | the side table: per voice per registered list, delays and reach |
| `src/gpu/wgsl/timing.ts` | create | WGSL ports: `blits_clock`, `blits_fade_in`, and `TAKE_WGSL` |
| `src/gpu/timings.ts` | create | timing blocks in `persub`: layout, origins, uploads |
| `src/gpu/table.ts` | modify | `ROW`, `Col`, `Flag`, `Slot` |
| `src/gpu/row-clock.ts` | create | fills a row's clock and fade columns (keeps `table.ts` small) |
| `src/gpu/kernel.ts` | modify | per-subject take, per-subject role leader, `lag` argument |
| `src/gpu/runner.ts`, `src/gpu/runners/motion.ts` | modify | runner signature gains `lag` |
| `src/gpu/mirror.ts`, `src/gpu/mirrors.ts` | modify | per-row time for a staggered motion; `place` from an offset |
| `src/gpu/eligible.ts` | modify | reasons: drop stagger and "misses a subject", add the new ones; `target` |
| `src/gpu/side.ts` → `src/gpu/buffers.ts` | split | buffer sizing, subject upload and bind group move out |

---

### Task 1: Unit tests for `Regions`

**Files:**
- Create: `test/gpu-region.test.ts`
- Modify (only if a test exposes a bug): `src/gpu/region.ts`

**Interfaces:**
- Consumes: `Regions.frame(entries, cap?)`, `Regions.data`, `Regions.length`, `Placement` (unchanged).
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

`describe('Regions')` with, each building `Entry`s from fresh owner objects and `Float32Array`s:
- `'keeps a survivor where it was when another departs'`: frame `[a(4), b(4), c(4)]`, then
  `[a, c]` with the same arrays: `offsets` `[0, 8]`, `changed` `[]`, `data` at 8..12 still `c`.
- `'reuses a region for values that shrank, and moves values that grew'`: `a` 8 values, then a new
  array of 4 for `a`: offset unchanged, `changed` `[[0, 16]]`; then 12 values: offset is the old
  `length`, `changed` covers only the new range.
- `'compacts once holes outweigh the live values'`: 10 entries of 16, then only the last: offset
  becomes 0 and `changed` is `[[0, 64]]`, `length` 16.
- `'compacts past cap'`: `frame(entries, cap)` with `cap` below `length`: entries laid end to end
  from 0.
- `'doubles its store and keeps what it held'`: 20 entries of 1 value each, past the initial 16:
  `data.length` a power of 2 ≥ 20, every entry's value readable at its offset.
- `'merges touching ranges'`: two new adjacent entries give one `changed` range in bytes.

- [ ] **Step 2: Run them**

Run: `npx vitest run test/gpu-region.test.ts`
Expected: PASS. A failure is a bug in `region.ts`: fix it there, keeping the test.

- [ ] **Step 3: Commit**

`git add test/gpu-region.test.ts [src/gpu/region.ts]` and commit "test Regions' departures,
compaction, shrink and grow, and store doubling". Delete the `Regions` bullet from `HANDOFF.md`
item 18 in the same commit.

---

### Task 2: The side table and the core's hook into it

**Files:**
- Create: `src/asked.ts`, `src/gpu/answers.ts`, `test/gpu-answers.test.ts`
- Modify: `src/voice.ts` (one field), `src/delay.ts`, `src/chain.ts` (`aimsAt`)

**Interfaces:**
- Produces, in `src/asked.ts` (types only, imported with `import type`):

```ts
/** A voice's `stagger` and `target` answers kept elsewhere, which `held` takes before asking. */
export interface Asked<I> {
  /** The subject's delay; undefined where it has none kept. */
  delay(subject: I): number | undefined;
  /** Whether the voice reaches the subject; undefined where it has none kept. */
  reaches(subject: I): boolean | undefined;
}
```

- `Voice.asked: Asked<I> | null = null` (not reset by `park`).
- `delayOf` in `src/delay.ts`: after the `named` lookup, `const a = voice.asked; if (a !== null) { const d = a.delay(subject); if (d !== undefined) return d; }` before calling `spec.stagger`.
- `aimsAt` in `src/chain.ts`: the same, only inside the `voice.spec.target` branch.
- Produces, in `src/gpu/answers.ts`:

```ts
export interface Answer {
  /** Each registered subject's delay, registration order; null where the voice does not stagger. */
  readonly delays: Float64Array | null;
  /** One bit per registered subject, set where reached; null where every one is reached. */
  readonly reach: Uint32Array | null;
  /** Whether every delay of a reached subject is a finite number. */
  readonly finite: boolean;
}
export class Answers<I> {
  constructor(mix: Mixer<I, unknown>);
  /** Forgets every answer and indexes `list`; each voice is asked again at its next `of`. */
  register(list: readonly I[]): void;
  /** The voice's answers for the registered list, made once per voice per `register`. */
  of(voice: Voice<I, unknown>): Answer;
  /** A registered subject's place in the list. */
  index(subject: I): number | undefined;
}
```

Rules `of` follows, in this order per registered subject: a record the voice already holds
(`voice.subjects.get(subject)`) gives its `reaches` and `delay`; else `named` gives reach
(`named.has`) and delay (`named.delays`); else `target` is asked, then `stagger` only for a reached
subject, as `held()` asks them. Delays and reach are kept for reached subjects only (0 otherwise).
`reach` is null when every registered subject is reached. Where the voice has an unnamed `stagger`
or a `target`, `of` sets `voice.asked` to an object reading these arrays through `index`; a named
voice's answers are fixed at cue and need no hook. `of` never touches `voice.latest`,
`voice.soonest` or the schedule (Spec conflict 1's ruling); eligibility keeps a finite-span voice
with an unnamed `stagger` on the CPU.

- [ ] **Step 1: Write the failing tests** (`test/gpu-answers.test.ts`)

Each test counts `stagger`/`target` calls with a spy (`(c) => { calls++; return c.i * 10; }`):
- `'asks stagger once per registered subject, and the CPU takes the answer'`: `of` → calls `n`;
  `m.probe` every subject → calls still `n`; each record's `delay` equals `delays[i]`.
- `'asks target once, and stagger only where it reaches'`: target `i % 2 === 0`, `reach` bits match,
  stagger calls `ceil(n / 2)`.
- `'keeps a met subject's answers when the list is registered again'` (Review Focus 2): probe 2 of
  4, `register` a reordered list of 6, `of`: calls `4 + 2` in total over the whole test, the 2 met
  ones' delays the records'.
- `'gives null reach for a voice reaching every subject, and a mask for a named subset'`.
- `'plays a never-probed staggered finite voice until its last subject ends'` (Review Focus 3):
  `loop: 2`, duration 1000, stagger to 900; after `of`, `m.sync(2500)` → the voice is still in
  `mixerOf(m).cued` with state `live`; `m.sync(2901)` → it is not.
- `'leaves a mix with no gpu side as it was'`: a mixer-made mix's voices have `asked === null`.

- [ ] **Step 2: Run** `npx vitest run test/gpu-answers.test.ts` — Expected: FAIL (`answers.js` missing).

- [ ] **Step 3: Implement** `src/asked.ts`, the `Voice` field, the two hooks, and `src/gpu/answers.ts` as above.

- [ ] **Step 4: Run** `npx vitest run test/gpu-answers.test.ts` — Expected: PASS.

- [ ] **Step 5: Run the CPU suite on the fleet**

`onto do --kind test -task gpu-timing-t2-suite -expect 6m -in blits-gpu-timing -- npm test` and
`onto do --kind typecheck -task gpu-timing-t2-tsc -expect 4m -in blits-gpu-timing -- npm run typecheck`.
Expected: both pass. The hooks sit on first sight of a subject (`held`), not on the per-probe path,
so no bench is owed; say so in the commit body.

- [ ] **Step 6: Commit** "answer stagger and target for the gpu side's registered subjects once, and let held take those answers".

---

### Task 3: WGSL ports of the per-subject clock and fade in

**Files:**
- Create: `src/gpu/wgsl/timing.ts`, `test/gpu/timing.gpu.ts`

**Interfaces:**
- Produces, `CLOCK_WGSL` (needs nothing in scope) and `FADE_WGSL` (needs `EASING_WGSL`, so
  `values`, in scope):

```wgsl
struct Clock { shows: bool, elapsed: f32, phase: f32, pass_index: f32 }
// raw: the subject's voice time less B, the start of the pass the voice is in (see Task 5).
fn blits_clock(raw: f32, flags: u32, start: f32, span: f32, duration: f32, pass_base: f32, last_pass: f32) -> Clock
// end and shown relative to the same anchor; ease_at == 0xFFFFFFFFu for linear.
fn blits_fade_in(end: f32, shown: f32, fade_in: f32, ease_at: u32) -> f32
```

- `Flag` bits (exported from `src/gpu/table.ts` in Task 5, defined here first as a `const enum` in
  `timing.ts` and re-exported): `SHOWS = 1, BEGINLESS = 2, HOLDS_FIRST = 4, FREEZES_AFTER = 8,
  HIDES_PAST = 16, UNSTARTED = 32, FINITE = 64, NO_CLOCK = 128, FADE = 256`.
- `NONE = 0xffffffff`, the absent-offset sentinel.

`blits_clock` is `Voice.before` → `Voice.shownAt` (`frozenTime`) → `phaseOf` / `passAt` in
`src/contribution.ts`, with every time relative to B: `start = -B` stands for raw 0, `span = span - B`
(read only under `FINITE`), `pass_base = B / duration`, `last_pass = passes - 1`. `NO_CLOCK` stands
for a raw of NaN (`frozenTime`'s pending voice at rate 0): shows only under `HOLDS_FIRST` and not
`BEGINLESS`, at elapsed `start`. A positive floor-mod gives the phase, as `phaseBefore` and
`phaseAt` (whose `elapsed` is never negative there) both reduce to it. `blits_fade_in` is
`fadeInAt` with `stalls` null and `stop` Infinity.

- [ ] **Step 1: Write the tests** (`test/gpu/timing.gpu.ts`, the shape of `easing.gpu.ts`: one tiny
  compute shader per function, a grid of inputs, readback)

- `'blits_clock matches before, shownAt, phaseAt, passAt and phaseBefore'`: for every combination of
  flags {beginless, holdsFirst, freezesAfter, hidesPast, unstarted, finite} that a `Voice` can hold
  (beginless only with not finite), durations {0, 1, 1000}, passes {1, 3, Infinity}, B {0, 2 passes,
  1e6 passes · duration}, and raw (relative) over a grid from `-2·span` to `+2·span` with each
  edge (`start`, `span`) and one f32 step either side, plus NaN raw via `NO_CLOCK`. Want: a TS
  reference composed from `frozenTime`, `phaseAt`, `passAt`, `phaseBefore` at `raw + B` in f64.
  `shows` exactly equal; `phase` and `pass_index` with `close()`, except `closeNear()` for samples
  within one f32 step of a branch (a pass edge, `start`, `span`).
- `'blits_fade_in matches fadeInAt'`: fade-ins {1, 400}, `end - shown` from -500 to 900 and the
  edges 0 and `fade_in`, ease linear and `ease-in-out` and `steps(4)` via `curveData`.
  `closeNear()` only for the `steps` samples at a jump.
- Review Focus 4: the grid includes negative delays (raw above the voice's own) and beginless.

- [ ] **Step 2: Run on teitou**

`onto do --kind test --node teitou -task gpu-timing-t3 -expect 6m -in blits-gpu-timing -- npm run test:gpu timing`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement** `src/gpu/wgsl/timing.ts`.

- [ ] **Step 4: Run on teitou** (same command). Expected: PASS, one line per test.

- [ ] **Step 5: Commit** "port the per-subject clock and fade in to WGSL, pinned to the TS by a WebGPU test".

---

### Task 4: Timing blocks in the per-subject buffer

**Files:**
- Create: `src/gpu/timings.ts`, `test/gpu-timings.test.ts`
- Modify: `src/gpu/mirrors.ts` (`place(mirrors, from = 0)`; `upload` unchanged)

**Interfaces:**
- Consumes: `Answers.of` (Task 2); `mix.sinceOf`, `mix.shownOf`.
- Produces:

```ts
/** Where a voice's timing block sits in `persub`, in f32s; NONE for a part it has none of. */
export interface TimingSlot {
  readonly delays: number;
  readonly mask: number;
  readonly shown: number;
  /** The mix time `shown` counts from (f64; never sent to the GPU itself). */
  readonly anchor: number;
  /** The latest subject's fade-in origin, f64: the fade is done for all once `end - latest >= fade in`. */
  readonly latest: number;
}
export class Timings {
  /** Lets go of every block; called from `GpuSide.subjects`. */
  clear(): void;
  /** This frame's blocks, one per voice or undefined for one needing none, laid from `from`. */
  place<I>(mix: Mixer<I, unknown>, voices: readonly Voice<I, unknown>[], answers: Answers<I>, from: number): (TimingSlot | undefined)[];
  /** f32s the blocks take. */
  readonly length: number;
  /** Writes blocks that changed since the last upload, or all where `full`. */
  upload(device: GpuDevice, buffer: GpuBuffer, full: boolean): void;
}
```

Block layout, per voice, in this order, each present only where needed:
`[delays: n f32][mask: ceil(n/32) u32][shown: n f32]`. A voice needs a block where its `Answer` has
`delays` or `reach`; it needs `shown` where it has `delays`, `fade.in > 0`. `shown[i]` is
`mix.shownOf(voice, mix.sinceOf(voice, delays[i])) - anchor`, f64 rounded once, kept in f64 too.
Each voice keeps a clock signature — `state`, `start`, `anchorNow`, `anchorElapsed`, `rate`, `ramp`
(identity), `clocks?.length`, `opened`, `seeks` — and where it moved since the last frame recomputes
`since` only for subjects whose kept `since` is still after `now` (as `reorigin` moves only early
records), then `shown` for all, with `anchor = now`, and marks the `shown` range changed. Delays and
mask are written once per `register`. Blocks lay end to end in voice order from `from` (the mirrors'
length), so `persub` is mirrors then timings; a voice's block keeps its offset while the voice
order holds, and the whole of `persub` is written when it moves, as `Mirrors` does.

- [ ] **Step 1: Write the failing tests** (`test/gpu-timings.test.ts`, a mixer-made mix, no device;
  `upload` against a fake `GpuDevice` recording `writeBuffer` calls as `test/gpu-engine.test.ts` does)

- `'lays delays, mask and origins in order, from the offset given'`.
- `'writes the mask through u32 bits'`: a mask word with bit 31 set reads back exactly through a
  `Uint32Array` view.
- `'gives each subject the origin a record would hold'`: stagger `i * 100`, `fade: { in: 300 }`;
  after `place`, probe every subject; each record's `shown - anchor` equals the block's `shown[i]`
  within f32 rounding.
- `'moves only the origins still ahead after a rate change'` (Review Focus 5): at `now = 250`, set
  the voice's rate to 2; `place` again: subjects with delay ≤ 250 keep their origin; later ones
  equal `mix.shownOf(v, mix.sinceOf(v, d))` after the change, and equal the records a probe then
  makes.
- `'writes nothing when nothing moved'`: a second `place` + `upload` records no writes.

- [ ] **Step 2: Run** `npx vitest run test/gpu-timings.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** `src/gpu/timings.ts` and `Mirrors.place`'s `from`.

- [ ] **Step 4: Run** `npx vitest run test/gpu-timings.test.ts` — Expected: PASS. Then
  `npx vitest run test/gpu-mirror.test.ts` — Expected: PASS (offsets unchanged at `from = 0`).

- [ ] **Step 5: Commit** "lay each staggered or partial voice's delays, reach and fade-in origins in the per-subject buffer".

---

### Task 5: The row carries the voice's clock

**Files:**
- Create: `src/gpu/row-clock.ts`
- Modify: `src/gpu/table.ts`, `test/gpu-table.test.ts`

**Interfaces:**
- Consumes: `TimingSlot` (Task 4), `Flag`/`NONE` (Task 3).
- Produces: `ROW = 21` (Task 6 retires `FIRST`, moves `FLAGS` to 6 and makes `ROW` 20; every
  reader goes through `Col` names, so that move is one enum edit) and

```ts
export enum Col {
  SHADER = 0, VALUES = 1, PHASE = 2, PASS = 3, WEIGHT = 4, ROLE = 5,
  FIRST = 6,       // unchanged until Task 6
  SUB = 7,
  DELAYS = 8, MASK = 9, SHOWN = 10,   // u32 offsets in persub, NONE for none
  CLOCK = 11,      // the voice's raw time at delay 0, less B
  START = 12,      // -B
  SPAN = 13,       // span - B, read only under FINITE
  DURATION = 14,
  PASS_BASE = 15,  // B / duration
  LAST_PASS = 16,  // passes - 1, read only under FINITE
  FADE_END = 17,   // fadeInAt's `end`, less the timing slot's anchor
  FADE_IN = 18,    // ms
  EASE = 19,       // u32 offset in values of the fade's curve, NONE for linear
  FLAGS = 20,      // `Flag` bits, as a u32's bits
}
export interface Slot { readonly runner: number; readonly values: number; readonly sub: number;
  readonly timing?: TimingSlot; readonly ease: number }
```

- `rowClock(mix, voice, slot, rows, bits, o): void` in `row-clock.ts` fills `CLOCK` … `EASE` and the
  timing flags for a voice with `slot.timing?.delays !== NONE`. B is
  `duration * clamp(floor(E / duration), 0, finite ? passes - 1 : Infinity)` where
  `E = voice.rawAt(now, 0)` is finite and `duration > 0`, else 0; `NO_CLOCK` where `E` is NaN.
  `FADE` is set where `fade.in > 0`, `!mix.reducedNow` and `end - timing.latest < fade.in`; then
  `WEIGHT` holds `voice.weight * envelope(0, out, ease, reduced, now, 0, back, stalls)` unclamped
  (the kernel multiplies the subject's fade in and clamps), else `voiceTable`'s weight as now.
- `voiceTable`: a voice with no delays keeps phase 1's `PHASE`/`PASS`/`WEIGHT` and gets `SHOWS`
  where its `elapsedOf` is not NaN; `ROLE` is set for every voice with a role, showing or not,
  while `FIRST` still marks the first showing member, so phase 1's kernel folds roles right until
  Task 6; `MASK` comes from `slot.timing?.mask ?? NONE`.

- [ ] **Step 1: Update and write tests** (`test/gpu-table.test.ts`)

- Extend `'marks the first member of each role'`: a member showing nothing keeps its `ROLE`.
- `'carries a staggered voice's clock relative to its pass'`: loop of 1000 ms at `now = 2250`:
  `CLOCK` 250, `START` -2000, `PASS_BASE` 2, `FLAGS & FINITE` 0; and for `loop: 3` at 5000:
  `LAST_PASS` 2, `SPAN` 1000 (3000 - 2000).
- `'sets FADE only while some subject is still fading in'`.
- `'reads offsets back as the u32s written'` for `DELAYS`, `MASK`, `SHOWN`, `EASE` with values past 2^24.

- [ ] **Step 2: Run** `npx vitest run test/gpu-table.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `row-clock.ts` and the `table.ts` changes.
- [ ] **Step 4: Run** `npx vitest run test/gpu-table.test.ts` — Expected: PASS.
- [ ] **Step 5: Commit** "carry a voice's clock, relative to its current pass, in its gpu table row".

---

### Task 6: The kernel takes each subject's own clock, reach and role leader

**Files:**
- Modify: `src/gpu/kernel.ts`, `src/gpu/table.ts` (retire `FIRST`), `src/gpu/wgsl/timing.ts` (add `TAKE_WGSL`), `src/gpu/runner.ts` (doc of
  the signature), `src/gpu/runners/motion.ts`, `src/gpu/shader-patch.ts` if it states the signature,
  `test/gpu-kernel.test.ts`
- Split if `kernel.ts` passes ~250 lines: the generated main loop into `src/gpu/kernel-main.ts`.

**Interfaces:**
- Consumes: `Col`, `Flag`, `NONE`, `blits_clock`, `blits_fade_in`.
- Produces:
  - `Col.FIRST` deleted, `Col.FLAGS = 6`, `ROW = 20`; `voiceTable` no longer works out a leader.
  - Every runner is `fn run_<i>(phase: f32, pass_index: f32, subject: Subject, base: u32, sub: u32, lag: f32) -> Out_<i>`.
    `lag` is how far the subject's shown time is behind the voice's raw time (`CLOCK - elapsed`),
    0 for a voice with no delays. Only the motion runner reads it: `let t = values[k] - lag;`
    (`values[k]` is the voice's raw time less the mirror's anchor for a staggered voice; Task 9).
  - `TAKE_WGSL` (needs `table`, `persub`, `values`, `frame` in scope):
    `struct Take { shows: bool, w: f32, phase: f32, pass_index: f32, lag: f32 }` and
    `fn blits_take(o: u32, i: u32) -> Take`: reach bit (`MASK`) first, then for a row with `DELAYS`
    `blits_clock(table[o + CLOCK] - persub[DELAYS + i], …)`, then under `FADE`
    `clamp(table[o + WEIGHT] * blits_fade_in(table[o + FADE_END], persub[SHOWN + i], …), 0, 1)`;
    a row without `DELAYS` takes `SHOWS`, `PHASE`, `PASS`, `WEIGHT` from the row.
  - Roles: the first pass keeps `var lead: array<u32, MAX_ROLES>` (start `NONE`) and sets
    `lead[r] = k` at the first member that `shows` for this subject, whatever its weight, gathering
    only where `w > 0`; the second pass folds a role at `k == lead[r]`. This is the CPU's rule (a
    member at weight 0 still holds the role's place; one showing nothing or not reaching does not).

- [ ] **Step 1: Update tests** (`test/gpu-kernel.test.ts`): the generated code declares `run_0(… lag: f32)`,
  calls `blits_take`, and reads no leader from the row; it is the same string for two
  frames whose voices differ only in data.

- [ ] **Step 2: Run** `npx vitest run test/gpu-kernel.test.ts` — Expected: FAIL, then implement, then PASS.

- [ ] **Step 3: Run every WebGPU test on teitou** (phase 1's must hold unchanged)

`onto do --kind test --node teitou -task gpu-timing-t6 -expect 6m -in blits-gpu-timing -- npm run test:gpu`
Expected: every existing test passes.

- [ ] **Step 4: Commit** "fold each subject with its own clock, reach and role leader in the gpu kernel".

---

### Task 7: Partial reach on the GPU

**Files:**
- Create: `src/gpu/buffers.ts`, `test/gpu/reach.gpu.ts`
- Modify: `src/gpu/side.ts`, `src/gpu/eligible.ts`, `test/gpu-table.test.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `Answers` (Task 2), `Timings` (Task 4), `Slot` (Task 5).
- Produces:
  - `eligibility(mix, subjects, answers: Answers<I>)` (third parameter required; tests pass
    `new Answers(mixerOf(m))` after `register`). `why()` drops "it misses a subject"; after every
    other check it calls `answers.of(voice)` for a voice with `stagger`, `target`, or `named`, and
    returns "its stagger gives a subject a delay that is not a finite number" where `!finite`. Until
    Task 8, a voice with delays still returns "it staggers its subjects".
  - `within`'s `room` counts the timing block too: `persub = mirror rows + delays n + ceil(n/32) + shown n`.
  - `src/gpu/buffers.ts`: `class Buffers { sized(name, bytes, usage): GpuBuffer; subjects(list, fieldsOf, fields): void; bind(pipeline, layout): GpuBindGroup }`
    — `GpuSide`'s `sized`, `upload` and bind group cache, moved whole.
  - `GpuSide` owns one `Answers` (registered in `subjects()`) and one `Timings` (cleared there);
    `persub` is `mirrors.length + timings.length` f32s; the fade curve of a voice with `FADE` goes in
    `regions` as its own entry, owned by the voice's timing record, its offset in `Slot.ease`.

- [ ] **Step 1: Write the failing tests**

`test/gpu/reach.gpu.ts`, an `agree` helper like `rules.gpu.ts`'s, generalized to take the cue specs
and the patch, run once per runner kind: a `shaderPatch`, a `wave`, a `keys` with an eased stop, a
`spring` retargeted mid-run. Each at `t` in {1, 250, 999, 1000, 1700, 4100}, every subject, `close()`:
- `'a voice naming every third registered subject'` (others fold rest / the other voices).
- `'a target voice reaching the even subjects'` — fails today: the phase-1 bug.
- `'two voices in one role, each reaching half, overlapping on a quarter'` — the role's leader
  differs per subject.
- `'a partial voice fading in and out'`.

`test/gpu-table.test.ts`: `'keeps a voice on the CPU whose stagger answers NaN for a subject'`
(Review Focus 1) — reason text exact.

- [ ] **Step 2: Run** the unit file locally (FAIL), and `npm run test:gpu reach` on teitou (FAIL).
- [ ] **Step 3: Implement** the split, the wiring and the eligibility changes.
- [ ] **Step 4: Run** `npx vitest run test/gpu-table.test.ts` (PASS); on teitou
  `npm run test:gpu` (all PASS, `-task gpu-timing-t7`); on the fleet `npm test` and
  `npm run typecheck` (PASS).
- [ ] **Step 5: CHANGELOG** under `## Unreleased`:
  `### Added` "The `gpu` engine folds a voice that reaches only some of the registered subjects,
  through `subjects` or `target`." `### Fixed` "The `gpu` engine folded a `target` voice into every
  registered subject, including those its `target` turned away."
- [ ] **Step 6: Commit** "fold voices reaching some registered subjects on the gpu, and stop folding a target voice into every one".

---

### Task 8: Staggered voices on the GPU (shader, wave, keys)

**Files:**
- Create: `test/gpu/stagger.gpu.ts`
- Modify: `src/gpu/eligible.ts`, `src/gpu/side.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: everything above.
- Produces: `why()` returns "it staggers its subjects" only for a motion voice (until Task 9), and
  adds, for a voice with delays and `fade.in > 0`: "its fade in eases by a function, which the GPU
  cannot run" (`curveData` undefined) and "its fade in stalled where a fade out turned back, and
  its subjects start at different times" (`stalls !== null`).

- [ ] **Step 1: Write the failing tests** (`test/gpu/stagger.gpu.ts`, per runner kind shader / wave /
  keys; 257 subjects; `stagger: (c) => rank(c) * 7` with `rank` a shuffled permutation, as bree's
  order gives one)
- `'a looping staggered voice'` at the times of Task 7 plus 1e6 ms (B large).
- `'a staggered voice with negative delays'` and `'a staggered voice cued backward'` (Review Focus 4).
- `'a staggered finite loop played past its last subject's end'`, with and without `freeze: 'after'`,
  on a mix whose gpu side is never probed until the comparison (Review Focus 3).
- `'a staggered voice fading in, then out, then in again'` (`fade: { in: 400, out: 300 }`), easing
  linear and `ease-in-out`.
- `'staggered role members whose leader moves from subject to subject'`.
- `'a rate change and a ramp while subjects are inside their delays'` and `'a seek on the voice's
  handle back into the delays'`, comparing after each (Review Focus 5).
- `'subjects() called again in another order mid-play'`.
`closeNear()` only at samples whose subject time is within one f32 step of a pass edge or the start.
Unit (`test/gpu-table.test.ts`): the two new reasons, exact text.

- [ ] **Step 2: Run** on teitou `npm run test:gpu stagger` — Expected: FAIL (voices stay on the CPU).
- [ ] **Step 3: Implement** the eligibility changes.
- [ ] **Step 4: Run** `npx vitest run test/gpu-table.test.ts` (PASS); teitou `npm run test:gpu`
  (all PASS, `-task gpu-timing-t8`); fleet `npm test` (PASS).
- [ ] **Step 5: CHANGELOG** `### Added`: "The `gpu` engine folds voices that stagger their subjects,
  for shader patches, `wave` and `keys`."
- [ ] **Step 6: Commit** "fold staggered shader, wave and keys voices on the gpu".

---

### Task 9: Staggered motions on the GPU

**Files:**
- Create: `test/gpu/motion-stagger.gpu.ts`
- Modify: `src/gpu/mirror.ts`, `src/gpu/mirrors.ts` (`of` passes delays), `src/gpu/side.ts`,
  `src/gpu/eligible.ts`, `test/gpu-mirror.test.ts`, `CHANGELOG.md`

**Interfaces:**
- Consumes: `Answer.delays` (Task 2), the motion runner's `lag` (Task 6).
- Produces: `new Mirror(motions, list, packed, delays: Float64Array | null)`;
  `Mirrors.of(voice, p, packed, list, delays)`. With `delays`, `prepare(t, horizon)` takes the
  voice's raw time at delay 0 (`voice.rawAt(now, 0)`, not `elapsedOf`), and for row `i` commits and
  writes at `t - delays[i]` with horizon `horizon - delays[i]`, skipping commits for a row whose
  time is still below 0 (its subject has not started, so a live sample would not have committed).
  `values()[0]` stays the voice's time less `anchor`; the kernel subtracts each subject's `lag`.
  `why()` drops "it staggers its subjects".

- [ ] **Step 1: Write the failing tests**

`test/gpu-mirror.test.ts`:
- `'commits an untimed retarget at each subject's own time'`: delays `[0, 100]`, `prepare(150)`:
  row 0's run released at 150, row 1's at 50.
- `'keeps a retarget pending for a subject still inside its delay'`: a `to` timed at subject time 80;
  `prepare(150)` commits row 0 (time 150) and leaves row 1 (time 50) on the due list; `prepare(190)`
  commits it.

`test/gpu/motion-stagger.gpu.ts`, `close()` every subject: a staggered spring, tween and bounded
glide, each retargeted mid-run, before and after some subjects start, played past the mirror's
re-anchor (2^14 ms of voice time).

- [ ] **Step 2: Run** the unit file (FAIL) and teitou `npm run test:gpu motion-stagger` (FAIL).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run test/gpu-mirror.test.ts` (PASS); teitou `npm run test:gpu`
  (all PASS, `-task gpu-timing-t9`); fleet `npm test` and `npm run typecheck` (PASS).
- [ ] **Step 5: CHANGELOG**: extend Task 8's line to "for every patch the gpu engine runs".
- [ ] **Step 6: Commit** "fold staggered tween, spring and glide voices on the gpu".

---

### Task 10: Measure, document, and move demos

**Files:**
- Modify: `bench/gpu-stock.mjs`, `docs/schema.html` ("The gpu engine"), `site/src/pages/engine.mdx`,
  `docs/superpowers/specs/2026-11-03-gpu-reach-design.md` (status line), `HANDOFF.md` (item 18)
- Create: `bench/runs/2026-11-<dd>-gpu-stagger.jsonl`, `bench/runs/2026-11-<dd>-gpu-stagger.txt`

**Interfaces:**
- Consumes: the finished engine.
- Produces: `MIX=stagger` in `bench/gpu-stock.mjs`: the `full` mix with every voice cued
  `stagger: (c) => (c.i % 256) * 4` (a rank, as bree writes its per-dot offsets), the `bounce` keys
  voice also `target: (c) => c.i % 2 === 0`, and `fade: { in: 500 }` on the keys voices so the
  per-subject fade path runs in the first ~90 frames. Existing rows and records are unchanged.

- [ ] **Step 1: Estimate before launching.** From `bench/runs/2026-11-03-gpu-stock.txt` (300 frames +
  30 warm): mixer 100k 8.6 s wall, mixer 1M 111 s, gpu 100k 2.6 s, gpu 1M 27.5 s, about 150 s of
  frames; add the 1M `stagger`/`target` calls and page loads, about 1 minute. Budget 10 minutes; a
  staggered mixer row above 1.5× its `full` time is a finding, not a reason to rerun.

- [ ] **Step 2: Run on teitou**

`onto do --kind bench --node teitou --solo -task gpu-timing-bench -expect 10m -in blits-gpu-timing -- env MIX=stagger ROWS=mixer:100000,gpu:100000,mixer:1000000,gpu:1000000 FRAMES=300 WARM=30 node bench/gpu-stock.mjs --out bench/runs/2026-11-<dd>-gpu-stagger`
Expected: one progress line per row; the `.jsonl` holds every frame and the run's conditions. Write
the `.txt` digest (`--digest`) with the header the 2026-11-03 one has (node, load, command, commit).

- [ ] **Step 3: Docs.** `docs/schema.html`: in the table's voice row, move "staggering its subjects;
  reaching some registered subjects (`subjects`, `target`)" to the folds column; replace "it
  staggers its subjects" and "it misses a subject" with the reasons Tasks 7–8 added, quoted from
  the code; add one paragraph on how a stagger runs (delays and origins per subject in `persub`, the
  clock relative to the current pass, the side table answering `stagger`/`target` once, and
  Spec conflict 1's lifetime rule with its date); add the bench numbers with their record paths;
  shrink "Not built yet" to phases 3–4. `site/src/pages/engine.mdx`: the example reason on line ~78
  becomes one that still exists; add the staggered row to the cost table. Spec status line: phase 2
  built (commit range). `HANDOFF.md` item 18: phase 2 built; what it left open.

- [ ] **Step 4: Demos.** List the site demos on the gpu engine (`grep -l gpuDevice site/src/live -r`)
  and, for each, whether it staggers or reaches some subjects. As of planning none does
  (`gpu-grid.ts`, `light-board.ts`, `number-rules.ts`, `white-balance.ts`, `stack-order.ts`,
  `blend-modes.ts`, `hit-flash.ts`, `threshold-wipe.ts`), and the staggering demos (`reveal.ts`,
  the explainers) draw DOM, not a gpu grid, so none moves. If one qualifies by then: switch it,
  open it headless with `?panel` (playwright MCP), check its mixes are listed and `channel()`
  returns non-null for the staggered channel, and screenshot it to the wall (`transom post`, zone
  `blits`).

- [ ] **Step 5: Run** `npm run site:smoke` on the fleet
  (`onto do --kind test -task gpu-timing-smoke -expect 6m -in blits-gpu-timing -- npm run site:smoke`).
  Expected: PASS.

- [ ] **Step 6: Commit** "measure staggered voices on the gpu engine at 100k and 1M, and record phase 2 as built".
