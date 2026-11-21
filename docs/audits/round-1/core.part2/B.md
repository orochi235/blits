I read all 47 files in the area and found 4 defects. Writing to `.skulkr/out/findings.md` was refused (the `mkdir` and the `Write` both asked for permission and weren't granted), so here is the whole document instead, as the brief allows.

# Findings: core.part2, round 1

## The `in` mark ignores reduced motion, while `out`/`end` and arcs honor it
- where: src/marks.ts:140 (markOf)
- scenario: A mix with `reduce: true` has a voice with `fade: { in: 500 }` and duration 100. Under reduce the fade in is skipped (src/clock.ts:77, `fadeIn > 0 && !reduced`), so the voice is at full weight from its start. Its `end` is `start + 100`, because line 170 drops the out fade under `mix.reduced`. But `markOf(mix, voice, 'in')` still returns `start + 500`. So `marks()` lists `in` 400 ms after `end`, and a booker waiting on `in` fires after the voice has gone. Arc marks zero their blend under reduce (src/arcs.ts:171, 205). This path should return `start` under reduce.
- evidence: read
- severity: medium

## `in` and `end` anchors subtract fade lengths that reduced motion doesn't play
- where: src/place.ts:175-181 and src/place.ts:191 (place)
- scenario: Under `reduce: true`, a voice is placed with `anchor: { end: { after: 'x' } }` and `fade: { out: 300 }`. `place` sets `outAt = m - 300`. Under reduce, `beginFade` uses `over = 0` (src/fade.ts:211) and `envelope` returns 0 as soon as the fade begins (src/clock.ts:83). So the voice vanishes 300 ms before the anchored end, and `markOf(..., 'end')` reports `m - 300`, not `m`. In the same way, `anchor: { in: ... }` starts the voice `fade.in` ms early, at full weight, because the fade in it makes room for is skipped. Both subtractions should be 0 under `mix.reduced`, as every fade length in fade.ts is.
- evidence: read
- severity: medium

## `recordInput` overwrites a value in place when mix time stands still, and keeps the older frame's `seq`
- where: src/history.ts:247-249 (recordInput)
- scenario: History is on with `inputs`, and rate 0 holds mix time at `t` across frames 10 and 11. Frame 10 reads 0.2 and records `{ at: t, seq: 10, value: 0.2 }`. Frame 11 reads 0.8. Because `prev.at === mix.now`, it sets `prev.value = 0.8` but leaves `seq: 10`. A read back or seek cut at frame 10, or that record paged to a store under seq 10, now holds 0.8, a value frame 10 never read. `Paged.seq` is documented as the key "since rate 0 holds mix time still across frames", and `recordHost` (line 223) deduplicates by `seq`, not `at`. So this is one question answered two ways.
- evidence: read
- severity: low

## Past voice clocks stop being recorded after 256, which misplaces later subjects' origins
- where: src/origin.ts:22 (leave), consumed by src/origin.ts:70 (originOf)
- scenario: A voice with a `stagger` over many subjects has its rate driven from a slider through the handle, one `ramp`/`retime` per frame. Each write calls `leave`, and once `voice.clocks.length >= MOST` (256, about 4 s at 60 fps) new clocks are silently dropped. A subject whose delay ran out during a dropped clock then gets its `since` from `timeWith(voice, elapsed)`: the current clock extrapolated backward at its current rate. That is not where the voice's clock actually read that elapsed time. The result is a wrong fade-in start for every subject probed or reoriginated after that point, and a wrong step origin for stateful patches. The bound keeps the oldest clocks and drops the newest, which are the ones still-early records are most likely to need.
- evidence: read
- severity: low

## Files read
src/grow.ts
src/handle.ts
src/held.ts
src/history.ts
src/hosts.ts
src/index.ts
src/keyfill.ts
src/keyrows.ts
src/lane.ts
src/lanes.ts
src/lch.ts
src/lean.ts
src/leaps.ts
src/leavings.ts
src/lives.ts
src/marks.ts
src/meet.ts
src/mixer.ts
src/motion.ts
src/motions.ts
src/move.ts
src/moved.ts
src/named.ts
src/nearly.ts
src/now.ts
src/numbers.ts
src/oklab.ts
src/onseek.ts
src/origin.ts
src/owed.ts
src/owner.ts
src/pace.ts
src/pack.ts
src/paging.ts
src/patch.ts
src/place.ts
src/placed.ts
src/places.ts
src/plot.ts
src/project.ts
src/pull.ts
src/qualify.ts
src/reading.ts
src/record.ts
src/relink.ts
src/renumber.ts
src/restored.ts

<!-- done: 4 findings, files read: 47 -->