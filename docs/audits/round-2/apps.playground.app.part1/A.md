# Findings: apps.playground.app.part1

## The marks table keeps the oldest 120 marks, in earliest-first order, while the other lists keep the newest
- where: apps/playground/src/app/EventsPanel.tsx:168 (EventsPanel)
- scenario: `SHOWN` is documented as "the most rows a list draws, newest first", and the booked and sent tables do `.slice(-SHOWN).reverse()`. `mix.marks(-Inf, +Inf)` returns marks earliest first (src/types/mix.ts:504), and the marks table does `marks.slice(0, SHOWN * 2)`, so once a looping composition with a long history has more than 120 marks, the table shows the first 120 and never the current ones, in ascending order. It should take the newest marks (`slice(-n).reverse()`), or the cut and the doc should agree.
- evidence: read
- severity: low

## A refused or unchanged level, stage or title edit still pushes an undo step and rebuilds the player
- where: apps/playground/src/app/CompositionControls.tsx:205 (LevelsPanel `set`), :91 (StageControls `set`), :150 (CompFields title)
- scenario: `useComposition.set` drops an edit only when `next === now.current`. `renameLevel` and `tuneLevel` refuse a duplicate name, a non-finite number or crossing bounds by returning a fresh copy `[...levels]`, and `LevelsPanel.set` wraps it in a new `{ ...comp, levels }`. Typing a level name another level already has, or a min above the max, therefore creates a new composition equal to the old one: it adds an undo step that undoes nothing and runs `player.rebuild` (a recompile and a replay to the playhead, App.tsx:87). The same happens in `StageControls`, where `sizeDots`/`lettersOf` always return a new stage (a non-finite cols, or the same text committed again), and in `CompFields` for a title committed unchanged. `withLength` and `withAhead` already return `c` itself when nothing changed, so two paths in one file answer "is this a no-op" differently.
- evidence: read (edit.ts:27-116, useComposition.ts:29-37)
- severity: low

## A channel's ease can't be switched off steps while the patch's ease is steps
- where: apps/playground/src/app/ChannelTiming.tsx:37-48, 86-88 (ChannelTiming `ease` renderer / `setConfig`); apps/playground/src/app/EaseField.tsx:58
- scenario: A keys patch has `ease: { steps: 4 }` and channel `x` has no `easeBy` of its own, so its cell shows `easeOf('x')` = the patch's steps with the "steps" toggle on. Turning that toggle off calls `onChange(undefined)`, and `setConfig` turns undefined into "remove x from `easeBy`". x had nothing there, so the composition does not change and the cell redraws with steps still on. The toggle can't be turned off, and the user can't give the channel its own curve from this state. With no `inherit` passed, EaseField's "steps off" means "blits' default", but in this cell undefined means "inherit the patch". It should write an explicit curve (for example `'linear'`) when the inherited ease is steps.
- evidence: read
- severity: low

## The booker's drain tag is dropped when the stage changes, though sliders and playhead carry over
- where: apps/playground/src/app/EventsPanel.tsx:125-128, 142 (EventsPanel `write` / config); apps/playground/src/app/App.tsx:44-50 (player memo)
- scenario: The "book and drain only the tag" field writes `player.events.tag` on the current Player. Changing the stage (dots↔letters, cols, rows, text) changes `subjects`, so App builds a new `Player` with `from: last.current`. The constructor (blits/player.ts:99-111) hands over `at`, `slid`, `authored` and the playhead, but each Player makes a fresh `EventLog`, so `events.tag` goes back to undefined. The field empties and drain stops filtering, with nothing to say so. The tag is also kept outside the composition, so undo can't bring it back. It should be handed over like the sliders, or kept in the composition.
- evidence: read
- severity: low

## Committing an empty retarget/push expression leaves the previous error on screen
- where: apps/playground/src/app/AimField.tsx:26, 54-57 (AimField `aim`)
- scenario: Commit `(s) => [`. The error shows. Clear the field and commit: `setCode('')` runs, but `aim` returns early on `src.trim() === ''` before any `setError`, so the stale compile error stays under an empty input ("again" is disabled at the same time). Every other path in `aim` sets the error afresh, so it should be cleared on the empty path too.
- evidence: read
- severity: low

## Save revokes the object URL in the same tick as `a.click()`
- where: apps/playground/src/app/FileButtons.tsx:10-17 (FileButtons `save`)
- scenario: `URL.revokeObjectURL(url)` runs straight after the synthetic click, before the browser has necessarily started reading the blob. Firefox, and some Safari versions, can fail the download or save an empty file. The usual fix is to revoke after a timeout, or on the next task. This is inferred from known browser behavior; I did not run it here.
- evidence: read (behavior inferred, not run)
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

<!-- done: 6 findings, files read: 28 -->
