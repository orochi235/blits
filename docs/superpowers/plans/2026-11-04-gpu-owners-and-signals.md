# GPU Owners and Weight Signals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-11-04): planned, not built.**

**Goal:** A voice an owner holds, and a voice weighted by a signal, fold on the GPU for every runner
kind phases 1–2 support (`shaderPatch`, `wave`, `keys`, `tween`/`spring`/`glide`, staggered or not,
reaching every registered subject or some), agreeing with `mixer` subject by subject.

**Architecture:** The row's clock already reads through owners: `Voice.rawAt`, `unstarted`,
`shownAt` and the timing blocks' `sinceOf`/`shownOf` all walk the owner chain (`ownedElapsed`,
`ownerReading`, `originOf`). What phase 3 adds is weight. A new `src/gpu/weight.ts` is the one place
the gpu side works out a voice's weight on the CPU: its own number or a signal read the same for
every subject, times what its owners multiply in (`ownersWeight`, fades and arcs included), and it
says why a voice's weight keeps it on the CPU. A signal read per subject is read on the CPU by
`src/gpu/reads.ts` into one f32 per registered subject, laid in `persub` after the timing blocks
and uploaded each frame; a new row column points the kernel at it, and `blits_take` multiplies it in
before its clamp. A later task measures that path against leaving such a voice on the CPU and keeps
the faster.

**Tech Stack:** TypeScript, WGSL (WebGPU compute), vitest, headless Chromium WebGPU tests on teitou
(`test/gpu/*.gpu.ts`), `onto` for fleet jobs, `bench/` with Playwright.

**Spec:** `docs/superpowers/specs/2026-11-03-gpu-reach-design.md`, section "3. Owners and weight
signals", bound by its "Decided" section (the gpu side changes nothing the CPU observes; the TS stays
the definition; f32 tolerance only in tests).

## Spec conflicts

1. **"An owner with per-subject parts (it staggers, carries a per-subject signal, or parts from
   subjects) keeps its voices on the CPU."** An owner cannot stagger or part: `OwnerSpec`
   (`src/types/voice.ts`) has no `stagger` or `target`, and an owner's handle refuses
   `fade({ subject })` ("an owner fades as a whole, not by subject or at rest", `src/hosts.ts`).
   `arcShare` and a span's fit are the same for every subject. **Resolution:** the only per-subject
   part an owner can have is a weight signal read per subject, so that is the only owner reason
   ("an owner above it weighs it by a signal read per subject"). No owner-stagger or owner-parting
   reason is written.
2. **"A weight signal read the same for every subject"** has no marker in blits: a `Signal` is
   `(subject, setting) => number`, and nothing tells `level(0.5)` from `(c) => c.x`.
   **Resolution:** a signal counts as read the same for every subject exactly when its function
   declares no parameters (`signal.length === 0`). `level()` and `input(() => x)` qualify, and such a
   function cannot read the subject or the setting, so sampling it once is exact. Every other signal
   (including `share(level, …)` and `peak(…)`, whose wrappers declare two) takes the per-subject
   path, which is correct, only not the cheap one. No core change, no new API.
3. **"A signal read per subject is evaluated on the CPU into a per-subject weight array."** A read
   outside a probe is invisible to the CPU only for a signal that keeps no state and sends nothing.
   `slew`, `lag` and `gate` keep state per voice and subject on the CPU's records through
   `setting.keep`; a blend member's read is shared among members through `blended`, which writes
   `blend.of.reads`; and under `history.inputs` the CPU records each input read and a seek plays the
   recording back, which the GPU never sees. **Resolution:** the gpu side reads through a setting of
   its own whose `keep` and `send` touch nothing and mark the signal refused; a refused signal, a
   blend member, an input recorded by `history.inputs`, and an input that does not report its
   changes (`!heard`) stay on the CPU, each with its own reason.

Found while planning, not a spec conflict: **every owner itself lands in `eligibility().reasons`
today** as "no gpu runner takes a fn patch". Owners sit in `mix.cued` with `ownerPatch` (form `fn`,
writes nothing), so `why()` refuses them and the side warns `": no gpu runner takes a fn patch, so
the gpu engine leaves it on the CPU"` once per mix in development. Task 3 skips owners and pins it.

## Global Constraints

- The TS stays the definition. `ownersWeight`/`ownWeight`/`arcShare` (`src/owner.ts`, `src/arcs.ts`),
  `weighed`/`clampWeight` (`src/clock.ts`) and `base` (`src/weigh.ts`) are called, never copied;
  every WGSL change is pinned by a WebGPU agreement test (`test/gpu/agree.ts`): every subject,
  several times, against a CPU twin probed every frame, asserting the channel IS on the GPU at each
  compared time. Tolerance: `close()`; `closeNear()` only near a branch.
- Every time the GPU reads is relative to the frame's `now` or a voice anchor, never an absolute mix
  time (f32 loses whole ms after about 4.6 hours).
- A voice whose data changed (a weight, an owner's controls, a signal's reads) must not recompile
  the kernel; only a new runner kind or channel set may.
- u32 data in a `Float32Array` (offsets, flags, mask words) is written through a `Uint32Array` view
  of the same buffer, never as a float.
- Nothing new is reachable from `@msb235/blits` or `@msb235/blits/lean`. Core files (`mixer.ts`,
  `voice.ts`, `weigh.ts`, `owner.ts`, `signals.ts`, …) gain at most a null-checked hook, cost
  nothing measurable with no gpu engine attached, and change no CPU-observable state (records, what
  counts as met, `setting.keep` entries, events sent, `reading.kept`). This plan needs no core change.
