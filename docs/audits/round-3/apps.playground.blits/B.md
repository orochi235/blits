I couldn't write `.skulkr/out/findings.md` because the write permission wasn't granted, so the whole document is below.

# Audit round 3 findings: apps.playground.blits

## Timing and score draw anchor edges to voices blits never resolves the anchor to (non-siblings, other scores)
- where: apps/playground/src/blits/timing.ts:84 (Builder.source); apps/playground/src/blits/score.ts:105 (clipsOf links), score.ts:20 (targetOf)
- scenario: When a query names no score, blits looks only among the asker's siblings on the same score (`src/place.ts:397-403`, `timeOf`: `v.spec.score === score && (anywhere || v.owner === self.owner)`). Groups count as voices there too. Take a composition with a top-level voice "B" and a voice A inside group G, anchored `{ start: { after: "B" } }`. blits finds no voice, so A waits on a host mark named "B" and stays pending.
  - `Builder.source` looks the name up across every voice and group (`this.named.get(name)`). It checks a voice's score but lets every group through (`within`), and it never checks the owner. So the Timing tab draws an edge B → A ("start after"), and `lit` shows it as met once B ends, while A never starts.
  - The query branch (`found`) also ignores the owner.
  - `clipsOf`'s links use `named.find(x => x.name === t.name)` with no score or owner test, so the score draws the same false link.
  - Should: resolve among the asker's siblings on its score (any owner when the query names a score), and draw a `mark:` node otherwise, as blits does.
- evidence: read
- severity: medium

## The score's link drag and the Both tab's wiring write anchors to voices outside the asker's group, which blits never resolves
- where: apps/playground/src/blits/score.ts:498 (edited, case 'link'); apps/playground/src/blits/wire.ts:585 (placed)
- scenario: Dragging a link from voice A (inside group G) to the end of top-level voice B writes `anchor.start = { after: "B" }` (`waitOn`). The edit is accepted, because the only check is `load(next) !== null`. blits looks for "B" only among A's siblings (`src/place.ts:400`), so A now waits forever on an announced mark "B". The score still draws the link as if it held, per the finding above. Should: refuse a target that is not a sibling on the same score, or write a query that names the score.
- evidence: read
- severity: medium

## A replacement Player drops the booker's tag filter
- where: apps/playground/src/blits/player.ts:100 (Player constructor, `from` hand-over)
- scenario: The Events panel sets `player.events.tag = "lead"` and rebuilds. Changing the stage (dots → letters, or a resize) makes `App` build a new `Player` with `from` set to the old one. The constructor hands over the pointer, sliders and playhead but not `from.events.tag`, so the new `EventLog` books and drains every voice and the user's filter is silently gone. Should: copy `from.events.tag` before `fresh()` attaches the booker.
- evidence: read
- severity: low

## A child group listed before its parent loses the parent's weight step in the flow
- where: apps/playground/src/blits/flow.ts:205 (flowOf, ownerOut)
- scenario: Groups are visited in `comp.groups` order, and `ownerOut(owner)` reads `out.get(owner)`, which is filled only once the owner has been visited. `joinGroup` can move a group under one listed after it without reordering `groups` (`inCueOrder` sorts only voices).
  - Example: add g1, add g2 with an expression weight, move g1 into g2. Groups are now `[g1 (owner g2), g2]`.
  - When g1 is drawn, `out.get('g2')` is undefined, so the edge runs `group:g2 → group:g1` instead of from `step:group:g2:weight`.
  - The diagram, and the desk and Both tab built from it, show g1 fed past g2's weight, and g2's weight step leads nowhere.
  - Should: resolve owner edges after every group's chain is built.
- evidence: read
- severity: low

## An emptied fit list reads as blits' default fit but runs no fit at all
- where: apps/playground/src/blits/fit.ts:143 (fitOf); apps/playground/src/blits/params.ts:223 (spanParams)
- scenario: Removing every step in the span's fit editor (FitSteps "remove") stores `span.fit: []`. `fitOf([])` returns `pipe()`, which hands the plan back unchanged, so the span no longer condenses or sheds. `spanParams` shows a fit only when `s.fit?.length` is nonzero, so the span's node shows nothing, exactly as it does for the unset default ("condense, then shed"). The same setting means no fit to blits and the default fit to the diagram. Should: treat `[]` as unset in `fitOf`, or show it as an empty fit.
- evidence: read
- severity: low

## pointer.ts says an `around` composition keeps no history and scrubs by replay; compile gives it history like any other
- where: apps/playground/src/blits/pointer.ts:44 (usesAround doc); apps/playground/src/blits/compile.ts:59-72 (compile)
- scenario: The doc says a composition that calls `around` makes mixes with no history, "which blits refuses a bounded voice, so a scrub back replays rather than seeks". In fact `compile` passes `history` to every mix whether or not `usesAround` holds, and uses `usesAround` only to `plot` subjects. blits' source has no refusal of history for a bounded voice. A reader who trusts the doc concludes the seek path is never taken for such a composition, when it is.
- evidence: read
- severity: low

## Files read
apps/playground/src/blits/anchor.ts
apps/playground/src/blits/blend.ts
apps/playground/src/blits/both.ts
apps/playground/src/blits/clip.ts
apps/playground/src/blits/color.ts
apps/playground/src/blits/compile.ts
apps/playground/src/blits/composition.ts
apps/playground/src/blits/course.ts
apps/playground/src/blits/cueBlend.ts
apps/playground/src/blits/cueGroups.ts
apps/playground/src/blits/desk.ts
apps/playground/src/blits/easing.ts
apps/playground/src/blits/edit.ts
apps/playground/src/blits/events.ts
apps/playground/src/blits/expr.ts
apps/playground/src/blits/file.ts
apps/playground/src/blits/fit.ts
apps/playground/src/blits/flow.ts
apps/playground/src/blits/follow.ts
apps/playground/src/blits/frame.ts
apps/playground/src/blits/groupEdits.ts
apps/playground/src/blits/groups.ts
apps/playground/src/blits/keyed.ts
apps/playground/src/blits/keys.ts
apps/playground/src/blits/kit.ts
apps/playground/src/blits/load.ts
apps/playground/src/blits/outline.ts
apps/playground/src/blits/params.ts
apps/playground/src/blits/placed.ts
apps/playground/src/blits/player.ts
apps/playground/src/blits/pointer.ts
apps/playground/src/blits/readBack.ts
apps/playground/src/blits/score.ts
apps/playground/src/blits/scoreHeaders.ts
apps/playground/src/blits/spec.ts
apps/playground/src/blits/stage.ts
apps/playground/src/blits/stages/Stage.module.css
apps/playground/src/blits/stages/Stage.tsx
apps/playground/src/blits/stages/draw.ts
apps/playground/src/blits/stamps.ts
apps/playground/src/blits/timing.ts
apps/playground/src/blits/wire.ts

<!-- done: 6 findings, files read: 42 -->