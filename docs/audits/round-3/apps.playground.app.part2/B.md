I couldn't finish writing `.skulkr/out/findings.md`: the first write went through, but the later edits were blocked. The file on disk holds only the first two findings. Here is the full document:

# Findings: apps.playground.app.part2

Commit 0d1aa23ae22834c481f05bd51a4972ebae74778d is not in this repository, so I read the working tree at HEAD 836ce269 instead. Nothing under `apps/playground` has uncommitted changes. No listed file changed in the last week; the last change was on 2026-11-07.

## The keys timeline's playhead is computed in frame-loop math from start and rate instead of read from the voice, so it is wrong for seek, negative rate, finite loops, spans and owner groups
- where: apps/playground/src/app/PatchPanel.tsx:174 (PatchPanel, `phase`)
- scenario: The code computes `phase = max(0, (playhead - v.start) * v.rate) % period`, which goes wrong in five cases:
  - (a) A voice with `seek: 300` and period 1000 starts its patch at 300 ms, but the playhead reads 0 at its start.
  - (b) A voice at `rate: -1` plays backward from its end. `(playhead - start) * -1` is negative, so the playhead stays stuck at 0.
  - (c) A voice with `loop: 2` stops after 2000 ms, but the playhead keeps wrapping.
  - (d) A voice under a span is placed by the span, and a voice under an owner group runs on the group's clock. The formula uses only the voice's own `start` and `rate`.
  - (e) A live `mixRate` change slows the voices while the score clock runs on, so the drawn phase drifts away from the voice.

  CLAUDE.md says "a slider shows where the mix or voice is", and motion is not frame-loop math. The playhead should come from the voice's handle: `Handle.elapsed`, documented at src/types/voice.ts:475 as "`elapsed % span` is the place in the current one; a voice under an owner reads its own clock". Instead, VoiceColumn.tsx:134 passes `p.player.t`, the score time.
- evidence: read
- severity: medium

## No panel shows a spanned motion voice's compile error (`field: 'patch'`)
- where: apps/playground/src/app/PatchPanel.tsx:41 (WHOLE); apps/playground/src/app/VoicePanel.tsx:51-52 (ROWED, LOOSE)
- scenario: Put a spring, glide or tween voice under a span. cueGroups.ts:92 reports `{ field: 'patch', error: 'a span cannot fit a motion voice, which never ends' }`.
  - The patch panel shows only `stops`, `writes` and `opts*` as whole-patch errors.
  - The voice panel shows `name`, `start`, `loop` and `role` in rows, and `cue` and `anchor` as loose errors.

  Neither shows `patch`, so the voice fails to compile and nothing tells the user why.
- evidence: read
- severity: medium

## Opening a shared link overwrites the composition saved in localStorage, and undo can't bring it back
- where: apps/playground/src/app/useComposition.ts:10-19, 43-47 (first, persist effect)
- scenario: The user has work saved under `blits-playground:composition` and opens someone else's `#c=` link.
  - `first()` returns the shared composition, and the persist effect writes it to `localStorage` on mount.
  - The edit history starts empty (`createHistory(null)`), so undo can't restore the old work.
  - The hash is removed at line 41, so a reload shows the shared composition.

  One click on a link loses the user's own work.
- evidence: read
- severity: medium

## useScore's compile makes an unnamed mix that still shows up on the debug panel
- where: apps/playground/src/app/useScore.ts:17 (useScore)
- scenario: `compile(comp, subjects)` passes no `name`, but `made()` (src/mixer.ts:785) registers every mix. With `?panel`, the panel lists an extra unnamed mix, replaced on each edit. That mix sits at time 0 and is never synced, so the panel's pause and seek do nothing visible. CLAUDE.md says "Name every mix". The compile at App.tsx:45 is named; this one isn't.
- evidence: read
- severity: low

## Under StrictMode, useScore leaks one registered mix per edit and unregisters the mix in use
- where: apps/playground/src/app/useScore.ts:17-18 (useScore)
- scenario: Playground.tsx wraps the app in `<StrictMode>`, and in development React runs a `useMemo` factory twice.
  - Each change to `comp` compiles twice. The discarded `Built` has its mix and tape registered, and nothing ever closes it.
  - StrictMode also runs the effect cleanup once on mount, which closes (unregisters) the `Built` that is still in use.

  Each edit adds one orphan mix to the registry.
- evidence: read
- severity: low

## A shared link that fails to load is dropped with no message and removed from the address bar
- where: apps/playground/src/app/useComposition.ts:11-12, 39-42 (first, hash effect)
- scenario: A `#c=` link is truncated, or has a shape `load` rejects.
  - `fromHash` returns null, and `first()` falls back to the saved composition without telling the user.
  - The hash is removed anyway, because the effect only checks `has('c')`, not whether the load worked.

  The user sees a different composition than the one they were sent, and the link is gone, so they can't retry it.
- evidence: read
- severity: low

## Typing an out-of-range number like `1e999` into a motion option saves the whole composition in a form the next reload discards
- where: apps/playground/src/app/PatchPanel.tsx:72-81 (parsed), with useComposition.ts:15, 43-47
- scenario: Type `1e999` (or `[0, 1e400]`) into a spring option such as stiffness.
  - `JSON.parse` returns `Infinity`, and `parsed` keeps it as a literal.
  - Compile shows "takes a number", but the composition is already saved, and `JSON.stringify` writes the value as `null`.
  - On reload, `load()` rejects it (`option(null)` fails at load.ts:47). `first()` falls back to `initial`, and the persist effect overwrites the saved work.

  `parsed` doesn't reject non-finite numbers; every other number writer in the listed files checks `Number.isFinite`.
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

<!-- done: 7 findings, files read: 28 -->