- Every way an input to the fold can change triggers a refold: `mix.frame` (every `sync`, handle
  writes through `changed`, spans' `later` entries through `unfit`, seeks), `mix.stirs`,
  `mirrors.stirred`, and, new here, `reading.inputs` (a `level.set()` or `touch()` between syncs).
  Timing blocks rebuild on the voice's `seeks` (an owner's seek bumps every descendant's) and move
  their origins on `mix.reorigined` (an owner's `changed` reorigins every descendant).
- Source files stay a few hundred lines; `src/gpu/side.ts` (287) splits before it grows (Task 5).
  New logic goes in new modules under `src/gpu/`.
- A voice that cannot run on the GPU stays on the CPU with one sentence in `eligibility().reasons`;
  each sentence gets an exact-text unit test.
- Commits: imperative subject in the repo's register (see `git log`), body only where it adds
  something, trailer `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that
  wrote the commit. CHANGELOG (`## Unreleased`) only for changes a blits user can see.
- Machine rules: one unit test file locally (`npx vitest run <file>`). More files, `tsc`, builds:
  `onto do --kind <test|typecheck|lint|build> -task <unique> -expect <dur> -about "<one sentence>" -in blits-gpu-owners -- <cmd>`.
  WebGPU tests only on teitou:
  `onto do --kind test --node teitou -task <unique> -expect 8m -about "<sentence>" -in blits-gpu-owners -- npm run test:gpu <filter>`.
  Never `git stash`, never push.
- Bench: state the wall-time estimate before launching; one progress line per row; every frame's
  time, its parts and the run's conditions to disk under `bench/runs/` as each row finishes.

## Review Focus

1. **A per-subject signal reading `NaN`, `±Infinity`, below 0 or above 1 for some subjects.** Expect
   what `mixer` gives: `NaN` contributes nothing, `Infinity` full weight wherever the fade is above
   0 and nothing where it is 0, below 0 nothing, above 1 clamped only after the fade multiplies in.
   Reads are stored with `NaN` → 0 and `±Infinity` → `±3.4028234663852886e38`, so WGSL never sees a
   non-finite weight. Test in Task 5 (unit and agreement).
2. **An owner fading out, having its weight written, or turned back (`rate = -1`) past a child's
   start, while children play.** Expect each child to fade or hide on the GPU exactly as on the CPU,
   in the same frame. Test in Task 4 (agreement).
3. **A `level` set between two syncs, with no clock move and no other change.** Expect the next
   `channel()` to refold with the new value. Test in Task 3 (unit, stub device counts submits) and
   Task 4 (agreement, owner weighted by a level) and Task 5 (agreement, voice weighted by a level).
4. **A stateful signal (`slew`) or one that calls `setting.send`, on a host that never probes.**
   Expect the voice on the CPU with the exact reason, and no `setting.keep` entry, record or event
   created by the gpu side's read. Test in Task 5 (unit).
5. **`subjects()` called again in another order while a per-subject signal voice plays.** Expect the
   reads to follow the new order on the next fold. Test in Task 5 (agreement, `reorder`).

---

## File map

| File | Change | Owns |
|---|---|---|
| `src/gpu/weight.ts` | create | `uniform`, `sampled`, `baseOf`, `ownedOf`, `perSubject`, `weightWhy`: the one pathway for a voice's weight on the gpu side |
| `src/gpu/columns.ts` | modify | `Col.WEIGHTS = 20`, `ROW = 21` |
| `src/gpu/table.ts`, `src/gpu/row-clock.ts` | modify | row weight from `baseOf`/`ownedOf`; `Slot.weights` |
| `src/gpu/wgsl/timing.ts` | modify | `TAKE_WGSL` multiplies a subject's read in before its clamp |
| `src/gpu/unread.ts` | modify | silence from the same weight the kernel folds at |
| `src/gpu/eligible.ts` | modify | owners skipped; weight reasons from `weightWhy`; `refused` parameter |
| `src/gpu/reads.ts` | create | `Reads`: per-subject signal reads, their setting, layout and upload |
| `src/gpu/submit.ts` | create | the buffer writes, bind and dispatch moved out of `side.ts` |
| `src/gpu/side.ts` | modify | refold on `reading.inputs`; reads in the dispatch |
| `test/gpu/kinds.ts` | create | the runner kinds `stagger.gpu.ts` and `motion-stagger.gpu.ts` define, moved |
| `test/gpu/agree.ts` | modify | owners, spans, child `start`, signal weights in scripts |
| `test/gpu/owners.gpu.ts`, `test/gpu/signals.gpu.ts` | create | agreement suites |
| `bench/gpu-harness.mjs` | create | server, browser, rows, records, digest, out of `bench/gpu-stock.mjs` |
| `bench/gpu-reach.mjs` | create | `MIX=signal` and `MIX=owned` |

---

### Task 1: `weight.ts`, a voice's weight on the gpu side

**Files:**
- Create: `src/gpu/weight.ts`
- Test: `test/gpu-weight.test.ts` (create)

**Interfaces:**
- Consumes: `ownersWeight(voice, now, reduced, base)` from `src/owner.ts`; `Signal` from
  `src/types.js`; `Mixer.now`, `Mixer.reducedNow`, `Mixer.ownedBy`, `Mixer.weigh` (tests only).
- Produces:
  - `uniform(signal: Signal<unknown>): boolean` — `signal.length === 0`.
  - `sampled(signal: Signal<unknown>): number` — the signal called with `(undefined, undefined)`.
  - `perSubject<I, O>(voice: Voice<I, O>): boolean` — its `spec.weight` is a function and not
    `uniform`.
  - `baseOf<I, O>(voice: Voice<I, O>): number` — `voice.weight` for a number weight, `sampled` for a
    uniform signal, 1 for a per-subject one (the kernel multiplies each subject's read in).
  - `ownedOf<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>): number` — 1 with no owner, else
    `ownersWeight(voice, mix.now, mix.reducedNow, (o) => sampled(o.spec.weight as Signal<unknown>))`.
    Called only for voices `weightWhy` passed, so every owner signal it meets is uniform.

- [ ] **Step 1: Write the failing tests** (`describe('gpu weight')`, kit and patch from
  `test/gpu-fixtures.ts`; CPU values from `mixerOf(m).ownedBy(voice, cells[0])`, and for the whole
  weight from probing with the CPU after `m.sync(t)` where a test says so)
  - `'reads a level once, and a subject-reading signal per subject'`: `uniform(level(0.3))` true,
    `uniform(input(() => 1))` true, `uniform((c) => c.x)` false, `uniform(share(level(0.5), 0, 2))`
    false; `sampled(level(0.3))` is `0.3`.
  - `'is 1 for a voice no owner holds'`: `ownedOf` of an unowned voice is exactly `1`.
  - `'multiplies nested owners' weights, fades and level signals as ownedBy does'`: program owner
    `{ weight: 0.8, fade: { in: 400 } }`, scene owner `{ owner: program, start: 300, weight: level(0.5), fade: { in: 200, out: 200 } }`,
    child on the scene; at t ∈ {0, 150, 350, 500, 900} after `m.sync(t)`, and after
    `sceneHandle.fade()` at 900 then t ∈ {1000, 1100, 1200}: `ownedOf(mixer, child)` equals
    `mixer.ownedBy(child, cells[0])` to 1e-12.
  - `'takes an arc's share of each part'`: `m.arc({ enter, active, exit, hold: 600, blend: 200 })`
    over `cells` with the fixture patch; at t ∈ {0, 100, 250, 700, 850, 1000}: each child's
    `ownedOf` equals `ownedBy` to 1e-12.
  - `'gives the base the kernel needs'`: `baseOf` is `0.7` for `weight: 0.7`, `0.3` for
    `weight: level(0.3)`, `1` for `weight: (c) => c.x`; `perSubject` false, false, true.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/gpu-weight.test.ts` — Expected: FAIL, `src/gpu/weight.ts` does not exist.

- [ ] **Step 3: Implement the five functions above in `src/gpu/weight.ts`.** `weightWhy` comes in
  Task 3.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run test/gpu-weight.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/gpu/weight.ts test/gpu-weight.test.ts
git commit -m "work out a gpu voice's weight from its owners and a signal read once"
```

---

### Task 2: The row carries owners' weight, and a per-subject read column

**Files:**
- Modify: `src/gpu/columns.ts`, `src/gpu/table.ts`, `src/gpu/row-clock.ts`, `src/gpu/unread.ts`,
  `src/gpu/wgsl/timing.ts`
- Test: `test/gpu-table.test.ts`, `test/gpu-kernel.test.ts`

**Interfaces:**
- Consumes: `baseOf`, `ownedOf` (Task 1).
- Produces:
  - `Col.WEIGHTS = 20`: where the voice's per-subject reads start in `persub`, in f32s, as u32 bits;
    `NONE` for none. `ROW = 21`.
  - `Slot.weights?: number` — that offset; absent where the voice has no per-subject reads.
  - `unreadOf(mix, voice, answers, timings, reads: Float32Array | null = null)` — `reads` is the
    voice's per-subject reads by registration order (Task 5 passes them).
  - `blits_take` contract: `w` is `clamp(row WEIGHT × fade-in(i) × read(i), 0, 1)`, each factor
    present only where its column says so.

- [ ] **Step 1: Write the failing tests** in `test/gpu-table.test.ts` (filter owners out of
  `mixer.cued` when building `voices`: `v.holding === null`)
  - `'weighs an owned voice by its owners, as the CPU does'`: a mix made with `lanes: false`, owner
    `{ start: 200, weight: 0.5, fade: { in: 300 } }`, child `{ owner, weight: 0.8, start: 100 }`
    over `cells`; at t ∈ {250, 400, 700}, after `m.sync(t)` and `m.probe(cells[0])`: row `WEIGHT`
    equals `child.subjects.get(cells[0]).weight` to f32 precision.
  - `'weighs a voice by a level read once'`: `weight: level(0.4)`, row `WEIGHT` = 0.4 × fade.
  - `'leaves a per-subject read to the kernel'`: slot `{ …, weights: 64 }` on a voice weighted by
    `(c) => c.x` with `fade: { in: 400 }` at t = 100: `bits[Col.WEIGHTS]` is 64, `WEIGHT` is the
    unclamped fade × owned (0.25), and with no `weights` in the slot `bits[Col.WEIGHTS]` is `NONE`.
  - `'keeps a staggered row's weight unclamped where reads multiply in'`: staggered voice (the
    `staggered()` helper) with `weight: 1.5` and slot `weights: 0`: `WEIGHT` is 1.5 × the
    envelope with its fade-in taken as done, not clamped; without `weights` and without `FADE`, it
    is clamped to 1.
  - In `test/gpu-kernel.test.ts`, `'multiplies a subject's read into its weight before the clamp'`:
    the kernel code contains `persub[weights + i]` and one `clamp(` in `blits_take` after both the
    fade-in and the read.

- [ ] **Step 2: Run each file to verify the new tests fail**

Run: `npx vitest run test/gpu-table.test.ts`, then `npx vitest run test/gpu-kernel.test.ts` —
Expected: FAIL on the new tests (no `Col.WEIGHTS`; owners' weight missing).

- [ ] **Step 3: Implement**
  - `columns.ts`: add `WEIGHTS = 20` with a one-line doc; `ROW = 21`.
  - `table.ts`: write `bits[o + Col.WEIGHTS] = slot.weights ?? NONE` beside the other offsets. In
    the unstaggered branch, the weight is `weighed(baseOf(voice), fade * ownedOf(mix, voice), 1)`,
    or, where `slot.weights !== undefined`, the unclamped `fade * ownedOf(mix, voice)`.
  - `row-clock.ts`: `w = baseOf(voice) * ownedOf(mix, voice) * envelope(0, …)`; write it unclamped
    where `FADE` is set or `slot.weights !== undefined`, else `clampWeight(w)`.
  - `unread.ts`: a subject is silent at
    `weighed(reads?.[row] ?? baseOf(voice), mix.envelope(voice, now, shown) * ownedOf(mix, voice), 1)`;
    `ownedOf` once per call of `unreadOf`, not per row.
  - `wgsl/timing.ts` `TAKE_WGSL`, in both branches (delays and none):

    ```
    let weights = <u32 at Col.WEIGHTS>;
    var w = <Col.WEIGHT>;
    var held = false;
    if (FADE) { w = w * blits_fade_in(...); held = true; }   // staggered branch only
    if (weights != NONE) { w = w * persub[weights + i]; held = true; }
    if (held) { w = clamp(w, 0.0, 1.0); }
    ```

- [ ] **Step 4: Run each file to verify they pass**, then the gpu unit files together on the fleet:
  `onto do --kind test -task gpu-owners-t2 -expect 3m -about "gpu unit tests after the row's weight column" -in blits-gpu-owners -- npx vitest run test/gpu-`
  — Expected: all pass (existing row tests updated only for `ROW = 21`).

- [ ] **Step 5: Commit**

```bash
git add src/gpu/columns.ts src/gpu/table.ts src/gpu/row-clock.ts src/gpu/unread.ts src/gpu/wgsl/timing.ts test/gpu-table.test.ts test/gpu-kernel.test.ts
git commit -m "fold owners' weight into a gpu voice's row, and give the row a per-subject read column"
```

---

### Task 3: Owners and once-read signals become eligible

**Files:**
- Modify: `src/gpu/weight.ts`, `src/gpu/eligible.ts`, `src/gpu/side.ts`
- Test: `test/gpu-eligible-weights.test.ts` (create), `test/gpu-engine.test.ts`

**Interfaces:**
- Consumes: `uniform`, `perSubject` (Task 1); `heard` from `src/signals.ts`; `reading` from
  `src/reading.ts`.
- Produces:
  - `weightWhy<I, O>(mix: Mixer<I, O>, voice: Voice<I, O>, refused?: WeakMap<object, string>): string | null`
    in `weight.ts`, checking in this order, with these exact sentences:
    1. voice weighted by a signal and `voice.blend !== null`: `it is a member of a blend, whose signal the CPU reads once for every member`
    2. its signal is an `input` and `mix.opts.history?.inputs`: `its weight signal is an input the mix's history records, which a seek plays back`
    3. its signal is an `input` and `!heard(signal)`: `its weight signal reads an input that does not report its changes`
    4. its signal is not uniform and `voice.keeping`: `its weight signal keeps state for each subject, which only the CPU's records hold`
    5. `refused?.get(signal)` where set (Task 5 sets it): that string
    6. walking `voice.owner` up, the first owner weighted by a signal that is not uniform: `an owner above it weighs it by a signal read per subject`
    7. such an owner's uniform signal is an input recorded by `history.inputs`: `an owner above it is weighted by an input the mix's history records, which a seek plays back`
    8. such an owner's uniform signal is an input and `!heard`: `an owner above it is weighted by an input that does not report its changes`
  - `eligibility(mix, answers, refused?: WeakMap<object, string>)`: skips voices with
    `holding !== null` before `idle`/`why`; `why` takes `mix` and `refused` and calls `weightWhy` in
    place of the two lines returning `its weight is a weight signal` and `an owner lays it out`.
    Until Task 5, `why` also returns `its weight signal is read per subject, which the gpu engine does not fold yet`
    for `perSubject(voice)`, checked after `weightWhy`; Task 5 removes it.
  - `GpuSide`: a fold is stale when `reading.inputs !== this.inputs` as well; `this.inputs` is set
    beside `frame` and `stirs`.

- [ ] **Step 1: Write the failing tests** — `test/gpu-eligible-weights.test.ts`,
  `describe('gpu eligibility of owners and weight signals')`, using `elig` from
  `test/gpu-fixtures.ts`; each reason test asserts `e.reasons.map((r) => r.why)` equals the exact
  sentence in a one-element array, and `e.channels.has('y')` false:
  - `'folds a voice an owner holds, and gives the owner no reason'`: owner, child on it; channels
    has `y`, `reasons` is `[]`, `voices` is the child alone.
  - `'folds nested owners with number and level weights'`: program `{ weight: 0.5 }`, scene
    `{ owner: program, weight: level(0.2), start: 100 }`, child; `reasons` `[]`.
  - `'folds a voice weighted by a level'`: `weight: level(0.5)`; `reasons` `[]`.
  - One test per sentence 1–4 and 6–8 above, each building the smallest mix that produces it:
    1 via `m.blend(...)`; 2 via `mix(K, { history: { ms: 1e4, tape: createHistory, inputs: true } })`
    and `weight: level(0.5)`; 3 via a hand-made `Object.assign(() => 0.5, { input: true })`
    (an input that `told` never saw); 4 via `weight: slew((c) => c.x, { riseMs: 100 })` after one
    `m.probe(cells[0])`; 6 via an owner `{ weight: (c) => c.x }`; 7 and 8 as 2 and 3 on an owner.
  - `'keeps a per-subject signal on the CPU until reads land'`: `weight: (c) => c.x` gives
    `its weight signal is read per subject, which the gpu engine does not fold yet` (deleted in
    Task 5).
  - In `test/gpu-engine.test.ts`, `'folds again after a level is set between syncs'`: the `stub()`
    device counting `queue.submit` calls; a voice weighted by `level(0.5)` on the fixture shader
    patch; `subjects`, `channel('y')`, `await side.ready`, `channel('y')` twice more: one submit
    after ready; `lvl.set(0.25)`, `channel('y')`: one more; `channel('y')` again: none more.

- [ ] **Step 2: Run each file to verify the new tests fail**

Run: `npx vitest run test/gpu-eligible-weights.test.ts`, `npx vitest run test/gpu-engine.test.ts` —
Expected: FAIL (owners refused; no refold on `reading.inputs`).

- [ ] **Step 3: Implement** `weightWhy` in `weight.ts`, the `eligibility`/`why` changes in
  `eligible.ts`, and the `reading.inputs` check in `GpuSide.channel`. Update
  `test/gpu-eligible.test.ts`'s first test, which expects `/weight signal/` for `weight: () => 0.5`:
  that signal is now uniform and folds, so it asserts `reasons` is `[]` instead.

- [ ] **Step 4: Run each file to verify they pass**, then all gpu unit files on the fleet as in
  Task 2 (`-task gpu-owners-t3`).

- [ ] **Step 5: Commit**

```bash
git add src/gpu/weight.ts src/gpu/eligible.ts src/gpu/side.ts test/gpu-eligible-weights.test.ts test/gpu-eligible.test.ts test/gpu-engine.test.ts
git commit -m "fold voices owners hold and voices weighted by a level on the gpu, and stop listing owners as refused"
```

---

### Task 4: Owner agreement on WebGPU

**Files:**
- Create: `test/gpu/kinds.ts`, `test/gpu/owners.gpu.ts`
- Modify: `test/gpu/agree.ts`, `test/gpu/stagger.gpu.ts`, `test/gpu/motion-stagger.gpu.ts`
- Modify only where a case fails: `src/gpu/*`

**Interfaces:**
- Consumes: `agree`, `make`, `Script`, `Cue`, `Handle`, `Moving`, `STAGGER`, `CELLS`, `N` from
  `test/gpu/agree.ts`.
- Produces:
  - `test/gpu/kinds.ts` exports, moved unchanged: `KINDS` (shaderPatch, wave, keys), `STACKED`, the
    `Motion` interface, `MOTIONS` (spring, tween, bounded glide) and `moving`.
  - In `agree.ts`:
    - `interface OwnerCue { start?: number; rate?: number; seek?: number; weight?: number | Signal<C>; fade?: { in?: number; out?: number }; owner?: number; span?: { duration: number } }`
      — `owner` indexes an earlier `OwnerCue`; `span` cues it with `m.span({ ...rest, duration })`.
    - `Cue` gains `owner?: number`, `start?: number`, and `weight?: number | Signal<C>`.
    - `Script` gains `owners?: OwnerCue[]`.
    - `Handle` gains a writable `weight: number`.
    - `acts[].act` takes a fourth argument, the owners' handles in `owners` order.
    - `make` cues owners first, then cues; `agree`'s `cpuVoices` keeps only `v.holding === null`,
      in cue order, so `nearEdge` pairs each with its `Cue`.

- [ ] **Step 1: Move the kinds and extend the driver.** Move `KINDS`/`STACKED` out of
  `stagger.gpu.ts` and `Motion`/`MOTIONS`/`moving` out of `motion-stagger.gpu.ts` into `kinds.ts`;
  both files import them. Extend `agree.ts` as above.

- [ ] **Step 2: Check the move changed nothing** on teitou:
  `onto do --kind test --node teitou -task gpu-owners-t4-stagger -expect 8m -about "staggered gpu agreement after moving the kinds" -in blits-gpu-owners -- npm run test:gpu stagger`
  — Expected: every test passes, as on the branch base.

- [ ] **Step 3: Write `test/gpu/owners.gpu.ts`.** Times `[1, 250, 450, 999, 1300, 2100, 4100]`
  unless a case says otherwise. Cases 1–9 run for every kind in `KINDS` and `MOTIONS` (a motion
  ignores `loop`); cases with a `stagger` run named and asked as met (`agree(d, kind, script, true)`
  and `false`), the rest named. A `LEVEL = level(1)` shared by both mixes of a case is made inside
  that case, so one `set` reaches both.
  1. `a child at its owner's start plus its own`: owners `[{ start: 300 }]`; cues
     `[{ owner: 0, start: 200 }, { owner: 0, weight: 0.5 }]`.
  2. `nested owners, as bree's program and scenes`: owners `[{}, { owner: 0, start: 400 }, { owner: 0, start: 1400 }]`;
     cues `[{ owner: 1 }, { owner: 1, start: 100, stagger: STAGGER }, { owner: 2 }]`.
  3. `an owner's rate, a ramp, and seeks forward and back`: owners `[{ start: 100, rate: 2 }]`;
     cues `[{ owner: 0, stagger: STAGGER, fade: { in: 300 } }]`; acts at 450 `o[0].ramp(0.5, 300)`,
     at 1300 `o[0].seek(200)`, at 2100 `o[0].seek(1500)`.
  4. `an owner fading in and out, its weight written`: owners
     `[{ weight: 0.6, fade: { in: 300, out: 400 } }]`; cues `[{ owner: 0, fade: { in: 200 } }]`;
     acts at 999 `o[0].weight = 0.3`, at 1300 `o[0].fade()`; times add 1500, 1700.
  5. `an owner run back past its children's starts`: owners `[{}]`; cues
     `[{ owner: 0, start: 200, loop: 3 }, { owner: 0, start: 600 }]`; act at 999 `o[0].rate = -1`;
     times add 1500, 1700.
  6. `a mix-level seek back under history`: `history: true`; owners `[{ start: 100 }]`; cues
     `[{ owner: 0, stagger: STAGGER, fade: { in: 300 } }]`; act at 2100 `m.seek(450)`, times add 2101.
  7. `a span fitting its children`: owners `[{ span: { duration: 1500 } }]`; cues
     `[{ owner: 0 }, { owner: 0 }]` with `loop: 1`.
  8. `an owner weighted by a level set between syncs`: owners `[{ weight: LEVEL }]`; cues
     `[{ owner: 0 }]`; act at 999 `LEVEL.set(0.25)`.
  9. `an owner weighted per subject stays on the CPU`: owners `[{ weight: (c) => c.id / N }]`;
     cues `[{ owner: 0 }]`; `cpuFrom: 0`.
  10. `role members under an owner` on `STACKED` only: owners `[{ start: 100, fade: { in: 300 } }]`;
      cues `[{ owner: 0, role: 'r' }, { owner: 0, role: 'r', start: 200 }]`.
  11. For `MOTIONS` only, named, `retargets while an owner's weight is 0`: owners `[{ weight: 0 }]`;
      cues `[{ owner: 0 }]`; acts at 250 `moving(kind, [0], (i) => i % 2 === 0)`, at 999
      `o[0].weight = 1`; times `[1, 250, 450, 999, 1300, 2100]`.
  12. For `wave` and `keys`, named, `an arc's enter, active and exit`: written as its own loop in
      `owners.gpu.ts` with the driver's helpers (`readBack`, `probed`, `closeNear` everywhere), on
      `m.arc({ enter, active, exit, hold: 600, blend: 200 })` with each part the kind's patch
      `k = 0, 1, 2` over `CELLS`, at `[1, 150, 350, 700, 850, 1000, 1200]`, asserting the channel is
      on the GPU at each.

- [ ] **Step 4: Run on teitou**:
  `onto do --kind test --node teitou -task gpu-owners-t4 -expect 8m -about "owner agreement on WebGPU" -in blits-gpu-owners -- npm run test:gpu owners`
  — Expected: all pass. A failure is a real disagreement: find which side of `ownedOf`, the row
  clock or a timing block differs from the CPU, fix it in `src/gpu/`, add a unit test where the
  cause is CPU-side, and run again.

- [ ] **Step 5: Commit**

```bash
git add test/gpu/kinds.ts test/gpu/agree.ts test/gpu/owners.gpu.ts test/gpu/stagger.gpu.ts test/gpu/motion-stagger.gpu.ts
git commit -m "check voices owners hold against mixer on WebGPU, every kind, nested, sought and faded"
```

(Add any `src/gpu/` fix and its unit test to the same commit, named in its body.)

---

### Task 5: Per-subject signal reads

**Files:**
- Create: `src/gpu/reads.ts`, `src/gpu/submit.ts`, `test/gpu-reads.test.ts`,
  `test/gpu/signals.gpu.ts`
- Modify: `src/gpu/side.ts`, `src/gpu/eligible.ts`, `src/gpu/weight.ts`,
  `test/gpu-eligible-weights.test.ts`

**Interfaces:**
- Consumes: `perSubject`, `weightWhy` (Tasks 1, 3); `Answers.of(voice)` (`delays`, `reach`);
  `Voice.rawAt`, `before`, `holdsFirst`, `shownAt`; `passAt` from `src/clock.ts`;
  `Mixer.capped`, `Mixer.sinceOf`; `unreadOf(…, reads)` (Task 2); `Slot.weights` (Task 2).
- Produces:
  - In `weight.ts`, exported: `KEEPS`, the sentence of `weightWhy`'s case 4 (which uses it), and
    `SENDS = 'its weight signal sends events, which only a probe on the CPU delivers'`.
- Produces, in `reads.ts`:
  - `class Reads<I>` with:
    - `readonly refused: WeakMap<object, string>` — signals that called `keep` or `send` in a read.
    - `length: number` — f32s the reads take in `persub`.
    - `clear(): void` — from `GpuSide.subjects` and `close`.
    - `read(mix: Mixer<I, unknown>, voices: readonly Voice<I, unknown>[], list: readonly I[], answers: Answers<I>): boolean`
      — reads each `perSubject` voice's signal for every registered subject that it reaches and
      that shows now, into that voice's `Float32Array(list.length)` (0 where it does not read);
      false where any signal was refused this call, so the dispatch sorts again.
    - `of(voice: Voice<I, unknown>): Float32Array | null`.
    - `place(voices: readonly Voice<I, unknown>[], from: number): (number | undefined)[]` — offsets
      in `persub`, voice order, after `from`.
    - `upload(device: GpuDevice, buffer: GpuBuffer): void` — writes every placed voice's reads.
  - The read's setting, one object per `Reads`: `timestamp = mix.now`; `elapsed` the subject's
    shown time (`shownAt(rawAt(now, delay))`, delay 0 for an unstaggered voice) and `pass` its
    `passAt`; `weight = 0`; `state = undefined`; `host = voice.setting.host`; `dt` =
    `mix.capped(now - previous)` where `previous` is the `mix.now` this `Reads` last read the voice
    at, or on its first read the subject's `mix.sinceOf(voice, delay)` where that is below `now`,
    else `now`; `keep(owner, init)` records `KEEPS` for the signal and returns `init()`
    without storing it; `send()` records `SENDS`. Neither touches `reading.kept`, a record
    or the voice.
  - Each read is stored as `NaN` → 0, `±Infinity` → `±3.4028234663852886e38`, else
    `Math.fround(x)`.
  - `submit.ts`: `submit(...)` takes what `GpuSide.dispatch` builds from `const k = b.kernel`
    through the `outputs` map (buffers, table, regions, mirrors, timings, reads, kernel, pipeline)
    and does those writes, the bind, the dispatch and the outputs; `side.ts` calls it. No behavior
    change.

- [ ] **Step 1: Write the failing unit tests** — `test/gpu-reads.test.ts`, `describe('gpu reads')`,
  a `Reads` driven directly on a `mixerOf(m)` with an `Answers` registered over 4 cells
  `{ x: 0 }, { x: 1 }, { x: 2 }, { x: 3 }`:
  - `'reads each subject once, by registration order'`: `weight: (c, s) => c.x + s.elapsed / 1000`
    at t = 250: `of(voice)` is `[0.25, 1.25, 2.25, 3.25]` (f32).
  - `'reads a staggered subject at its own time, and nothing where it does not show'`:
    `stagger: (c) => c.x * 100`, `weight: (c, s) => s.elapsed`, t = 150: `[150, 50, 0, 0]`.
  - `'reads nothing for a subject the voice does not reach'`: `target: (c) => c.x !== 1` and a
    signal counting its calls: the count is 3 and row 1 is 0.
  - `'stores NaN as 0 and an infinity as the largest f32'`: a signal giving
    `[NaN, Infinity, -Infinity, 0.5][c.x]`: `[0, 3.4028234663852886e38, -3.4028234663852886e38, 0.5]`.
  - `'refuses a signal that keeps state, and keeps nothing'`: `weight: slew((c) => c.x, { riseMs: 100 })`,
    no probe: `read` returns false, `refused.get(signal)` is `KEEPS`, `reading.kept` is
    unchanged, and `voice.subjects.size`, `voice.ownKept` are as before the read.
  - `'refuses a signal that sends'`: a signal calling `setting.send('x')`, no probe: `read` returns
    false, `refused.get(signal)` is `SENDS`, and `m.drain()` is `[]`.
  - `'gives dt as the gap since its last read'`: `weight: (_c, s) => s.dt`, reads at t = 100 and
    116: the second is 16.
  - In `test/gpu-eligible-weights.test.ts`: delete the `does not fold yet` test; add
    `'folds a voice weighted per subject'` (`reasons` `[]`) and
    `'keeps a voice whose signal a read refused on the CPU'` (`elig` with a `refused` map holding
    `SENDS` for the signal: exact sentence).

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/gpu-reads.test.ts` — Expected: FAIL, `src/gpu/reads.ts` does not exist.

- [ ] **Step 3: Split `side.ts`.** Move the submit section into `src/gpu/submit.ts` as above. Run
  `npx vitest run test/gpu-engine.test.ts` — Expected: PASS, unchanged.

- [ ] **Step 4: Implement `Reads` and wire it.** In `GpuSide`: a `Reads` beside `Timings`;
  `eligibility(mix, answers, this.reads.refused)`; `within`'s room adds `n` to `persub` for a
  `perSubject` voice; after `within` and before the mirrors' `prepare`, `this.reads.read(...)`, and
  on false `this.dispatch()` again and return (as the `unfit` path does); `unreadOf(..., this.reads.of(u))`;
  `reads.place(voices, this.mirrors.length + this.timings.length)` into each slot's `weights`;
  `persub` sized for `mirrors + timings + reads`; `reads.upload` every fold. Remove the
  `does not fold yet` reason from `why`.

- [ ] **Step 5: Run to verify the unit tests pass**: `npx vitest run test/gpu-reads.test.ts`, then
  all gpu unit files on the fleet (`-task gpu-owners-t5-unit`).

- [ ] **Step 6: Write `test/gpu/signals.gpu.ts`**, every case for every kind in `KINDS` and
  `MOTIONS` unless it says otherwise, named and asked as met where it staggers, each `LEVEL` made
  inside its case as in Task 4; times `[1, 250, 450, 999, 1300, 2100, 4100]`:
  1. `a level set between syncs`: cues `[{ weight: LEVEL }]`; act at 999 `LEVEL.set(0.25)`.
  2. `a signal reading the subject and its time`: cues
     `[{ weight: (c, s) => 0.5 + 0.5 * Math.sin(c.id + s.elapsed / 300) }]`.
  3. `staggered and fading in, read per subject`: cues
     `[{ stagger: STAGGER, fade: { in: 300 }, weight: (c) => (c.id % 5) / 4 }]`.
  4. `reads out of range`: cues `[{ weight: (c) => [NaN, Infinity, -Infinity, -0.5, 1.7, 0.3][c.id % 6] }, { weight: 0.4, fade: { in: 200 } }]`.
  5. `read per subject, reordered`: case 2 with `reorder: 999`.
  6. `read per subject under an owner weighted by a level`: owners `[{ weight: LEVEL, start: 100 }]`;
     cues `[{ owner: 0, weight: (c) => (c.id % 3) / 2 }]`; act at 999 `LEVEL.set(0.5)`.
  7. `a role member read per subject` on `STACKED`: cues
     `[{ role: 'r', weight: (c) => (c.id % 4) / 3 }, { role: 'r', start: 200 }]`.
  8. For `MOTIONS`, named: `retargets where a subject reads 0`: cues
     `[{ weight: (c) => c.id % 2 }]`; act at 250 `moving(kind, [0], () => true)`.
  9. `a slew stays on the CPU`: cues `[{ weight: slew((c) => c.id / N, { riseMs: 200 }) }]`;
     `cpuFrom: 0`.

- [ ] **Step 7: Run on teitou**:
  `onto do --kind test --node teitou -task gpu-owners-t5 -expect 8m -about "weight-signal agreement on WebGPU" -in blits-gpu-owners -- npm run test:gpu signals`,
  then the whole suite (`-task gpu-owners-t5-all -expect 15m ... -- npm run test:gpu`) —
  Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/gpu/reads.ts src/gpu/submit.ts src/gpu/side.ts src/gpu/eligible.ts src/gpu/weight.ts test/gpu-reads.test.ts test/gpu-eligible-weights.test.ts test/gpu/signals.gpu.ts
git commit -m "read a per-subject weight signal on the CPU into a gpu buffer each frame"
```

---

### Task 6: Measure per-subject reads against leaving the voice on the CPU, and keep the faster

**Files:**
- Create: `bench/gpu-harness.mjs`, `bench/gpu-reach.mjs`, `bench/runs/2026-11-0X-gpu-signal.{jsonl,txt}`
- Modify: `bench/gpu-stock.mjs`, `src/gpu/reads.ts`
- Modify only if the CPU wins: `src/gpu/weight.ts`, `src/gpu/side.ts`, `src/gpu/eligible.ts`,
  `test/gpu-eligible-weights.test.ts`, `test/gpu/signals.gpu.ts`

**Interfaces:**
- Produces:
  - `setReads(on: boolean): void` in `reads.ts` (bench only, as `setShareFrames` is): while off,
    `weightWhy` returns `its weight signal is read per subject, which costs more read for the GPU than folded on the CPU`
    for a `perSubject` voice.
  - `bench/gpu-harness.mjs`: what `gpu-stock.mjs` has besides its mixes (server, esbuild page
    build, browser, `conditions()`, the per-row loop with its progress line, the `.jsonl` append,
    `--digest`), taking the page source and row list from its caller. `gpu-stock.mjs` keeps its
    mixes and calls it; its output is unchanged.
  - `bench/gpu-reach.mjs`: `MIX=signal` and `MIX=owned` (Task 7) on rows `mixer:N`, `gpu:N`,
    `gpucpu:N` (the gpu engine with `setReads(false)`). A frame is the host's whole frame: `sync`,
    then on `gpu` every channel the side folds and a `pull` of every channel it gives null for,
    then `onSubmittedWorkDone`; on `mixer` a `pull` of every channel.
  - `MIX=signal`: the gpu-stock `full` mix with no spring, and the first `keys` voice weighted by
    `(c) => 0.5 + 0.5 * Math.sin(c.i * 0.37)`.

- [ ] **Step 1: Split the harness and add `gpu-reach.mjs` with `MIX=signal`.** Check
  `gpu-stock.mjs` still runs: `ROWS=mixer:10000,gpu:10000 FRAMES=20 WARM=5` through onto on teitou
  (`--kind bench`, `-expect 2m`) prints two progress lines and writes two records.

- [ ] **Step 2: Estimate, then measure.** Rows `gpu:100000, gpucpu:100000, mixer:100000, gpu:1000000, gpucpu:1000000, mixer:1000000`,
  `FRAMES=300 WARM=30`. From `2026-11-04-gpu-stagger.txt` (mixer 1M about 470 ms a frame, gpu 1M
  about 54 ms) the mixer 1M row takes about 160 s, `gpucpu` 1M (one channel pulled) up to that,
  the rest under 30 s each: about 6 minutes; say so before launching.
  `onto do --kind bench --node teitou --solo -task gpu-owners-signal -expect 8m -about "per-subject weight reads against the CPU at 100k and 1M" -in blits-gpu-owners -- env MIX=signal ROWS=... FRAMES=300 WARM=30 node bench/gpu-reach.mjs --out bench/runs/<date>-gpu-signal`.
  Collect the `.jsonl`, run `--digest`, and write `<date>-gpu-signal.txt` with the machine, the
  command, the mix, the progress lines and the digest, as `2026-11-04-gpu-stagger.txt` does.

- [ ] **Step 3: Decide.** Per-subject reads stay where the `gpu` median is below the `gpucpu`
  median at both 100k and 1M. Otherwise: make the `costs more` reason permanent in `weightWhy` for
  every `perSubject` voice; delete `Reads`, its wiring, `Col.WEIGHTS`, `Slot.weights` and the take's
  read multiply; change `signals.gpu.ts` cases 2–8 to `cpuFrom: 0`; and add an exact-text unit test
  for the reason, and remove `setReads` and the `gpucpu` rows with the rest.

- [ ] **Step 4: Run the gpu unit files on the fleet and, if Step 3 changed code, the signals suite
  on teitou** — Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add bench/gpu-harness.mjs bench/gpu-reach.mjs bench/gpu-stock.mjs bench/runs/<date>-gpu-signal.* src/gpu/ test/
git commit -m "measure per-subject weight reads on the gpu against folding the voice on the CPU"
```

(Body: the medians at 100k and 1M for each row and which path was kept.)

---

### Task 7: Measure owner-held voices, document, and move qualifying demos

**Files:**
- Modify: `bench/gpu-reach.mjs`, `docs/schema.html` (`#gpu`), `site/src/pages/engine.mdx`,
  `docs/superpowers/specs/2026-11-03-gpu-reach-design.md`, `HANDOFF.md` (item 18), `CHANGELOG.md`
- Create: `bench/runs/<date>-gpu-owned.{jsonl,txt}`
- Modify only where one qualifies: `site/src/live/examples/*.ts`

**Interfaces:**
- Consumes: `bench/gpu-harness.mjs` (Task 6).
- Produces: `MIX=owned` in `bench/gpu-reach.mjs`, in bree's shape: `m.owns({ name: 'program' })`;
  four scene owners `m.owns({ owner: program, start: s, name: 'scene' + k })` at
  `s = 0, 1250, 2500, 3750`; on each scene, all cued on the scene owner over every cell: a `keys`
  move on `x` and `y` of 1250 ms (no loop) with `fade: { in: 200, out: 200 }`, a `wave` layer on
  `y` looping for the scene's length (`loop: 1250 / its duration` passes), and a `keys` layer on
  `x` staggered by `(c) => (c.i % 256) * 4` with `fade: { in: 300 }`. Everything is cued before
  frame 1, as bree cues its program.

- [ ] **Step 1: Add `MIX=owned`**, and check it on teitou with `ROWS=mixer:10000,gpu:10000 FRAMES=20`:
  two progress lines, and every channel non-null on `gpu` in every frame (the page throws
  otherwise, as gpu-stock's `read` does).

- [ ] **Step 2: Estimate, then measure.** Rows `mixer:100000, gpu:100000, mixer:1000000, gpu:1000000`,
  `FRAMES=300 WARM=30` (5.5 s of mix time, covering all four scenes). Estimate from the stagger
  run: mixer 1M about 160 s, the other three under 30 s each: about 4 minutes; say so first.
  `onto do --kind bench --node teitou --solo -task gpu-owners-owned -expect 6m -about "owner-held voices in bree's shape on mixer and gpu at 100k and 1M" -in blits-gpu-owners -- env MIX=owned ROWS=... FRAMES=300 WARM=30 node bench/gpu-reach.mjs --out bench/runs/<date>-gpu-owned`.
  Collect the records, digest, and write `<date>-gpu-owned.txt` as in Task 6.

- [ ] **Step 3: Move qualifying demos.** For each site example on the gpu engine
  (`grep -l gpuDevice site/src/live/examples/*.ts`), open it headless with `?panel` on the site's
  dev server and read `eligibility(...).reasons` through the page (or the dev-mode warnings in the
  console). A demo qualifies when it held a voice on the CPU for a reason this phase lifted (an
  owner, or a weight signal), or wrote around one (a number weight it sets each frame from a
  slider standing in for a `level`, a timeline kept in the frame loop that an owner says). Rewrite
  each qualifying demo the ordinary way, so its voices fold on the GPU, and check under `?panel`
  that its mixes are listed, the panel's pause and seek move what is on screen, and the console
  shows no gpu reason. If none qualifies, say so in the commit body.

- [ ] **Step 4: Update the docs**, each in its own register (read the surrounding text first):
  - `docs/schema.html` `#gpu`: in the table's `voice` row, move owners (number, `level`, fades,
    nesting, spans, arcs) and weight signals to "folds on the GPU", and list the new reasons in
    "stays on the CPU" with their exact text; add a paragraph **Owners and weight signals** saying
    the CPU works out what owners multiply in once a frame per voice, a signal declaring no
    parameters is read once, any other is read per subject on the CPU into a buffer (or stays on
    the CPU, per Task 6's decision), and why stateful, sending, blend and recorded-input signals
    stay; a **What an owner costs** paragraph from `<date>-gpu-owned.txt`; the per-subject read's
    cost from `<date>-gpu-signal.txt`; and cut owners and signals from **Not built yet**, leaving
    readback.
  - `site/src/pages/engine.mdx`: the table row at line 74 and the reason example at line 78 (it
    quotes `its weight is a weight signal`, which no longer exists); add the owned bench row to the
    measured table with its source file.
  - The spec: status line to "phases 1–3 built (…, phase 3 <first>..<last> and the commit
    measuring it), phase 4 designed, not built"; the phase-3 section's bullets say what was built
    and point at the bench files, and record Spec conflicts 1–3 of this plan as decided
    (2026-11-04).
  - `HANDOFF.md` item 18: phase 3 built on branch `gpu-owners` with its commit range, not yet
    merged; drop phase 3 from "designed and not built"; add under "Open from phase 3" anything left
    (for instance a signal declaring no parameters but reading `arguments`, which the uniform test
    would misjudge), each one line.
  - `CHANGELOG.md` under `## Unreleased` → `### Added`: the gpu engine folds voices an owner holds
    and voices weighted by a signal, with the reasons that still keep one on the CPU named.
  - Delete this plan file in the same commit if every task is done; otherwise rewrite it down to
    what is left.

- [ ] **Step 5: Verify** on the fleet: `tsc` (`--kind typecheck`), lint (`--kind lint`), the site
  build (`--kind build`), and the unit suite (`onto test`) — Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add bench/gpu-reach.mjs bench/runs/<date>-gpu-owned.* docs/schema.html site/src/pages/engine.mdx docs/superpowers/specs/2026-11-03-gpu-reach-design.md HANDOFF.md CHANGELOG.md docs/superpowers/plans/2026-11-04-gpu-owners-and-signals.md site/src/live/examples/
git commit -m "measure owner-held voices on the gpu at 100k and 1M, and record phase 3 as built"
```
