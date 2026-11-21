- A+B: an open loop's end-arrow drag loses pointer capture and gets stuck. fixed 05051559. The score svg now holds the capture instead of the handle, and the drag ends on `lostpointercapture`. The strip view also ends its scrub on lost capture.
- A+B: the code pane traps Tab. fixed b424e8b5. Shift+Tab, or Tab right after Escape, now moves focus on, and the README says so. question: no one had decided how to get out. I took Escape-then-Tab, the pattern code editors use. Is that the binding you want?
- A+B: FlowDiagram styles edges by (from, to, label), so edges between the same nodes share one style. fixed ccf42222. The lookup now uses each edge's own `id`, prefixed `edge:` so a picker can't read an edge like `voice:a->b` as a node. I checked in the library source that `edgeStyle` gets the input edge, id included.
- A: a fade-out on a clip or header that runs past the score is drawn ending at the score's end. fixed 2731553e. `slopePolygon` cuts the bar at the score's end at the height the fade has reached. The clip's fade-out handle sits at its real time and is hidden when that is off the score.
- A: the FoldStamp "Looks" story shows identical rows under different labels. fixed a973a0ee. The "bold" row now has `encode: 'none'`, and the repeated "glowing, hue" row became "glowing, both". This one has no test, because it is story content only.
- B: dragging the open score's scrub left of the time axis never reaches 0. fixed ea12b282. Both views now go through one `timeAt` helper that holds the time to 0..duration.
- B: CodePane and ExprInput send a turned-down draft again on blur. fixed ac2c1605. Both now use a shared `useDraft` hook that sends a draft once until it or `value` changes.
- B: track gradient stops are keyed by sample time, which can repeat. fixed eb9932e2. They are now keyed by position.
- B: ruler labels overprint on long scores. fixed 373b1977. A new `rulerTicks` picks a 1/2/5/10/15/30/60… second step that leaves at least 36 units between labels.

Extra:
- sweep: the same time-keyed stops are at `site/src/explainers/kit/Timeline.tsx:122`. Not fixed and not filed, because it is outside this area.

None of this needs a changelog entry: `apps/playground` is private, so no published package changes.

Checks:
- `npx vitest run apps/playground/test/geometry.test.ts`: pass (21)
- `npx vitest run apps/playground/test/codePane.test.ts`: pass (3)
- `npx vitest run apps/playground/test/scoreLanes.test.ts`: pass (4)
- `npx vitest run apps/playground/test/flowEdges.test.ts`: pass (2)
- `npm run typecheck`: pass (exit 0)
- `npm run lint`: pass (exit 0; 1 info, which was already there in `bench/levels-hash.mjs`)
- The tree is clean.

tally: 9 of 9 fixed, 0 extra fixed