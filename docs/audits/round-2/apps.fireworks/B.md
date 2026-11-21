## Sparks age on frame gap × `m.rate`, not on mix time, so the panel's pause and any hold leave them moving
- where: apps/fireworks/src/main.ts:89-92 (frame)
- scenario: Open with the panel (dev), press pause in it. The panel's `Hold` sets `hold.rate = 0`, which by `src/types/watch.ts:160-170` "is not recorded … in the mix's rate", so `m.rate` still reads 1. `dt = gap * m.rate` stays a full frame, and `sky.render(dt / 1000)` keeps aging and moving every spark already in the air (gravity, fade) while the mix clock stands still and the quarks driver (which owes for mix time) emits nothing. The same split happens with a hold at any other rate, and during a `ramp`, where `m.rate` is the end-of-frame rate rather than the frame's integral. Should be: the sparks age by the mix time that passed this frame (the delta of `m.now` across `sync`), so the mix's clock is the demo's clock, as CLAUDE.md requires. The README's line "the quarks driver takes the frame's gap in mix time" also no longer matches `sparks.write()`, which takes nothing.
- evidence: read
- severity: medium

## "Keep launching" times launches on the frame loop's own wall clock, and keeps launching while the mix is paused
- where: apps/fireworks/src/main.ts:84-87 (frame)
- scenario: `next` is a `performance.now()` deadline the frame loop keeps, divided by `Math.max(m.rate, 0.1)`. When the panel pauses the mix (hold rate 0, `m.rate` unchanged at 1), shells keep being cued every 0.35–1.25 s of wall time into a clock that doesn't move. They pile up at the same mix time, all six whistles get borrowed, and when the user resumes they all rise and burst at once. The slider at its minimum, 0.1, also launches ten times sparser in wall time, though the clamp is only there to avoid dividing by zero. CLAUDE.md says the frame loop syncs, probes and draws, and ordering/timing are cues. Should be: the launch cadence runs on the mix (for example, a cued/looping voice or times measured in mix time), so pause, seek and speed in the panel govern it.
- evidence: read
- severity: medium

## The mix has no `history`, so the panel can't seek the demo
- where: apps/fireworks/src/main.ts:29-32 (mix options)
- scenario: `mix(KIT, { name, labelOf })` passes no `history`. The panel is mounted in dev "so the mix can scrub back" (comment at line 25), but without `history` with a tape, `Hold.reach` is `now` (`src/types/watch.ts:172`) and seeking back throws or does nothing. CLAUDE.md: "Give the mix `history` anyway, so the panel can seek it." Should be: pass `history: { tape: … }`.
- evidence: read
- severity: medium

## Clicking "Start the show" twice before `Tone.start()` resolves starts the show twice
- where: apps/fireworks/src/main.ts:36-37, 94 (start click handler)
- scenario: `start.hidden = true` runs only after `await Tone.start()` and all the setup. A second click (a double click, or a click while the audio context is slow to resume) runs the handler again: a second `createSounds()` graph, a second `driveSound` on the same mix, duplicate launch/canvas/rate listeners (so each Launch click or sky click cues two shells), and a second `requestAnimationFrame` loop that syncs `m` twice per frame and runs auto-launch twice. Should be: disable or hide the button (or use `{ once: true }`) before the await.
- evidence: read
- severity: medium

## Overlapping shells share one panner, so a later bang re-pans an earlier one still sounding
- where: apps/fireworks/src/sound.ts:34, 46, 63, 68 (createSounds / play)
- scenario: Every bang goes through one `bangPan`, and every crackle through one `cracklePan`. A bang decays over about 0.6–0.7 s, and the crackles run for about 0.8 s. When shell A at x = -6 bangs and shell B at x = +6 bangs 200 ms later (often with auto-launch, and always with two quick clicks), `setValueAtTime(panOf(B), at)` jumps A's still-ringing rumble/thump tail from hard left to hard right. A's remaining crackles and B's also alternate the shared crackle panner. Should be: each sound placed at its own shell's pan for its whole duration, as the README claims ("pans the sound by where it is").
- evidence: read
- severity: low

## Files read
apps/fireworks/src/app.css
apps/fireworks/src/main.ts
apps/fireworks/src/show.ts
apps/fireworks/src/sky.ts
apps/fireworks/src/sound.ts

<!-- done: 5 findings, files read: 5 -->
