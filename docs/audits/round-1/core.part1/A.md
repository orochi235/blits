I couldn't write `.skulkr/out/findings.md`: the Write tool and `mkdir` both needed approval and were refused. Here is the whole document instead.

# Findings: core.part1

## fling's release sample defeats track's `stop`, so a pointer held still before release still flings
- where: src/fling.ts:198-203 (fling, `up`), with src/fling.ts:53-58 (track.velocity)
- scenario: Drag fast, then hold the pointer still for 60 ms and release. That is longer than the default `stop` of 40 ms and shorter than `ms` 100, and no pointermove fires while the pointer is still. `up` calls `move(e)`, which adds a sample at `e.timeStamp`, and then asks for `path.velocity(e.timeStamp)`. The latest sample is now the release itself, so `(at ?? last) - last` is 0 and the `stop` test can never pass. The moving samples are still inside the 100 ms window, so the least-squares slope is nonzero and the subject is pushed at a nonzero velocity. The `stop` option is documented as "How long a pointer can sit still before letting go and still fling", so it should come to rest. The only `stop` test (test/fling.test.ts:20) exercises `track` alone, not the fling release path that commit f5634e1d added.
- evidence: read
- severity: medium

## A fade's `over` is never validated, while a rate ramp's is, so `fade({ over: NaN })` leaves a voice fading for good at NaN weight
- where: src/fade.ts:211 (beginFade), src/fade.ts:43 (fadeSubject), src/fade.ts:289 (beginRise), src/fade.ts:327 (fadeAt)
- scenario: `handle.fade({ over: dist / speed })` with `dist = speed = 0` gives `over = NaN`. `beginFade` stores it: `over === 0` is false, so the voice is not retired. Then `envelope` computes `clampWeight(1 - (now - at) / NaN)`, which is NaN. NaN is not `<= 0`, so the fold applies the delta at NaN weight, and a sum channel's pose goes NaN. `dueOf` returns `out.at + out.over`, which is NaN, so the voice is scheduled every frame and never retires. A negative `over` is not refused either, and cuts the voice off at full weight. The other ramp length is refused: `rampTime` throws for a rate ramp (handle.ts:151, transport.ts:475, added in 7c3cf531). A fade should take a finite `over` of 0 or more the same way.
- evidence: read (that `moveTo` never retires a NaN end is inferred from `dueOf` and `envelope`)
- severity: medium

## `restsAt`/`near` never match a typed-array value, so `fade({ at: 'rest' })` never finishes on a typed-array channel, and `bound` never clamps one
- where: src/fold.ts:24-34 (near, restsAt), src/fold.ts:119-128 (bound)
- scenario: The code supports a channel whose rest is a `Float32Array` or another view: cue.ts:190 branches on `ArrayBuffer.isView(rest)`, and clone.ts copies views (b512a0fe). Take a voice writing such a channel and call `fade({ at: 'rest' })` on it. `contribution` asks `isRest(delta)`, which calls `near(value, channel.rest)`. `Array.isArray` is false for both, so it falls through to `a === b`, which is false unless the patch returns the very rest object. The voice never reads as rested and stays fading forever. Likewise, `bound()` only clamps `number` and `Array.isArray` values, so a bounded typed-array channel leaves the fold unclamped.
- evidence: read
- severity: medium

## A dry read of a bounded voice weighs the signal outside the bound, where the live read uses 0
- where: src/contribution.ts:467-484 (read, dry path), compared with src/contribution.ts:75-118 (contribution)
- scenario: Take a voice with `within` and a `step`, so `contribution` does not return early outside the bound. Probe a subject outside the bound, then run a dry fold in the same frame. `contribution` set the weight to `outside ? 0 : this.weigh(...)`, but the dry path calls `this.weigh(voice, subject, now, held)` without checking `inBound`. The dry fold therefore folds the delta at the signal's own weight wherever the signal is above 0 just outside the ball or finder. That is the case bound.ts's `check` warns about, so the two paths answer one question differently. The dry path also calls a signal the bound declares not to be read there.
- evidence: read
- severity: low

## `steps` and `bezier` easings are not validated: `{ steps: 0 }` gives NaN, and a bezier x outside 0..1 is solved wrongly
- where: src/easing.ts:141-156 (curve, steps), src/easing.ts:37-75 (bezier)
- scenario: `curve({ steps: 0 })` returns `Math.floor(c * 0) / 0`, which is `0 / 0`, so NaN for every `u`. A non-integer or negative `n` gives values outside the CSS steps shape. The NaN flows into tween and keys values, and the packed `[2, n, …]` goes to the GPU as is. A `bezier` with `x1` or `x2` outside 0..1, which CSS rejects, makes `x(t)` non-monotonic, and the bisection fallback (which assumes monotonic x) returns an arbitrary crossing. Nothing throws, unlike every other option in this area, which raises a RangeError.
- evidence: read
- severity: low

## `expireGone` spreads the kept voices into `splice`, which throws past the engine's argument limit
- where: src/gone.ts:126 (expireGone)
- scenario: Under history with a large `slack`, the front segment `end` can hold a very large number of gone voices whose `reachedTo >= reach`. That happens when a long-lived voice was listed ahead of many short ones, and gone.ts's own comment says a churning mix holds thousands. `list.splice(0, end, ...kept)` passes every kept voice as an argument. Past V8's argument limit (on the order of 10⁵), it throws `RangeError: Maximum call stack size exceeded` from inside a sync. `keepGone` builds a new array instead and has no such limit.
- evidence: read (the limit is the engine's, not measured here)
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

<!-- done: 6 findings, files read: 47 -->