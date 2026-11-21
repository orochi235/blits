I couldn't write `.skulkr/out/findings.md` (permission denied), so the whole document is below. The tree's HEAD is 836ce269, not the 0d1aa23 named in the brief, and no commit in the last week touched the presets.

## crossfade's `warm` weight wraps `level("mix")` in a plain arrow, so blits no longer sees it as an input
- where: apps/playground/src/blits/presets/crossfade.ts:19 (voice `warm`, `weight`)
- scenario: `warm`'s weight is `(s, set) => 1 - level("mix")(s, set)`. `compileIn` (expr.ts:93) marks its result as an input only where the wrapped function is one. Here that function is the author's own arrow, so `marked` (src/signals.ts:23) returns it unmarked. `cool`'s weight, `level("mix")`, is the level itself and stays an input. The mix runs with `history: { inputs: true }` (compile.ts:70), which records only input weight signals (src/subject.ts:119). So once the `mix` slider has moved, a seek or `project` back replays `cool`'s recorded weight but computes `warm`'s from the slider's current value. The two weights no longer sum to 1, and a scrub shows a different crossfade from the one that played. Also, a slider change made while the clock stands still reaches `cool`'s lane through `touch` but doesn't reach `warm` until the clock moves. Two voices in one crossfade end up handled two different ways.
- evidence: read (expr.ts:82-95, src/signals.ts:16-26 and 93-100, src/subject.ts:119-122, compile.ts:70)
- severity: medium

## blend's `tone` signal wraps `level("slide")` in a plain arrow and loses its input mark the same way
- where: apps/playground/src/blits/presets/blend.ts:30 (`blends.tone`)
- scenario: `(s, set) => Math.min(1, Math.max(0, s.x + level("slide")(s, set)))` goes through `compileExpr` (cueGroups.ts:182). The arrow it wraps isn't an input, so neither is the resulting signal. `mix.blend` derives every member's weight from this signal, so `history: { inputs: true }` records none of them. A seek or `project` back past a move of `slide` reads the slider's current value, not the value played at that time. A `slide` change while the clock stands still doesn't refill the lanes either.
- evidence: read (cueGroups.ts:182, expr.ts:82-95, src/signals.ts:16-26)
- severity: medium

## logo's halo is always on, but the rail's halo shows only while the logo is hovered
- where: apps/playground/src/blits/presets/logo.ts:84 (voice `halo`, `weight`)
- scenario: the docstring calls this preset "the site's rail logo as voices", including "a halo following the pointer". On the site (site/src/live/logo.ts:127-136), the halo voice sits under an owner weighted `slew(near, { riseMs: 150, fallMs: 500 })`. `near` is set on pointerenter/leave and focus/blur, so the halo stays dark until the logo is hovered. The preset weights `halo` by `around(5, …)` alone. The playground's `Pointer` starts at the stage's center and keeps its last position (pointer.ts:16-29). So with `hover` at 0, a lit halo sits in the middle of the sign from the first frame and stays wherever the pointer last was.
- evidence: read (site/src/live/logo.ts:127-146, pointer.ts:16-29)
- severity: low

## Files read
apps/playground/src/blits/presets/anchors.ts
apps/playground/src/blits/presets/backward.ts
apps/playground/src/blits/presets/blend.ts
apps/playground/src/blits/presets/bounded-glow.ts
apps/playground/src/blits/presets/crossfade.ts
apps/playground/src/blits/presets/fold-rules.ts
apps/playground/src/blits/presets/freeze-handover.ts
apps/playground/src/blits/presets/index.ts
apps/playground/src/blits/presets/logo.ts
apps/playground/src/blits/presets/marks-hits.ts
apps/playground/src/blits/presets/owner-fade.ts
apps/playground/src/blits/presets/pointer-glow.ts
apps/playground/src/blits/presets/span-fit.ts
apps/playground/src/blits/presets/spring-retarget.ts
apps/playground/src/blits/presets/stagger-wave.ts

<!-- done: 3 findings, files read: 15 -->