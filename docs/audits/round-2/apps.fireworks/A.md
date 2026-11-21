# apps.fireworks findings

Note: commit 0d1aa23ae22834c481f05bd51a4972ebae74778d is not in this clone; I read the working tree at HEAD 836ce269, where `apps/fireworks` has no local changes.

## Sparks age on a wall-clock gap times `m.rate`, not on the mix's clock, so a panel pause, a hold rate, or a seek doesn't reach them
- where: apps/fireworks/src/main.ts:78-92 (start click handler, `frame`)
- scenario: the panel holds the mix (`Hold.rate = 0`, or 0.25, or a seek back). A hold leaves `m.rate` alone (src/types/watch.ts:159-175), so `dt = gap * m.rate` stays at full speed. The quarks driver measures mix time since its last write and stops emitting, but `sky.render(dt / 1000)` keeps every spark already in the sky falling and fading at 1×. A seek back doesn't bring sparks back. The demo keeps a second clock for the same question ("how much show time passed this frame") that the quarks driver already answers from `m.now`. It should age the sky by the frame's `m.now` delta. This breaks the CLAUDE.md rule "the mix's clock is the demo's clock" and its "Check it in the panel" rule, which says the panel's pause and seek should move what's on screen.
- evidence: read
- severity: high

## Auto-launch is timed on `performance.now()` in the frame loop, so it keeps launching while the panel holds the mix paused
- where: apps/fireworks/src/main.ts:84-87 (`frame`)
- scenario: with "keep launching" checked, the panel pauses the mix with hold rate 0. `now >= next` still fires every 350–1250 ms of wall time, divided by `m.rate`, which a hold doesn't change. Each launch cues a shell at the frozen mix time, so frozen shells pile up for as long as the pause lasts, then all go up together on resume. When the panel steps or seeks, the launch schedule doesn't follow. Launch timing is motion kept in frame-loop math on the demo's own clock, which CLAUDE.md rules out ("Motion is voices, not frame-loop math"; "nothing else keeps time").
- evidence: read
- severity: medium

## Without the in-page panel the mix has no `history`, so the DevTools extension can't seek it
- where: apps/fireworks/src/main.ts:27-32 (module top level, `mix(...)` options)
- scenario: `mix(KIT, { name, labelOf })` passes no `history`. History comes only from the registry default that `mount()` installs (src/watch.ts:91-98), and `mount()` runs only in dev without `?nopanel`. Open the page with `?nopanel`, the path the comment names "for the DevTools extension alone", or open a production build. The mix then reports `history: null`, and a seek back from the extension can't reach any earlier time. CLAUDE.md: "Give the mix `history` anyway, so the panel can seek it."
- evidence: read
- severity: medium

## A double-click on "Start the show" builds two sound graphs, two drivers and two frame loops
- where: apps/fireworks/src/main.ts:36-95 (start click handler)
- scenario: `start.hidden = true` runs only after `await Tone.start()` and the whole setup. A second click that lands while the first is still awaiting the audio context runs the handler again. That makes a second `createSounds()` (six more running oscillators), a second `driveSound` booker on the same mix, so every bang and crackle sounds twice, and duplicate launch, canvas and rate listeners, so one click launches two shells. It also starts a second `requestAnimationFrame` loop that calls `m.sync` and auto-launches again. The button should be disabled, or the listener registered `{ once: true }`, before the await.
- evidence: read
- severity: medium

## Overlapping bangs share one panner and one mono NoiseSynth and MembraneSynth, so a second shell moves the first's ringing tail to its own side
- where: apps/fireworks/src/sound.ts:34-44, 60-65 (`createSounds`, `play`)
- scenario: two shells bloom within the 0.6–0.7 s bang decay, one at x = −6 and one at x = +6. The second `bangPan.pan.setValueAtTime(panOf(shell), at)` jumps the shared panner from −0.75 to +0.75 while the first rumble is still sounding, so the first bang's tail flips sides. The retrigger also cuts the first envelope short. The per-shell pan that `take` sets up only holds while bangs don't overlap, which auto-launching at speed above 1 makes common.
- evidence: read
- severity: low

## The sky box loses its 16:9 shape on a narrow viewport, while the camera stays 16:9, so the show is drawn stretched
- where: apps/fireworks/src/app.css:26-32 (`.sky`); apps/fireworks/src/sky.ts:54, 95
- scenario: on a viewport narrower than about 711 px (400 × 16/9), `height: min(400px, 100%)` stays fixed while `max-width: 100%` caps the width. On a 375 px phone the box is about 343 × 400, not 16:9. `fit()` sizes the renderer to that box, but the orthographic camera always spans 16 × 9 units, so sparks are squashed about 2×. Clicks still map correctly, because `toWorld` scales the same way.
- evidence: read (CSS reasoning; not rendered)
- severity: low

## Files read
apps/fireworks/src/app.css
apps/fireworks/src/main.ts
apps/fireworks/src/show.ts
apps/fireworks/src/sky.ts
apps/fireworks/src/sound.ts

<!-- done: 6 findings, files read: 5 -->
