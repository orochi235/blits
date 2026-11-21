# Findings: apps.playground.app.part1

## A channel can never be given a smooth curve while the patch's ease is stepped
- where: apps/playground/src/app/ChannelTiming.tsx:37-46 (ChannelTiming, `easeOf` / `ease` renderer); apps/playground/src/app/EaseField.tsx:58 (steps toggle)
- scenario: a keys patch with `ease: {steps: 4}`, and channel `x` with no `easeBy` entry. Its cell shows `easeOf('x')` = the patch's steps, so the EaseField shows the steps toggle on. Turning steps off calls `onChange(undefined)`, which `setConfig` writes as "drop `easeBy.x`", so the cell again reads the patch's steps and the toggle is still on. The curve picker is never reached, so no non-step `easeBy` can be set for that channel from the UI. Turning steps off should give the channel its own curve (e.g. `'linear'`), not hand it back to the inherited stepped ease.
- evidence: read
- severity: medium

## Anchor "insert…" for a group can target one of the group's own members, or a voice that does not exist
- where: apps/playground/src/app/AnchorRow.tsx:19-20 (AnchorRow, `it`), :40-43 (insert menu)
- scenario: select an owner group whose members include `comp.voices[0]`. For a group (`'patch' in x` false), "it" is always `comp.voices[0]` with no check that it lies outside the group, so "start after it ends" writes an anchor placing the group after its own member, a dependency on itself. And for a voice in a composition with no other voice, "it" falls back to the literal `'intro'`, so any insert writes an anchor on a name nothing has. "It" should be a voice or group the selected one can actually wait on.
- evidence: read
- severity: low

## The marks table keeps the oldest 120 marks, so new ones past that never show
- where: apps/playground/src/app/EventsPanel.tsx:122 and :168 (EventsPanel, `marks.slice(0, SHOWN * 2)`)
- scenario: `mix.marks` returns marks earliest first. The booked and sent tables take `.slice(-SHOWN).reverse()`, the newest, which is what `SHOWN`'s doc ("the most rows a list draws, newest first") says. The marks table instead takes `slice(0, 120)`, the earliest. In a composition whose voices, passes and groups fix more than 120 marks before the playhead, a mark made now (such as one from "announce now", which lands at the current host time) falls past the cut and never appears, and the table never scrolls forward with playback. The marks table should cut the same end the other two do, or say it shows the first 120.
- evidence: read
- severity: low

## Files read
apps/playground/src/app/AimField.tsx
apps/playground/src/app/AnchorRow.tsx
apps/playground/src/app/AnnouncedFields.tsx
apps/playground/src/app/App.module.css
apps/playground/src/app/App.tsx
apps/playground/src/app/BlendField.tsx
apps/playground/src/app/BothPanel.tsx
apps/playground/src/app/ChannelTiming.tsx
apps/playground/src/app/CompositionControls.tsx
apps/playground/src/app/DeskPanel.tsx
apps/playground/src/app/DiagramTabs.module.css
apps/playground/src/app/DiagramTabs.tsx
apps/playground/src/app/EaseField.tsx
apps/playground/src/app/Events.module.css
apps/playground/src/app/EventsPanel.tsx
apps/playground/src/app/FadeControls.tsx
apps/playground/src/app/FileButtons.tsx
apps/playground/src/app/FitReadout.tsx
apps/playground/src/app/FitSteps.tsx
apps/playground/src/app/FlowPanel.module.css
apps/playground/src/app/FlowPanel.tsx
apps/playground/src/app/Group.module.css
apps/playground/src/app/GroupPanel.tsx
apps/playground/src/app/Header.tsx
apps/playground/src/app/HintsFields.tsx
apps/playground/src/app/Inspector.tsx
apps/playground/src/app/KeyEditor.tsx
apps/playground/src/app/LiveMix.tsx

<!-- done: 3 findings, files read: 28 -->
