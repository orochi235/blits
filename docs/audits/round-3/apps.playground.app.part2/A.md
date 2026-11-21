# Findings: apps.playground.app.part2

## A voice's `patch` field error is shown nowhere, so a motion voice under a span silently drops out
- where: apps/playground/src/app/VoicePanel.tsx:51 (ROWED / LOOSE), apps/playground/src/app/PatchPanel.tsx:41 (WHOLE)
- scenario: put a spring/glide/tween voice under a span group. `spanRefusals` (blits/cueGroups.ts:92) reports `{ field: 'patch', error: 'a span cannot fit a motion voice, which never ends' }` and leaves the voice out of the mix. VoicePanel only routes `name/start/loop/role` to rows and lists `cue/anchor` loose; PatchPanel's `WHOLE` lists only `stops/writes/opts` (and `at/state/step`, `opts.*`). No panel renders `patch`, so the voice stops playing with no visible reason. Should be listed (e.g. add `patch` to `LOOSE` or `WHOLE`).
- evidence: read
- severity: medium

## The score's own compile is an unnamed mix left registered on the debug panel while it is current
- where: apps/playground/src/app/useScore.ts:17 (useScore)
- scenario: open the playground with `?panel`. `compile(comp, subjects)` is called with no `name`, and `mix()` registers every mix (src/mixer.ts:785); `close` runs only when `built` is replaced or on unmount. So besides `playground` and its solos, the panel lists one unnamed mix that is held at 0 and never synced past it — the panel's pause/seek on it move nothing on screen. CLAUDE.md requires every mix be named, and apps/playground/README.md:421-424 says the score's compile is closed "so the panel lists only what plays". It should either be named (e.g. `playground · score`) or closed right after `clipsOf` has read it.
- evidence: read
- severity: low

## A blended voice's weight error drops the voice but its row is hidden, so the reason is invisible
- where: apps/playground/src/app/VoicePanel.tsx:113 (SCHEMA `weight` showIf `!i.blended`)
- scenario: a voice has a signal weight with a syntax error (or one typed before blending), then its role is blended. `specOf` still compiles `v.weight` and returns `{ errors: [{ field: 'weight' }] }` (blits/spec.ts:67-68), so `cueAll` leaves the voice out, though `cueBlend` throws the weight away (blits/cueBlend.ts:22). The only place that shows a `weight` error is `WeightRow`, which `showIf(!blended)` hides, and `weight` is not in ROWED/LOOSE. The voice silently stops sounding in the blend. Either the hidden row's error should be listed loose while blended, or the weight should not be compiled for a blend member.
- evidence: read
- severity: low

## The keys timeline's playhead is `(playhead - start) * rate % period`, ignoring the voice's seek, owner clock, anchor, span placement, loop end, and reverse rate
- where: apps/playground/src/app/PatchPanel.tsx:174 (PatchPanel `phase`)
- scenario: (a) a voice with `rate: -1` — `Math.max(0, negative)` pins the playhead at 0 for its whole run, though it plays from its end back to 0; (b) a voice with `seek: 500`, period 1000 — the playhead is half a period off; (c) a voice under an owner group with `start: 2000`, or anchored/placed by a span — the playhead runs from score 0 and wraps through the patch while the voice has not started; (d) `loop: false` — after one pass it keeps wrapping while the voice holds at its end. The playhead should read the voice's real phase (e.g. from its handle), not re-derive it from `start` and `rate`.
- evidence: read
- severity: low

