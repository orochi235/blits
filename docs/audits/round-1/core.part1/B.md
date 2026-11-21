# Findings — core.part1

Read at HEAD 836ce269 (the brief's commit 14f899f is not in this repository).

## `within`'s error tells the host to call `around` with an option it ignores
- where: src/bound.ts:84 (checkWithin)
- scenario: a voice cued with `within` and a constant weight throws "for a hard-edged disk use weight: mix.around(ball, { steps: 1, jump: 'start' })". `around` takes `opts: { ease?: Easing }` (src/around.ts:18, src/types/mix.ts:495), so following the advice as written leaves `opts.ease` undefined and gives the default linear falloff, not a hard-edged disk. It should say `mix.around(ball, { ease: { steps: 1, jump: 'start' } })`, as site/src/pages/signal.mdx and test/around.test.ts use it. (docs/decisions.md:56 repeats the same wrong call.)
- evidence: read
- severity: low

## `steps` easing takes any step count, and 0 or a fraction gives NaN or a curve that never reaches 1
- where: src/easing.ts:142 (curve)
- scenario: `curve({ steps: 0 })` builds a curve returning `0/0 = NaN` for every u; `steps: 2.5` (jump 'end') returns `floor(u·2.5)/2.5`, which is 0.8 at u = 1, so a tween eased by it ends 20% short of its target. NaN then flows into weights and samples. Every other easing input is checked (`no easing named …`), and `curveData` packs the bad `n` for the GPU too. It should refuse a count that is not a whole number of 1 or more.
- evidence: read
- severity: low

## A fn voice whose first calls come from a lane never has its returned keys checked against `writes`
- where: src/fill.ts:505 (call)
- scenario: `contribution` calls `checkWrites` on the first delta a voice's `at` returns (src/contribution.ts:180), warning outside production of a key the patch does not declare, which the mix silently drops. The lane path's `call` makes the same `voice.patch.at` call and never checks. For a lane that took every subject (`lane.every`) or a probe's meeting fill, the first call is the lane's (src/fill.ts:381-386), so a patch returning `{ x, opacty }` with `writes: ['x', 'opacity']` played that way drops `opacty` with no warning, where the same voice read on the general path warns. One decision, answered in one place only.
- evidence: read
- severity: low

## Files read
src/affine.ts
src/ahead.ts
src/arcs.ts
src/around.ts
src/asked.ts
src/axes.ts
src/bare.ts
src/bind.ts
src/bits.ts
src/blank.ts
src/blend-modes.ts
src/blend.ts
src/book.ts
src/bound.ts
src/chain.ts
src/changes.ts
src/channels.ts
src/clock.ts
src/clone.ts
src/closed.ts
src/color.ts
src/columns.ts
src/contribution.ts
src/copyout.ts
src/crowd.ts
src/cue.ts
src/cut.ts
src/delay.ts
src/departed.ts
src/describe.ts
src/drivercheck.ts
src/drop.ts
src/due.ts
src/easing.ts
src/everyone.ts
src/extremes.ts
src/fade.ts
src/filed.ts
src/fill.ts
src/fit.ts
src/fling.ts
src/fold.ts
src/frames.ts
src/gather.ts
src/gone.ts
src/gpu.ts
src/grid.ts

<!-- done: 3 findings, files read: 47 -->
