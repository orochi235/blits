# Spans and joins: fitting voices into a time budget

**Status: designed 2026-10-07, not built.** No code exists for anything here. `span`, `fit`, the
hints and the last-resort option are working names awaiting the naming pass; `all`/`any` are
picked.

For whoever builds the score's next layer. It answers how a consumer gives a group of voices a
duration and has blits make them fit it, and how a start waits on more than one thing.

## Why

astv plays a phase meant to last a fixed time. Its text changes run back to back at their natural
length, each pushing the next later, and the phase ends up 15× its budget. Nothing in blits lets a
parent hold a budget against its children: a score is a namespace for anchors, with no duration,
and an anchor names one target. astv answered both itself (`scheduleMarks` in
`packages/engine/draw/text/changeOrder.ts`), which leaves blits playing times astv already fixed.

The goal: a consumer states what it wants — a budget, an order, how each child may give way — and
it works, including for conflicts nobody has foreseen yet.

## Joins

An anchor whose members are anchors, accepted anywhere an anchor is (`start`, `in`, `out`, `end`):

```ts
start: { all: [{ after: 'change-3' }, { of: 'orb-7', mark: 'end', by: 50 }] }  // once both have
start: { any: [{ after: 'change-3' }, { of: 'orb-7', mark: 'end' }] }          // once either has
```

| | Resolves to | Resolves once |
|---|---|---|
| `all` | the latest member time | every member has resolved |
| `any` | the earliest member time | one member's time has passed, or every member has resolved |

A join holds only the anchors listed in it. Each member resolves as a lone anchor does, with its
own `by`. Unresolved, the voice waits pending; resolved to a past time, it starts partway, as
today. Joins nest. A member whose voice was dropped counts as resolved at the drop; a query that
never matches keeps the join waiting.

## Spans

A span is a node in a score holding voices and other spans. It is placed like a voice, anchors can
name it, and it ends when its last child does.

```ts
const phase = m.span({
  name: 'phase',
  start: { after: 'orbs' },
  duration: 2000,
  firm: 'strong',            // 'required' | 'strong' | 'weak'
  order: 'queue',            // 'queue' | 'stagger' | 'together'
  fit: chain(compress(), overlap(), skip()),
  fallback: 'instant',       // what happens when no strategy fits: 'instant' | 'overrun'
});

phase.cue({ patch: writeChange(text), faster: 4, skip: true });
const commit = phase.span({ order: 'together' });   // spans nest
```

A child's natural length is its patch's duration over its passes and rate. Its hints say how it
may give way; anything it does not list, it will not do:

| Hint | Means |
|---|---|
| `faster`, `slower` | how far its rate may move from 1 |
| `overlap` | it may run alongside its neighbors when the span's order would not have it |
| `skip` | it may jump to its final state instead of playing |
| `firm` | how hard its own length holds against the span's budget |

## Fitting

A strategy is a plain function from the span's claim and its children's claims to a placement per
child:

```ts
type Strength = 'required' | 'strong' | 'weak';

interface Claim {
  natural: number;                    // ms left at rate 1
  state: 'pending' | 'playing' | 'done';
  faster?: number; slower?: number;
  overlap?: boolean; skip?: boolean;
  firm?: Strength;
}

type Fit = (span: { left: number; firm: Strength; order: Order }, kids: readonly Claim[])
  => readonly { at: number; rate: number; skip: boolean }[];
```

| Stock strategy | Does |
|---|---|
| `compress()` | raises every child's rate evenly, each up to its own `faster` |
| `overlap()` | tightens the order toward `together`, among children allowing overlap |
| `skip()` | jumps children to their end, latest first, among children allowing it |
| `collapse()` | applies every remaining child at one virtual instant |
| `overrun({ cap })` | lets the span run long, up to `cap` |
| `chain(...fits)` | tries each in turn, handing the shortfall left to the next |

The default fit is `chain(compress(), overlap(), skip())`. Overrunning is opt-in: it is never in the
default chain, and a span overruns only through `overrun()` or `fallback: 'overrun'`.

Where the span's budget and a child's hint cannot both hold, the weaker `firm` gives way. Where the
chain cannot fit at all, `fallback` decides: `'instant'` (the default) collapses what is left, so the
budget never breaks; `'overrun'` runs long by the shortfall. Either raises a `Doubt` saying which
claims lost. Collapsed children land on their final state together, and their events and marks
still fire, in their order, at that instant.

## Re-fitting

Children arrive while a span plays. A fit runs again when a child joins, when one leaves early
(stopped or cut), and when the span's own claim changes, batched to once per sync.

Only the future is re-fitted: the strategy sees each child's state and natural length left, and a
playing child's rate changes mid-flight as `handle.rate` does, without a jump. A fit sees only what
has arrived; a consumer expecting more can reserve budget or supply its own strategy.

A fit depends only on the calls that cued the children, which are on the tape, so `seek` and its
replay reproduce every re-fit.

## Testing

- Strategies are pure: table tests per stock strategy and for `chain`.
- Spans on a driven clock: late arrivals, a child leaving early, a `required` budget against
  `required` children under each `fallback`, nesting, and a seek back through a re-fit.
- Joins: `all` and `any` over voices and announced marks, nested, a dropped member, a query that
  never matches.
- astv's case: 12 changes in `queue` into a 2s phase end within the budget.
