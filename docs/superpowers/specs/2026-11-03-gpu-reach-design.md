# The gpu engine's reach: stock patches, per-subject timing, and readback

**Status (2026-11-04): phases 1 and 2 built (phase 1 d20940c..21dc031, phase 2 4cad824..ff1cc94 and
the commit measuring it), phases 3–4 designed, not built.** What phases 1 and 2 left open is under
item 18 of `HANDOFF.md`, and the schema page's "The gpu engine" says what folds now. This line changes as phases land; the doc is deleted once the last one does, after
anything durable has moved into the schema page and the changelog.

For whoever builds or reviews the next phase of `@msb235/blits/gpu`. It answers: what has to change
for most of a real mix to fold on the GPU, and in what order.

## Why

blits' mandate is to blend volumes of numbers efficiently with no upper limit (the owner, 2026-11-03;
the handoff has recorded "fast and capacious as possible, not a target" since 2026-10-02). The CPU path
has a floor of about 110–140 ns per probe, and a frame of 100k subjects × 8 voices costs 33 ms in the
best CPU layout, against 0.36 ms on the GPU (`spikes/gpu-engine/README.md`, measured 2026-10-01). The
gpu engine shipped in 0.18.0, but it folds only voices whose patch is a hand-written `shaderPatch`,
with a number weight, no stagger, no owner, no state and every registered subject. blits' own
vocabulary (`keys`, `wave`, `tween`, `spring`, `glide`) never reaches it, so in practice nothing a
host writes the ordinary way does.

## Goals

A voice reaches the GPU without being rewritten for it. In order:

1. **Stock patches.** `wave`, `keys`, `tween`, `spring` and `glide` voices fold on the GPU.
2. **Per-subject timing and reach.** A voice that staggers its subjects, or reaches only some of
   them (`subjects`, `target`), folds on the GPU.
3. **Owners and weight signals.** A voice an owner lays out, or weighted by a signal, folds on the GPU.
4. **Readback.** A host that reads poses in JS can take a channel's values from the GPU.

Each phase lands, is measured, and is released on its own.

## Non-goals

- A GPU engine replacing `mixer`. The gpu engine stays a parallel evaluator beside the stock mixer,
  as decided 2026-11-02; every CPU path (`probe`, `pull`, `project`, `seek`, history) keeps working
  through the CPU, and is what the GPU is checked against.
- `fn` patches. Opaque JS cannot run on the GPU; `shaderPatch` remains the way to write a custom one.
- Patches with `state`/`step`, `keep`, `send`, bounded voices (`bound`), parting voices. They stay on
  the CPU, with the reason said once, as now.

## Anti-goals

- **A GPU fold that disagrees with the CPU.** Every new path is held to the same twin check as shader
  patches: the WebGPU agreement tests (`test/gpu/*.gpu.ts`, `npm run test:gpu` on teitou) compare
  every subject against `mixer` at several times, and the engine's development-mode sample check
  stays on. f32 tolerance only; a wrap or a branch that lands differently is a bug.
- **A second copy of the timing rules.** Clock math (`frozenTime`, `phaseAt`, `passAt`,
  `phaseBefore`, the fade envelope), easing (`src/easing.ts`) and the motion laws
  (`src/closed.ts`) exist once in TS. Their WGSL ports live in `src/gpu/wgsl/` beside each other, are
  each pinned to the TS function by an agreement test, and the TS stays the definition.
- **Breaking the lean bundle.** None of this is reachable from `@msb235/blits` or
  `@msb235/blits/lean`; only `@msb235/blits/gpu` imports it.

## Constraints

- Time on the GPU is f32. A mix time in ms loses whole-ms precision after about 4.6 hours, so every
  time the GPU reads is relative to a base the CPU picks (the frame's `now`, or the voice's
  anchor), never an absolute mix time.
- One kernel is cached per (shader set, folded channels, subject count), as now. A change to a
  voice's data must not recompile; only a new kind of thing to run may.
- The core keeps zero dependencies and no DOM types (`src/gpu/webgpu.ts` declares the slice it uses).
- Source files stay a few hundred lines; `kernel.ts` and `side.ts` split by responsibility before they
  grow past that.

## Decided

