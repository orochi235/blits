I couldn't write `.skulkr/out/findings.md` because both write attempts were refused, so the whole document is below.

# Findings: apps.playground.widgets

Note: the brief names commit 0d1aa23ae22834c481f05bd51a4972ebae74778d, but that commit does not exist in this clone (`git cat-file` fails). The checkout is at 836ce269, and its uncommitted changes do not touch `apps/`. The findings cite that tree. No file in the area changed in the last week; the latest change is aeda030c, from 2026-11-06.

## A clip or header that runs past the score's end draws its fade-out ending at the score's end
- where: apps/playground/src/widgets/ScoreLanes/geometry.ts:48-52 (slopePolygon); the same clamp is at apps/playground/src/widgets/ScoreLanes/ClipLane.tsx:220 (fade-out handle `cx`)
- scenario: a clip with start 8000, pass 4000 and passes 1 ends at 12000. Give it fadeOut 500 and a score duration of 10000.
  - `end = min(e.end, viewEnd)` = 10000, so `outX = s.x(10000 - 500)`, and the polygon slopes down to its base at 10000.
  - The clip is therefore drawn fading out over 9500..10000. It is actually at full weight there; its real fade is 11500..12000, off the score.
  - The fade-out handle is drawn at 9500 too, so its position doesn't match the fade's value.
  - The slope should sit at `e.end - fadeOut`, clipped to `viewEnd`.
  - HeaderLane bars use the same function, so a header that ends past the score shows the same false fade.
- evidence: read
- severity: medium

## Dragging an open clip's loop arrow loses pointer capture, and the drag can get stuck
- where: apps/playground/src/widgets/ScoreLanes/ClipLane.tsx:256-275 (open-loop arrow), together with apps/playground/src/widgets/ScoreLanes/ScoreLanes.tsx:61-73 and 174-176 (begin, onPointerUp/onPointerCancel)
- scenario: press the arrow at the end of an open loop (`passes: Infinity`, `pass > 0`) and drag it.
  - `begin` captures the pointer on the arrow's `<rect>`.
  - The first move sets a preview with a finite number of passes, so `open` becomes false. The arrow `<g>` unmounts and the edge `<rect>` replaces it. Removing the captured element releases the capture.
  - If the pointer then leaves the svg and is released there (dragging left past the label column, or off the page), neither `onPointerUp` nor `onPointerCancel` reaches the svg.
  - `drag` stays set. Hovering the score afterwards keeps moving the preview with no button held, and the next click anywhere on the score commits that preview as a passes edit.
  - Nothing handles `lostpointercapture`, which is the fix fling got in f5634e1d.
- evidence: read
- severity: medium

## The code pane traps Tab, so keyboard focus can't leave it
- where: apps/playground/src/widgets/CodePane/CodePane.tsx:23-29 (key)
- scenario: a keyboard user tabs into the textarea, then presses Tab or Shift+Tab to move on.
  - Every Tab, with or without Shift, is `preventDefault`ed and inserts two spaces.
  - No key, Escape included, lets the next Tab through, so focus can never leave the pane by keyboard. That breaks WCAG 2.1.2 (no keyboard trap).
  - Shift+Tab also inserts spaces instead of moving focus back or removing indentation.
- evidence: read
- severity: medium

## FlowDiagram styles edges by (from, to, label), so two edges between the same nodes share one style
- where: apps/playground/src/widgets/FlowDiagram/FlowDiagram.tsx:22-23, 104, 131 (endsOf, edgeStyle)
- scenario: a flow has two unlabeled edges from A to B. Examples: a flow edge and a `timing` edge, or two `param` edges into different named `port`s where one is `met: true` and the other `met: false`.
  - Both edges get the same `endsOf` key, so the Map keeps only the last one.
  - `edgeStyleOf` then gives both edges that last edge's stroke, width and dash. A timing edge gets drawn in the flow color, or an unmet edge gets drawn as met.
  - `FlowEdge.id` exists but the lookup never uses it.
- evidence: read
- severity: low

## The FoldStamp "Looks" story shows identical rows under labels that say they differ
- where: apps/playground/src/widgets/FoldStamp/FoldStamp.stories.tsx:46-50 (Looks)
- scenario: `encode` defaults to `'hue'` in `stampSvg` (stamp.ts:52).
  - The "bold" row, `{ line: 'bold' }`, is therefore the same as "bold, hue".
  - "default: glowing, hue" is likewise the same as "glowing, hue".
  - A reader comparing a plain bold stamp with a hued one sees the same picture twice. The plain row needs `encode: 'none'`.
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
apps/playground/src/widgets/FoldStamp/FoldStamp.stories.tsx
apps/playground/src/widgets/FoldStamp/FoldStamp.tsx
apps/playground/src/widgets/FoldStamp/curves.ts
apps/playground/src/widgets/FoldStamp/grid.ts
apps/playground/src/widgets/FoldStamp/index.ts
apps/playground/src/widgets/FoldStamp/stamp.ts
apps/playground/src/widgets/Glyph.tsx
apps/playground/src/widgets/MixerDesk/MixerDesk.stories.tsx
apps/playground/src/widgets/MixerDesk/MixerDesk.tsx
apps/playground/src/widgets/MixerDesk/index.ts
apps/playground/src/widgets/MixerDesk/layout.ts
apps/playground/src/widgets/MixerDesk/types.ts
apps/playground/src/widgets/ScoreLanes/ClipLane.tsx
apps/playground/src/widgets/ScoreLanes/HeaderLane.tsx
apps/playground/src/widgets/ScoreLanes/Marks.tsx
apps/playground/src/widgets/ScoreLanes/Ruler.tsx
apps/playground/src/widgets/ScoreLanes/ScoreLanes.stories.tsx
apps/playground/src/widgets/ScoreLanes/ScoreLanes.tsx
apps/playground/src/widgets/ScoreLanes/Strips.tsx
apps/playground/src/widgets/ScoreLanes/TrackLayers.tsx
apps/playground/src/widgets/ScoreLanes/drag.ts
apps/playground/src/widgets/ScoreLanes/geometry.ts
apps/playground/src/widgets/ScoreLanes/index.ts
apps/playground/src/widgets/ScoreLanes/keys.ts
apps/playground/src/widgets/ScoreLanes/track.ts

<!-- done: 5 findings, files read: 39 -->