## `fade in` shows an unset `fade.in` as 0 and can never unset it, though blits' `rise` reads unset and 0 differently
- where: apps/playground/src/app/SpecFields.tsx:323 (sharedConfig) and :342 (writtenShared `fadeIn`)
- scenario: a voice with `fade: { out: 600 }` and no `in`: the row shows `fade in 0`, and a live `rise` with `over` auto rises over 600 ms, since src/fade.ts:291 takes `opts.over ?? fade.in ?? fade.out`. Type 100 into fade in, then 0 back: the voice now holds `in: 0`, the row looks identical to before, but `rise` is now instant. The row has no way back to unset (a non-finite value is ignored, there is no clear), so the panel shows two different behaviors as the same value. It should be an optional number (blank = unset), as `seek` and `stepMs` are. Same for groups, which share the row.
- evidence: read
- severity: low

## `freshVoice` checks only voice names, but voices and groups share one name space
- where: apps/playground/src/app/freshVoice.ts:8 (freshVoice)
- scenario: rename a group `voice 2` in a composition with one voice, then press "add voice": `names` holds only voice names, so the new voice is named `voice 2`. `cueAll` treats a voice and a group with one name as an error (blits/cueGroups.ts:134-138, "a group is named …") and leaves the later one out, so a freshly added voice (or the group) stops playing. The fresh name should skip group names too (`comp.groups`).
- evidence: read
- severity: low

## A shared link opened in a tab already on the playground is ignored, and its hash then overrules edits on reload
- where: apps/playground/src/app/useComposition.ts:11 (first) and :39-42
- scenario: with the playground open, paste another `#c=…` share link into the same tab's address bar. Only the hash changes, so the page does not reload: `first()` ran once at mount and the strip-the-hash effect has `[]` deps, so the shared composition is not loaded and the `#c=` stays in the address bar. Edit something, then reload: `first()` prefers the hash over localStorage, discarding the edits — the case the effect's comment says it prevents. Listening for `hashchange` (load, then strip) would close it.
- evidence: read
- severity: low

## The transport's speed is frame-loop math on the host clock, not the mix's `rate`
- where: apps/playground/src/app/usePlayback.ts:26 (usePlayback step)
- scenario: set the transport's rate to 0.25 and open `?panel`. `owed += dt * rate` feeds the Player 0.25 frames of host time per real frame, so everything plays at quarter speed while every mix (and the panel) reports `rate` 1; the panel's own rate control then multiplies on top of a speed it cannot see. CLAUDE.md: "Play, pause, speed, and scrubbing go through blits: the mix's `rate` to pause or change speed", and "the frame loop syncs, probes, and draws, and nothing more". (The playground's separate "mix rate" control, Transport.tsx:33-36, shows the split is deliberate for score time, but it leaves the speed shown to the reader and to the panel outside blits.)
- evidence: read
- severity: low

## Files read
apps/playground/src/app/LivePanel.tsx
apps/playground/src/app/MarksFields.tsx
apps/playground/src/app/MixPanel.tsx
apps/playground/src/app/OwnerField.tsx
apps/playground/src/app/PanelTabs.module.css
apps/playground/src/app/PanelTabs.tsx
apps/playground/src/app/PatchLive.module.css
apps/playground/src/app/PatchPanel.tsx
apps/playground/src/app/ReadBack.tsx
apps/playground/src/app/Rows.module.css
apps/playground/src/app/RulesPanel.tsx
apps/playground/src/app/SpanFields.tsx
apps/playground/src/app/SpecFields.tsx
apps/playground/src/app/TimingPanel.tsx
apps/playground/src/app/Transport.tsx
apps/playground/src/app/VoiceColumn.tsx
apps/playground/src/app/VoicePanel.tsx
apps/playground/src/app/WaveFields.tsx
apps/playground/src/app/WeightField.tsx
apps/playground/src/app/docs.ts
apps/playground/src/app/flowKey.ts
apps/playground/src/app/freshVoice.ts
apps/playground/src/app/ms.ts
apps/playground/src/app/useComposition.ts
apps/playground/src/app/usePlayback.ts
apps/playground/src/app/useScore.ts
apps/playground/src/app/useSize.ts
apps/playground/src/app/useTracksOpen.ts

<!-- done: 8 findings, files read: 28 -->