- **Stock patches run as built-in WGSL interpreters, one per patch kind, reading their data from
  buffers** (my call, 2026-11-03). Not WGSL generated per patch: a mix may hold a `keys` patch per
  voice, and generating code per patch would compile a kernel per new patch. A kind's interpreter is
  added to the kernel once any voice of that kind plays; its per-voice data (stops, curves, depths)
  goes in the `values` buffer as a shader patch's parameters do today.
- **Per-subject data lives in one new storage buffer** of per-voice regions (stagger delays, a reach
  mask, motion runs), each voice's row in the table giving its region's offset (my call).
- **The CPU works out what is the same for every subject; the GPU works out the rest** (my call). A
  voice's row keeps its shared clock reading (elapsed time, rate, flags, fade-out); the kernel applies
  each subject's delay and runs the per-subject part of the clock and the fade-in.
- **The gpu engine answers `stagger` and `target` for every registered subject up front, in a side
  table, not by meeting them** (my call). On the CPU those are asked at a subject's first probe, and
  creating a `held` record per subject per voice at 1M × 8 is the cost the GPU exists to avoid. The
  side table holds the answers per voice in registration order; `held()` takes a subject's answer from
  it when the CPU does meet one, so the two sides agree on every value, while what counts as "met"
  (watch, `knows`) stays what the CPU probed. Calling `subjects()` again rebuilds the table; records
  already made keep their answers, as the CPU keeps them today.
- **A subject's fade-in origin comes from the CPU, not the GPU** (my call). `originOf` walks a voice's
  past clocks (rate changes, ramps, seeks) and its owners, so recomputing it on the GPU from the current
  clock would disagree after a seek. For a staggered voice the CPU works out each registered subject's
  origin (`since`, `shownOf`) from its delay and uploads it per subject, again only when the voice's
  clocks change (`reorigin`'s triggers).
- **Motion changes are committed by the upload, at the time a live sample would commit them** (my
  call). An untimed `.to()`/`.set()`/`.push()` waits for a live `Motions.sample`, which a host reading
  only GPU buffers never makes. Before each dispatch, the gpu side commits the frame's pending changes
  for registered subjects at the voice's time (each subject's own time where it staggers), then mirrors
  the runs that changed. A change timed ahead stays on a due list and is committed in the frame it
  falls due. A landed run needs no upload: the closed form holds its goal past the end.
- **Near a branch, f32 may land on the other side; that is tolerated within one f32 step and nowhere
  else** (my call). A square wave's half, a `steps` easing, which `keys` segment a phase falls in and
  a loop's wrap all branch on a time computed in f32. The agreement tests accept a GPU value that
  matches the CPU evaluated at the subject's time moved by one f32 step either way, and fail anything
  else. Precomputing every subject's phase on the CPU would make it exact and give back most of the
  gain, so it is not done.
- **Color stops lerp in the channel's own space on the GPU** (my call). `readKeys` interpolates stops
  with the channel's `lerp` (OKLab, hue the short way), which is not linear in the numbers the fold
  takes. Each color rule gets a WGSL port of its stop `lerp`, pinned to the TS by a test, beside its
  fold.
- **Readback is a separate read, not a change to `pull`** (my call). `gpuOf(m).read(channel)` resolves
  with that channel's values for the registered subjects in registration order, from the previous
  frame, double-buffered so it never waits on the frame being folded. `pull` and `probe` stay on the
  CPU with their side effects (meeting subjects, watch, trace, poses kept for `from: 'current'`). This
  replaces an earlier idea of a `pull` that reads the GPU: `pull` takes any subjects in any order and
  mixes channels, which would have meant a pose half from last frame's GPU and half from this frame's
  CPU.

## The phases

### 1. Stock patches

| Kind | Per-voice data | Per-subject data | WGSL |
|---|---|---|---|
| `wave` | shape, cycles, start, a depth and rest per channel | none | `waveAt`, then rest + depth · unit |
| `keys` | the built stop list (`src/patch.ts` `build`, read by `readKeys`): each channel's stops, per-stop easing as curve coefficients, `delayBy`/`easeBy` | none | locate the segment, ease, lerp by the channel's rule |
| `tween`, `spring`, `glide` | the law (`src/closed.ts`) | the subject's run from `Motions` (release time, flags, ms, `x0`, `v0`, `to` per axis) | the closed form per law |

