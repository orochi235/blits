# Flow diagram: a composition's signal flow in the playground

**Status: designed 2026-10-07, not built.** No code exists for anything here.

For whoever builds the playground's diagrams, in blits and in weasel. It answers what the playground
draws to show where a channel's value comes from, and what `@weasel-js/diagram` gains to draw it.

## Roadmap

Four views, built in this order. Each gets its own spec when it starts; only the first is designed
here.

| | View | Answers |
|---|---|---|
| A | **Signal flow** (this spec) | where a subject's `alpha` comes from and how it folds |
| B | Timing graph: voices linked by `anchor`, `all`/`any` joins and spans, `locus` groups as containers | what waits on what |
| C | A and B together, as two views of one composition or one diagram with both kinds of edge | both |
| D | Editable: dragging port to port authors an anchor, or wires a weight to a signal | the diagram as an input |

Also wanted later, not scheduled: a mixer-desk drawing of A, with each channel a horizontal bus
ending in its rule and each voice a vertical strip tapping the buses it writes.

The graph is built from the playground's `Composition` first. Once the UI settles, a public
`describe()` on blits' `Mix` should produce the same graph shape for any host, at which point
`flowOf` becomes a thin adapter.

## The screen

The flow takes the right column, which holds the levels, voice and patch panels today. Those move to
the middle column, which becomes two tabs: **Plots** (the inspector as it is) and **Voice** (the
levels, voice and patch panels). The column is tall and narrow, so the flow runs top to bottom:
levels at the top, pose at the bottom.

- Clicking a voice node selects that clip, as clicking it on the score does, and switches the
  middle column to **Voice**.
- Clicking a channel node replaces the flow with that channel's **fold tree**, under a
  `Flow › color` breadcrumb that leads back.

The flow is static in this version: it redraws when the composition changes, not per frame. Live
values come later; every node and edge id is stable across edits so that pass can address them, and
it adds a restyle path to `DiagramView`.

## The graph: `flowOf(composition)`

A pure function in `apps/playground/src/blits/flow.ts`, no React, returning `{ nodes, edges }`.

| Node | Id | Label | From |
|---|---|---|---|
| level | `level:<name>` | name and range | `comp.levels` |
| signal | `sig:<voice>:<field>:<path>` | the op and its arguments, e.g. `slew(riseMs 150, fallMs 900)` | a call to `gate`, `lag`, `peak`, `slew` or `level` in an expression, found with acorn |
| expr | `expr:<voice>:<field>` | the source, shortened: `1 − level("mix")(s, set)` | an expression that is not a plain chain of signal calls; its inputs are the levels and signals it reads |
| voice | `voice:<id>` | name in its hue, patch kind and period, `loop` | `comp.voices` |
| channel | `ch:<name>` | name and rule: `color · hex` | each channel some voice writes; the rule from `KIT` |
| pose | `pose` | `pose × 32 dots` | the stage |

Edges: level → signal or expr → voice, labeled with the field fed (`weight`, `stagger`, `target`);
voice → each channel it writes; channel → pose.

A voice writes: for `keys`, the union of channels across its stops; for `fn`, its `writes`; for
`spring`, `glide` and `tween`, its `channel`. A constant weight has no input node and shows on the
voice.

A voice that fails to compile is still drawn, outlined in the error color. An expression acorn cannot
parse becomes one expr node with no inputs. `locus`, `anchor`, joins and spans are not drawn; they
are view B.

**The fold tree** for a channel is that channel node's ancestors in the same graph, plus a `rest`
node when the channel has a rest (`KIT[ch].rest`; `hex` has none), drawn by the same widget with
`layered` running up, so the channel sits at the top. Edges point toward the channel, which suits
`layered` and not `tree`.

## weasel-diagram gains

| Addition | Why |
|---|---|
| `diagramScene(data, opts)`: plain `{ nodes, edges }` in, scene specs out, laid out | a consumer today assembles scene nodes, traits and edge nodes by hand |
| a barycenter crossing-reduction option on `layered` | `layered` keeps the existing in-rank order, which is right for a hand-arranged diagram and wrong for a generated one with no order to keep; the option stays off by default |
| `DiagramView`: a read-only view with pan, zoom and node selection, no connect gesture, with style callbacks per node and per edge | a display surface, and the hook live weights will use |

All three are public API with tests in weasel, and a demo on weasel's site beside the other diagram
demos. The crossing pass is deterministic:
no RNG, same input, same output.

## Packaging

First, blits moves every `@weasel-js/*` from 1.7.3 to the published 1.8.1, the site included. During
development the playground installs a local pack of weasel-diagram from a weasel worktree, so it runs
against its own `@weasel-js/core`. When done, weasel releases 1.9.0 (Mike's call) and blits pins it
everywhere. The weasel work stays on a branch until then.

## Files

| Where | What |
|---|---|
| `apps/playground/src/blits/flow.ts` | `flowOf` and the fold-tree subgraph |
| `apps/playground/src/widgets/FlowDiagram/` | the widget and its stories, flow and fold; knows graph data only |
| `apps/playground/src/app/FlowPanel.tsx` | wires the widgets to the composition, selection and breadcrumb |
| `apps/playground/src/app/App.tsx`, `App.module.css` | the middle column's tabs, the right column's flow |
| `apps/playground/README.md` | the screen, the panels table, the flow |

## Testing

- `flowOf`: vitest in `apps/playground/test`. Each preset gives a fixed node and edge list; a broken
  expression gives one expr node; a failed voice is present and marked.
- Stories: `FlowDiagram` per preset, a crowded one with many voices to judge crossings, and a fold.
- weasel: barycenter tests for fewer crossings and determinism; tests for `diagramScene` and the
  selection mirror; a site demo for `DiagramView`.
- `playground:smoke` loads each preset with the flow showing.
