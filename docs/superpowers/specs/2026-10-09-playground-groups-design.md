# Playground groups: owners and spans

**Status: designed and approved 2026-10-09, being built on `playground-groups`.** Delete this file
once the build merges; the playground README carries what stays true.

**For:** whoever builds or reviews this. **Answers:** how the playground offers blits' owners
(`mix.owns`) and spans (`mix.span`) with their fits, which is HANDOFF item 13's first unbuilt
entry. Read blits' `OwnerSpec`, `SpanSpec`, `SpanHints` and `src/fit.ts` first.

## Composition

A new optional `groups` list. Both records use blits' own field names.

```ts
interface Group {
  id: string;
  name: string;
  hue: number;
  kind: 'owner' | 'span';
  owner?: string;            // the parent group's id
  start: number;
  rate: number;
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  freeze?: 'before' | 'after' | 'both';
  anchor?: Placement;
  hints?: Hints;             // read only when the parent is a span
  span?: {                   // only on kind 'span'
    duration?: number;
    priority?: Strength;
    order?: Order;
    share?: number;
    spill?: 'instant' | 'overrun';
    fit?: FitStep[];         // unset: blits' default fit
  };
}
type Hints = { faster?: number; slower?: number; overlap?: boolean; ballast?: boolean; priority?: Strength };
type FitStep =
  | { kind: 'condense' } | { kind: 'shed' } | { kind: 'conclude' }
  | { kind: 'overrun'; cap?: number }
  | { kind: 'code'; code: string };   // (span, kids, plan) => plan, with plain and layout in scope
```

`Voice` gains `owner?: string` and `hints?: Hints`. A fit-step list compiles to `pipe(...)` of its
steps; the editor offers blits' default (`condense, shed`) and `lax` (`condense, shed, overrun`)
as presets. `version` stays 1; `groups` absent means none. `MAX_GROUPS` is 16.

## Order

`voices` stays in cue order, which is fold order. A group sits in the score just before its first
member (directly, or through a nested group); a group with no members sits at the end. A span lays
out its children in that same order. `compile` cues the tree depth-first in that order, each group
before what it holds, so blits sees the order the score shows. Moving a lane moves a group's whole
block.

## What blits refuses, and where the playground meets it

| blits refuses | The playground |
|---|---|
| a span child with a `start` or a start anchor | joining a span drops the voice's `start` and start anchor; the score does not drag its body; a hand-edited one is a field error |
| an owner (not a span) held by a span | the `owner` menu does not offer it; `load` refuses it |
| a span child that never ends (`loop: true`, motion) | a field error on `loop` / `patch` |
| a `loop` on an owner | owners have no `loop` field |

`load` also refuses an unknown `owner`, a cycle, and more than `MAX_GROUPS`.

## Score

Each group gets a header lane with a ▾ that folds its members away; members are indented one step
per depth. The ScoreLanes widget stays blits-free: it takes `rows` (headers and clips, each with a
`depth`), and a header carries `start`, `end`, an optional `budget`, `over` and `fell`.

- A span's header draws a bar to where its children end, a budget line, a red stretch for
  `result.over`, and a "fell" badge when `spill` decided.
- A clip under a span is placed where blits put it: `start` from the compiled mix's `start` mark
  (`mix.marks`), its length from its handle's `rate`, labeled with the factor over the voice's own
  rate (×1.3), and drawn as a dashed ghost at its natural length when it was skipped. It is locked.
- Every clip's length divides by its rate; until now the score drew every clip at rate 1.

## Panels

- **Group panel**, in the Voice tab when a header is selected: name, kind, start/anchor (hidden
  inside a span), rate, weight (number or signal expression), fade, freeze, hints (inside a span),
  and for a span its budget, priority, order, share, spill, the fit-steps editor (add, remove,
  reorder, presets; a code step is a `CodePane`), and the live `FitResult`.
- **Voice panel** gains an `owner` menu and, under a span, the hints.
- **Live panel** drives a selected group's handle as it drives a voice's: `rate`, `ramp`, `seek`,
  `weight`, `fade`, `rise`.
- "add group" beside "add voice". Deleting a group moves its members up to its parent.

## Flow and inspector

A group is a flow node between the weight signals and the voices it holds, feeding each one's
weight; an owner's own weight expression feeds it as a voice's does. The inspector lists each
enclosing group's `weightOf` under a voice's.

## Solo mixes

Every solo mix cues every group, so timing and fits match the full mix; only voices other than the
soloed one play at weight 0.

## Tests

Each in the existing pattern: owner and span compositions compile to poses identical to the bit to
hand-written `owns`/`span` cues; each fit-step list matches its `pipe(...)` on a span's
`FitResult`; `load` refuses each case above; the score round-trips with groups and reads fitted
starts from marks; edits stay loadable. Two presets, "owner fade" and "span fit", play clean in
the smoke run.