- Color `keys` stops (hex strings, `oklab()` values) are converted to the numbers the color channel's
  fold takes, on the CPU, when the patch's data is packed.
- A motion's runs are mirrored into the per-subject buffer in GPU subject order. `Motions` records
  which subjects changed since the last upload (`set`, `to`, `push`, landing), and only those runs are
  written each frame. A retarget-heavy frame (the heatmap's 3,000 `.to()` calls) writes 3,000 small
  ranges, so the builder measures one coalesced write against many and takes the faster.
- `from: 'current'` stays on the CPU in this phase (it reads the pose a voice starts from).
- **Per-voice tables for `shaderPatch`** (asked for by bree, 2026-11-03). A shader patch declares named
  read-only f32 tables, each with a width and height; `with` gives their contents per voice, as it
  gives parameters; WGSL reads `table_<name>(x, y)`, which returns 0 out of range, and `at` gets the
  same tables as a lookup with the same rule, so the twin check holds. bree's moves look a message
  bitmap up at a shifted position and a row map (a width-1 table) at a shifted row, so a patch
  declares any number of tables. Sizes run from about 7 × 40 to a few hundred × a few thousand per
  voice. They go in the per-voice region `keys` stops use, so this falls out of the same buffer work.

### 2. Per-subject timing and reach

- `stagger` is called once per registered subject per voice at registration or cue, as above, and its
  delays uploaded. That covers bree's per-dot phase offsets (the `rank` an order gives each subject),
  once written as a stagger. The kernel computes the subject's raw time as the voice's elapsed time less its
  delay, then the CPU's `before`, `shownAt` (`frozenTime`), `phaseAt`/`passAt`/`phaseBefore` and the
  fade-in from `since`/`shownOf`, from flags and constants the row carries.
- A voice reaching some subjects gets a bit mask over the registered list (`subjects`, or `target`'s
  answers per registered subject).
- The gpu side never moves when a voice ends: it neither raises `voice.latest`, lowers
  `voice.soonest` nor reschedules a voice (ruled 2026-11-04). Where a voice names its subjects, the
  CPU knows every delay at cue and has already decided its end. Where its stagger is asked as
  subjects are met, the CPU's end depends on which subjects were read, so a voice with a finite span
  stays on the CPU ("its stagger is asked as subjects are met, so when it ends depends on which were
  read"), and so does one that is not beginless with a negative delay.

### 3. Owners and weight signals

- An owner's timing is shared by its children's subjects except where the owner itself staggers or
  carries a per-subject signal. The CPU reads the owner chain once per voice per frame into the row; an
  owner with per-subject parts keeps its voices on the CPU until a later phase, said once.
- A weight signal read the same for every subject is sampled once on the CPU into the row. A signal
  read per subject is evaluated on the CPU into a per-subject weight array uploaded each frame; the
  builder measures whether that beats leaving the voice on the CPU and keeps whichever wins.

### 4. Readback

- `GpuSide` copies the folded channels into a mapped buffer, double-buffered, and
  `gpuOf(m).read(channel)` resolves with the previous frame's values. The spike measured this at 0.23 ms for 100k × 8 in
  Dawn under Node; a browser adds its own IPC, so the builder measures it in Chromium on teitou.

## How each phase is checked

- WebGPU agreement tests per kind and per timing feature, in the style of `test/gpu/rules.gpu.ts`:
  every subject, several times, fades, roles, loops, past the end. They run on teitou:
  `onto do --kind test --node teitou -- npm run test:gpu`; `onto test` leaves them out.
- Unit tests for the packing (what goes in each buffer) run with the ordinary suite.
- A bench row per phase in `bench/` that times the same mix on `mixer` and on `gpu` at 10k, 100k and
  1M subjects, recorded under `bench/runs/` with each run's raw records.
- The site's gpu demos move to stock patches where a stock patch says the same thing, so the demos
  show the ordinary way of writing a voice.

## Left to the builder

- The buffer layouts, and whether per-subject regions are packed by voice or by subject.
- How the kernel's interpreters are selected (a switch on kind, as shader patches are now, or one
  pass per kind).
- Workgroup size and dispatch shape at 1M subjects.
- Where `Motions` keeps its changed set, as long as the CPU path pays nothing for it when no gpu engine
  is attached.
