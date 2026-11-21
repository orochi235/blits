I couldn't save `.skulkr/out/findings.md` because the write permission was never granted, so the whole findings document is below.

# Findings: apps.playground.widgets (blind reviewer)

The checked-out tree is 836ce269, not 0d1aa23; that commit isn't in the repository. No file under `apps/playground/src/widgets` differs from HEAD, and none of them changed in the last week.

## Dragging an open clip's loop arrow removes the element holding the pointer, so letting go outside the score leaves the drag running
- where: apps/playground/src/widgets/ScoreLanes/ScoreLanes.tsx:61-118, 174-176 (Lanes `begin`/`onMove`/`onUp`); apps/playground/src/widgets/ScoreLanes/ClipLane.tsx:256-275; apps/playground/src/widgets/ScoreLanes/drag.ts:30
- scenario: Press the "end … loop" arrow on a clip with `passes: Infinity` and drag. `begin` captures the pointer on `e.target`, which is the arrow's glyph or hit rect.
  - The first move previews `passes(stops[0] ?? 1)`. The shown clip becomes finite, so `open && c.pass > 0` turns false, the arrow `<g>` unmounts, and the capture is lost.
  - If you release outside the score's svg, `onUp` never runs. There is no `onLostPointerCapture`, so `drag` and `preview` stay set.
  - Moving back over the score keeps updating the preview with no button held. The next press and release anywhere on the score commits that stale `passes` edit.
  - Fix: end the drag on `lostpointercapture`, as the recent fling fix does, or capture the pointer on the svg instead.
- evidence: read
- severity: medium

## CodePane's Tab handler traps keyboard focus in the textarea
- where: apps/playground/src/widgets/CodePane/CodePane.tsx:23-29 (`key`)
- scenario: Every Tab and Shift+Tab is `preventDefault`ed and inserts two spaces. No key releases focus, so a keyboard user can't leave the field (this fails WCAG 2.1.2, No Keyboard Trap). Fix: let Shift+Tab through and offer a way out, such as Escape then Tab.
- evidence: read
- severity: medium

## Scrubbing the open score ignores a pointer left of the time axis, while the closed score clamps it to 0
- where: apps/playground/src/widgets/ScoreLanes/ScoreLanes.tsx:56-59 (`scrubTo`) vs apps/playground/src/widgets/ScoreLanes/Strips.tsx:22-27 (`scrub`)
- scenario: Drag the ruler quickly left past the lane labels. Lanes drops every `t < 0`, so the playhead stays at the last in-range value (say 0.4 s) and never reaches 0. Strips calls `onScrub(Math.max(0, t))` and does reach 0. The same decision is answered two ways.
- evidence: read
- severity: low

## FlowDiagram drops edge ids and looks up edge styles by (from, to, label), so two edges between the same nodes share one style
- where: apps/playground/src/widgets/FlowDiagram/FlowDiagram.tsx:22-23, 104, 118-123, 131
- scenario: `FlowEdge.id` is never passed to `diagramScene`, even though its edge type accepts an optional `id`. `edgeStyle` reads from a Map keyed `from\nto\nlabel`.
  - Two unlabeled edges with the same ends but different `timing`, `met` or `dashed` collide. The later one overwrites the entry and both draw in its style: a flow edge comes out timing amber, or a met edge draws as unmet.
  - `bothOf` (apps/playground/src/blits/both.ts:48) prefixes timing ids with `t:` "so it cannot meet a flow edge's", but the widget throws that id away.
  - Fix: key the lookup on the edge's own `id` and pass it through.
- evidence: read
- severity: low

## CodePane and ExprInput send the same rejected draft twice: once on Mod+Enter/Enter, again on blur
- where: apps/playground/src/widgets/CodePane/CodePane.tsx:18-22; apps/playground/src/widgets/ExprInput/ExprInput.tsx:25-31
- scenario: The user presses Mod+Enter or Enter on a draft the parent rejects: it sets `error` and leaves `value` unchanged, as a compile failure does. `draft !== value` still holds, so moving focus away calls `onCommit` again with the same text. A parent that compiles or records an undo step per commit sees a duplicate. Fix: remember the last committed draft and skip it.
- evidence: read
- severity: low

## Track gradient stops are keyed by sample time, which repeats when two samples snap to the same frame
- where: apps/playground/src/widgets/ScoreLanes/TrackLayers.tsx:60-62; apps/playground/src/widgets/ScoreLanes/track.ts:12-23
- scenario: track.ts's own doc says samples are snapped to the frames a mix played, so two can share an `at`. `stops` then emits two entries with the same `at`, and `<stop key={x.at}>` gives React duplicate keys. That means a console warning, and on a later update React can reuse the wrong `<stop>`, leaving a stale color in the gradient. Fix: key by index.
- evidence: read
- severity: low

## The ruler labels every whole second at any duration, so labels on long scores overprint each other
- where: apps/playground/src/widgets/ScoreLanes/Ruler.tsx:29, 44-48
- scenario: At a 60 s duration, 61 labels share an 860-unit axis, about 14 units apart. A label like "60s" is wider than that, so they overprint into an unreadable band. Fix: choose the tick step from the space available per second.
- evidence: read
- severity: low

## Files read
apps/playground/src/widgets/ChannelPlot.stories.tsx
apps/playground/src/widgets/CodePane/CodePane.module.css
apps/playground/src/widgets/CodePane/CodePane.stories.tsx
apps/playground/src/widgets/CodePane/CodePane.tsx
apps/playground/src/widgets/CodePane/index.ts
apps/playground/src/widgets/ExprInput/ExprInput.module.css
apps/playground/src/widgets/ExprInput/ExprInput.stories.tsx
apps/playground/src/widgets/ExprInput/ExprInput.tsx
apps/playground/src/widgets/ExprInput/index.ts
apps/playground/src/widgets/FlowDiagram/FlowDiagram.stories.tsx
apps/playground/src/widgets/FlowDiagram/FlowDiagram.tsx
apps/playground/src/widgets/FlowDiagram/index.ts
apps/playground/src/widgets/FlowDiagram/style.ts
apps/playground/src/widgets/FlowDiagram/types.ts
apps/playground/src/widgets/FoldStamp/FoldStamp.module.css
apps/playground/src/widgets/FoldStamp/FoldStamp.stories.module.css
apps/playground/src/widgets/FoldStamp/FoldStamp.stories.tsx
apps/playground/src/widgets/FoldStamp/FoldStamp.tsx
apps/playground/src/widgets/FoldStamp/curves.ts
apps/playground/src/widgets/FoldStamp/grid.ts
apps/playground/src/widgets/FoldStamp/index.ts
apps/playground/src/widgets/FoldStamp/stamp.ts
apps/playground/src/widgets/Glyph.tsx
apps/playground/src/widgets/MixerDesk/MixerDesk.module.css
apps/playground/src/widgets/MixerDesk/MixerDesk.stories.tsx
apps/playground/src/widgets/MixerDesk/MixerDesk.tsx
apps/playground/src/widgets/MixerDesk/index.ts
apps/playground/src/widgets/MixerDesk/layout.ts
apps/playground/src/widgets/MixerDesk/types.ts
apps/playground/src/widgets/ScoreLanes/ClipLane.tsx
apps/playground/src/widgets/ScoreLanes/HeaderLane.tsx
apps/playground/src/widgets/ScoreLanes/Marks.tsx
apps/playground/src/widgets/ScoreLanes/Ruler.tsx
apps/playground/src/widgets/ScoreLanes/ScoreLanes.module.css
apps/playground/src/widgets/ScoreLanes/ScoreLanes.stories.tsx
apps/playground/src/widgets/ScoreLanes/ScoreLanes.tsx
apps/playground/src/widgets/ScoreLanes/Strips.tsx
apps/playground/src/widgets/ScoreLanes/TrackLayers.tsx
apps/playground/src/widgets/ScoreLanes/drag.ts
apps/playground/src/widgets/ScoreLanes/geometry.ts
apps/playground/src/widgets/ScoreLanes/index.ts
apps/playground/src/widgets/ScoreLanes/keys.ts
apps/playground/src/widgets/ScoreLanes/track.ts

<!-- done: 7 findings, files read: 43 -->