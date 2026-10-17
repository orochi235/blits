# The blits playground

A browser app for composing with blits: lay voices out on a score, watch them play on a stage of
dots or letters, and see how each channel folds. It is for learning blits by using it, and for
trying UI ideas meant for apps downstream of blits. What it outputs matters little: a composition
lives in the browser and can be shared by URL, but nothing downstream loads it. There is no
variant mechanism for UI ideas; an idea gets built into the app.

```
npm run playground         # from the repo root: field docs from blits' types, then Vite on :: port 4881
npm run playground:smoke   # build, then play every preset for a second in headless Chromium
npm run playground:check   # typecheck, the pure tests and the smoke run
npm run stories -w @blits/playground   # forge stories for the widgets, on port 4882
npx vitest run apps/playground/test    # the pure modules
```

blits comes from the repo's own `src/index.ts` through the `@msb235/blits` alias, never the built
`dist`, and app code imports itself through `@pg/*`. The site's nav links here when the site runs
in dev. `scripts/docs.mjs` pulls the doc comments of `VoiceSpec`, `Handle`, `Mix`, `MixOptions`, `SpanHints`, `OwnerSpec`, `SpanSpec`, and `FitResult` out of blits' types
into `src/generated/docs.json` (gitignored), which the panels show as tooltips on each field.

## The screen

The stage is top left, with a dots/letters switch above it and, beside the switch, the columns and
rows or the text; clicking a subject picks it for the inspector, top middle. The right column holds
the diagrams, on two tabs: **Flow** and **Timing**. The middle column has three tabs: **Plots**, the inspector; **Voice**, which holds the
levels, voice and patch panels; and **Events**, what the score knows and reports. Selecting a clip, on the score or in either diagram, opens Voice. The
score fills the bottom, with the transport above it: play and pause, rate, loop, a slider per
level, a choice of how a scrub back moves the mixes, and the live toggle, with the mix's own `rate` beside it in live mode: the transport's rate
slows the playground's clock, while the mix's slows the voices as the score's clock runs on.
A scrub back either replays from 0, which shows exactly what playback showed, or calls blits'
`mix.seek`, which restores from the history every mix keeps. Either way the inspector labels each
channel with blits' `assess` answer for the picked subject: `exact`, `stepped`, or `held`. Space plays and pauses from anywhere but a text field or the score's
own handles, which take it themselves. The header holds the preset menu, the title and the length.

These composition edits go through the same history as every other, so undo, storage and share
cover them, and `src/blits/edit.ts` holds each one to the `MAX_*` caps `load` enforces. Switching
the stage's kind starts from 12 by 6 dots or the text `blits`. A level's name must be unique and not
blank, and its bounds may not cross; its value is held inside them. A text or number field commits
on Enter or leaving it, so typing is one undo step. Removing or renaming a level an expression names
is allowed: the expression then reads 0, with no error.

## A composition

Plain data, in `src/blits/composition.ts`:

```ts
interface Composition {
  version: 1;
  title: string;
  stage: { kind: 'dots'; cols: number; rows: number } | { kind: 'letters'; text: string };
  length: number;                        // ms the score shows
  levels: { name: string; value: number; min: number; max: number }[];
  voices: Voice[];                       // cue order, which is fold order
  groups?: Group[];                      // owners and spans; see Groups
  blends?: Record<string, Expr>;         // by locus: the signal `mix.blend` splits; see Blends
  announced?: { name: string; at: number; score?: string; tags?: string[] }[];  // `mix.announce`
  mix?: { stepMs?: number | 'off'; maxDt?: number; reduce?: boolean; lanes?: boolean };
  rules?: Partial<Rules>;                // each channel's fold rule, where it differs from the default
}
```

`mix` holds the `MixOptions` every mix of the composition is made with; the Voice tab's mix panel
edits them. Unset, `stepMs` is one frame and the rest are blits' defaults.

`rules` picks each channel's fold rule, from which `kitOf` in `src/blits/kit.ts` makes the kit
every mix, wave, and flow node reads. A number channel takes `sum`, `mul`, `max`, or `last`, and
all but `last` take `bounds`; `offset` folds its two numbers alike, so not by `last`; `color`
replaces or averages, interpolated in OKLCH or OKLab. The fold rules panel edits them and shows the
kind each makes.

A `Voice` carries blits' own `VoiceSpec` field names (`start`, `rate`, `seek`, `stepMs`, `loop`, `stagger`, `target`,
`freeze`, `weight`, `fade`, `locus`, `from`, `anchor`, `tags`, `score`, `hits`), so the voice panel teaches the real spec, plus
an `id`, a `name`, a `hue`, a `patch`, the `owner` group it plays under, and the `hints` a span
reads. A `PatchSource` is one of:

| `kind`                       | Holds                                                                  |
|------------------------------|------------------------------------------------------------------------|
| `keys`                       | `period`, `stops` (blits `Keyframe`s of the pose), an optional `ease`, and per channel an `easeBy` curve and a `delayBy` wait |
| `fn`                         | `period`, the channels it `writes`, and the source of `at`, `state`, `step` |
| `wave`                       | `period`, `shape`, `cycles`, `phase`, and a `depth` for each one-number channel; it swings around the kit's rest |
| `spring`, `glide`, `tween`   | the `channel` it moves and its `opts`; a tween also takes an `ease`    |

An `Expr` is `{ code }`, the source of a function: `(s) => …` over a subject for `stagger` and
`target`, or a signal for `weight`, such as `slew(level('mouse'), { riseMs: 150, fallMs: 900 })`.
It is compiled with `new Function` in a scope holding `slew`, `lag`, `peak`, `gate` and
`level(name)`, which reads the composition's level of that name (0 for a name it lacks). A throw
inside the returned function rests that call and is counted, and the field shows the count and the
first message, so one bad subject cannot take down a frame. A syntax error is marked on its line,
found by parsing with acorn because V8's stack does not carry it.

Eases are stored as data blits can keep: a CSS name or `{ bezier }` points. The keys timeline's
picker offers more, and a curve with no bezier form, such as bounce or elastic, is refused, leaving
the stop's old ease in place.

A subject is `{ index, row, col, x, y, char }`, with `x` and `y` from 0 to 1. Dots fill `row`, `col`,
`x` and `y`; letters fill `index` and `char`, with `col` equal to `index`.

## Marks, hits, and events

`announced` holds the marks the composition puts on a score: `compile` calls `mix.announce(name,
{ at })` for each on every mix before it cues, so `{"start": {"with": "beat"}}` waits for one. A
voice's `anchor` is blits' `Placement` as data, typed as JSON in the voice or group panel and
checked by `placementFault` in `src/blits/anchor.ts`, which `load` uses too: `start` or `in`, and
`out` or `end`, each a time or an anchor by `of` and `mark`, `after`, `with`, `before`, `all`, or
`any`, selecting by name or by a query of `name`, `tag`, `writes`, `score`, and `resolver`. A
voice's `hits` are events at voice ms into each pass, each event a string; a group's are at ms on
its own clock, once.

The `Player` keeps an `EventLog` (`src/blits/events.ts`) on the full mix: a booker made with
`mix.book` against the host clock, 100 ms ahead, which records every mark and hit it is handed and
strikes one out when blits takes the booking back; and what `mix.drain` returns after each frame.
An fn patch sends with `set.send(event)` in its `at` or `step`. Each list keeps its newest 200,
and starts over when the mixes are rebuilt. With a tag set, the booker and the drain take only
voices and groups carrying it, and the rest of what was sent is drained and thrown away.

## Blends

A locus named in `blends` is cued with `mix.blend(patches, by, spec)` instead of a `cue` per voice:
its voices' weights are shares of the one signal, each voice a stop spaced evenly from 0 to 1 in
cue order, and each voice's own `weight` goes unread. `mix.blend` takes one spec for all of them,
so everything but `id`, `name`, `hue`, and `patch` is held the same on every member:
`src/blits/blend.ts` makes an edit to one member on all, and gives a voice that joins what the
others share. A member loaded with a field that differs errors on its `locus`. The members are
cued together where the first sits and answer to its name in an anchor, since the one spec carries
one `name`. In a solo mix they are plain voices of one locus, the soloed one weighted by its share,
which the playground computes itself because blits exposes no member's share.

## The kit

One kit, `src/blits/kit.ts`, drives both stages, so any composition plays on either.

| Channel   | Fold                      | Dot          | Letter          |
|-----------|---------------------------|--------------|-----------------|
| `offset`  | `vec(2, sum())`           | moves        | slides, lifts   |
| `turn`    | `sum()`                   | turns a tick | tilts           |
| `scale`   | `mul()`                   | size         | size            |
| `color`   | `color(last(), { lerp: 'oklch' })` | fill | tint            |
| `opacity` | `mul({ bounds: [0, 1] })` | alpha        | alpha           |
| `glow`    | `max()`                   | halo         | halo            |

## Groups

A `Group` is an owner (`mix.owns`) or a span (`mix.span`), with blits' own field names:

```ts
interface Group {
  id: string; name: string; hue: number;
  kind: 'owner' | 'span';
  owner?: string;                        // the parent group's id; groups nest
  start: number; rate: number;          // a span's rate is 0 or more
  seek?: number;                         // where its clock starts; unset: 0
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  freeze?: 'before' | 'after' | 'both';
  anchor?: Placement;
  tags?: string[]; score?: string;
  hits?: Hit<string>[];                  // at ms on its own clock, booked once
  hints?: Hints;                         // read only when the parent is a span
  span?: {                               // only on kind 'span'
    duration?: number; priority?: Strength; order?: Order; share?: number;
    spill?: 'instant' | 'overrun';
    fit?: FitStep[];                     // unset: blits' default fit
  };
}
type Hints = { faster?: number; slower?: number; overlap?: boolean; ballast?: boolean; priority?: Strength };
```

An owner plays what it holds on its own clock, and its `rate`, `weight` and `fade` multiply into
theirs, so it places, times and fades them as one. Below rate 0 that clock runs back from its
`seek`, and each member plays backward from its end to its start, where it leaves; the score
draws a member there and marks the group `backward`. A group's `tags` and `score` are its own,
not its members': a query, a booker, or a drain by tag selects the group alone. Its hits are
notches on its header bar, where its clock reaches each from its `seek` until it ends, and none
while it runs back, since blits books none then. A span is an owner that lays its children out
in `order` and fits them into its `duration`. A child's `hints` say how it may give way: play up to
`faster` or `slower` times its rate, run alongside the one before (`overlap`), or be skipped
(`ballast`).

A fit is a list of steps that compiles to blits' `pipe(...)` of them, tried in turn until the
children fit, so a fit does nothing to a span inside its budget:

| Step             | blits        | Does                                                       |
|------------------|--------------|------------------------------------------------------------|
| condense         | `condense()` | starts `overlap` children sooner, toward all at once       |
| shed             | `shed()`     | skips `ballast` children, latest first                     |
| overrun          | `overrun()`  | lets the span run past its budget, up to `cap` times it    |
| conclude         | `conclude()` | skips every child                                          |
| code             | your function | `(span, kids, plan) => plan`, with `plain` and `layout` in scope; a throw keeps the plan it was given |

Before any step, blits retimes every child toward the budget within its `faster` and `slower`.
The editor's presets are blits' default (condense, shed) and `lax` (condense, shed, overrun).

`voices` stays in cue order. A group sits just before its first member, directly or through a
nested group, and a group with no members sits at the end; `rowsOf` in `src/blits/groups.ts` gives
that order, and `compile` cues depth-first in it, each group before what it holds, so blits sees
the order the score shows. A span lays out its children in that order too. Every solo mix cues
every group, so timing and fits match the full mix.

blits refuses some trees, and the playground meets each before blits sees it:

| blits refuses                                  | The playground                                           |
|------------------------------------------------|----------------------------------------------------------|
| a span child with a `start` or a start anchor  | joining a span sets `start` to 0 and drops the start anchor; the score does not drag its body; one set by hand is a field error |
| a span child that never ends                   | joining a span makes `loop: true` one pass; a motion voice keeps a field error on `patch` |
| an owner, not a span, held by a span           | the `owner` menu does not offer it, and `load` refuses it |
| a `loop` on an owner                           | groups have no `loop` field                              |
| a span cued at a rate below 0                  | its rate slider stops at 0, and one loaded below is a field error on `rate` |

`load` also refuses an unknown `owner`, a cycle, and more than `MAX_GROUPS` (16). A group with
errors is left out with everything under it, each member erroring on its `owner`.

## The score

One lane per voice and per group. `ScoreLanes` knows only clips, headers and links between clip
edges; `src/blits/score.ts` turns voices and groups into them and the widget's edits back into
voices. A clip's length divides by its rate, and by every owner's above it. A group's lane is a
header, and its members sit under it, indented one step per depth.

| On the clip            | blits idea                    | Editing it                                               |
|------------------------|-------------------------------|----------------------------------------------------------|
| clip body              | `start`                       | drag sideways; locked while anchored                     |
| sloped ends            | `fade.in` / `fade.out`, mix ms at any rate | drag the slope's top corner                 |
| dividers inside        | passes of the period          | drag the right edge, snapping to whole passes: `loop`    |
| a shorter clip, "· backward" after the label | a `seek`, or a rate below 0: what is left to play from where it starts, back to 0 at a rate below 0 | the voice panel; its right edge does not set `loop` |
| arrow at the end       | `loop: true`                  | drag it back to make the loop finite                     |
| thin bar under it      | stagger spread, first to last | none; `stagger` is an expression                         |
| hatched extension      | `freeze`                      | the clip's menu                                          |
| shared color bracket   | `locus`; "· blend" after the label where `mix.blend` cues it | drag a lane label onto another's, or the clip's menu |
| dashed link            | `anchor`, where it names one voice | Alt-drag from an edge to another clip's edge for `after` or `with`; the voice panel for the rest |
| notch on the top edge  | a hit, every pass             | the voice panel                                          |
| dotted line down the score | an announced mark, named on the ruler | the Events tab                                 |
| header bar             | a group, from its start to its end, sloped by its `fade` | ▾ folds its members away; click to select |
| clip cut at a group's end | a member still playing when a group above it ends, sloped by that group's `fade.out` | the right edge stops at the cut; dragging it left snaps to whole passes before it |
| budget line, red hatch | a span's `duration`, and `result.over` past it; "fell" when `spill` decided | the group panel |
| clip under a span      | where the fit put it, ×1.5 after the label for a fitted rate | locked; the span places it |
| dashed outline         | a child the fit skipped, at its natural length | none                                    |

A voice whose period is 0, an aperiodic `fn` or a motion voice, has no passes, so its right edge
does not drag. A voice at rate 0 never ends, and neither does one cued backward that loops for
good, which has no end to start from. `playOf` in `src/blits/clip.ts` works out what a `seek` and
a rate leave to play, and a test holds it to blits' `coast` mark. Placements come from the compiled mix's marks (`mix.marks`) before its first frame,
so the score draws the fit blits made at cue.

## The flow

The right column draws the composition's signal flow, top to bottom: levels, the signal ops and
expressions they feed, the groups and voices those weigh, each group feeding what it holds, the channels each voice writes with the rule each
folds by (its `kind` in the composition's kit), and the pose. `flowOf` in `src/blits/flow.ts` builds it from the
composition alone, finding the levels and signal calls in each `weight`, `stagger` and `target`
with acorn; `FlowDiagram` draws it with `@weasel-js/diagram`. A voice or group that failed to compile, or a
level an expression names that the composition lacks, is outlined red. Clicking a channel shows its
fold: everything that reaches it, and the rest it folds from, under a breadcrumb back.

## The timing

The right column's Timing tab draws what waits on what. An edge runs from each voice, group or
announced mark an anchor names to what it places, labeled with the mark it sets and how: `start
after +200 ms`, `out with`, `in its coast`. An `all` or `any` is a node its anchors feed. A query
that selects among voices (`{ tag }`, `{ writes }`, a `resolver`) is a node too, fed by a dashed
edge from every voice it could pick. A name no voice or group has is a mark, with the time the
composition announces it, or `when the host announces it`. An owner or span is a box around what it
holds, boxes nesting as the groups do; a span's children are chained by a dashed edge, `then` under
`queue` and the share under `stagger`. A voice no anchor starts says where it starts, and a
`locus` is named on its voices: a box holds one thing, and a voice has both an owner and a locus.

`timingOf` in `src/blits/timing.ts` builds it from the composition alone. `lit` then reads the
player's full mix each frame: a voice or group still `pending` has a dashed outline, one playing a
heavy one, one `done` a faint one, and an edge is dim until what it waits on has happened. An edge
that sets a mark is met when its own voice has passed that mark. One into a join or a query is met
when its source's state says the awaited mark is behind it, which ignores the anchor's `by`.

## The panels

| Panel     | Shows                                                                                   |
|-----------|-----------------------------------------------------------------------------------------|
| Voice     | the spec fields, each with blits' doc comment on hover; `rate` from -4 to 4 and a `seek`, blank for blits' default; for a patch with a `step`, its own `stepMs`, blank for the mix's; `stagger`, `target` and `weight` as expressions; an `owner` menu, and under a span the hints, with `start` disabled; with a `locus`, a button to blend it, and for a blend its `blend by` signal and this voice's stop in place of `weight`; `anchor` as JSON, with a menu of placements to start from; `tags`, `score`, and `hits` |
| Group     | in place of Voice and Patch when a header is selected: name, kind, `owner`, start and anchor (not under a span), rate, weight, fade, freeze, hints under a span; for a span its `duration`, `priority`, `order`, `share` (for `stagger`), `spill`, the fit steps (add, remove, reorder, presets; a code step in a code pane), and the live `FitResult` |
| Weight    | a number, or a signal expression; a menu inserts common signals                         |
| Patch     | a kind menu (switching starts a blank patch of that kind), then by kind: a weasel `Timeline` track per channel for `keys`, with an `EasingPicker` per key; code panes for `fn`; numbers or expressions per option for motion |
| Live      | in live mode only: weight; `fade` with its `over`, `at` (a mix time or `'rest'`), `deadline` or the picked `subject`, and `rise`; `seek`, showing the `Doubt` it answers, with `state: 'keep'`; the `rate` setter and `ramp`, which take a rate below 0 for a voice and not for a group; and for a motion voice a per-subject `to` (a glide's `velocity`, by `push`). A selected group gets the same on its handle in every mix, less `to`, and fades only as a whole |
| Events    | the announced marks, to add, name, time, and remove; in live mode, `announce` a name now; a tag to book and drain by; then `mix.marks` for the running mix, what `mix.book` handed over, and what `mix.drain` returned, newest first |
| Inspector | for the picked subject, a plot per channel over the last 3 s: each voice alone thin, the mix thick; then each voice's `weightOf`, and each enclosing group's |

Every voice's errors show on their own field. Two voices or groups with one name are an error on
the second one's `name`, since anchors find them by name. "add group" beside "add voice" adds an
owner or a span; deleting a group moves what it held up to its parent.

## How it runs

- **Compile.** `compile` (`src/blits/compile.ts`) is pure: a composition and its subjects in, the
  full mix out, with handles and patches by voice id, a solo mix per voice for the inspector, and
  errors by field. A voice with errors is left out; the rest still play. Every edit recompiles and
  replays to the playhead.
- **Play and scrub.** The `Player` (`src/blits/player.ts`) advances in whole 1000/60 ms frames and
  pulls every subject every frame, in every mix, so live play and a replay give the same poses.
  Scrubbing forward plays ahead; scrubbing back rebuilds and replays from 0, because a stateful
  signal or a spring reads each frame's gap, or calls `mix.seek` where the transport's scrub choice
  says so, falling back to the replay where history cannot reach.
- **The inspector reads only public API.** Each solo mix plays one voice and is read with `probe`;
  blits exposes no per-voice contribution, and the playground does not reach inside for one. The
  Player records the picked subject's history as it steps, so a plot never replays anything.
- **Levels.** A slider move is not recorded into the composition. It survives rebuilds, so a scrub
  back replays it at the slider's current value, and it is dropped when the composition's own value
  for that level changes or the level goes away.
- **Live mode.** While the transport's live toggle is on, the live panel acts on the running
  handles instead of the composition. A change reaches the voice in the full mix and in every solo
  mix, where it plays silent but keeps time for anything anchored to it; a weight lands only where
  the voice is heard. A badge says the changes are in force; the next edit drops them, and so does a
  backward scrub by replay, while one by `mix.seek` plays them again.
- **State.** The current composition is kept in `localStorage`; undo and redo (Cmd/Ctrl-Z,
  Shift for redo) use labkit's pure undo-stack functions. Share copies a link carrying the
  composition as base64url of its UTF-8 JSON in `#c=…`; the app loads it once and clears it from
  the address bar, so a reload keeps later edits. Every loaded composition, from a link or from
  storage, passes `load` (`src/blits/load.ts`): a wrong `version`, a missing field or a size past
  the `MAX_*` caps in `composition.ts` falls back to the default preset rather than a blank page.
  Nothing is written to disk.

## Presets

One `Composition` per file in `src/blits/presets/`.

| Preset          | Shows                                                         |
|-----------------|---------------------------------------------------------------|
| stagger wave    | `stagger` as an expression of column, with `fade.in`; the default |
| crossfade       | two voices in one `locus`, weight handed between them by a level |
| blend           | three voices in one `mix.blend`, split across the stage by column and slid by a level |
| spring retarget | `spring` on `offset`, retargeted from live mode               |
| freeze handover | `freeze: 'after'`, the next voice's start fading the last out |
| pointer glow    | weight as `slew(level('mouse'))`                              |
| fold rules      | one delta through `sum`, `mul` and `max`                      |
| owner fade      | an owner fading three voices in and out as one, its weight a level |
| span fit        | 2.9 s of voices in a 2 s span: one sped up (`faster`), one alongside (`overlap`), one shed (`ballast`), and 100 ms over, inside `overrun`'s 1.2 cap |
| marks and hits  | a voice tagged `lead` with two hits a pass, one anchored to its `coast` by tag, one waiting on the announced mark `beat`, and an fn voice that sends its pass number |
| anchors         | one voice waiting on an `all` of a voice and the mark `beat`, one on an `any` of a voice and a tag query, a queue span anchored after the first, and a voice anchored to the span's `end` |
| backward        | one sweep three ways: forward, cued at rate -1 from its end, and cued with a `seek` halfway in |

## Widgets

`src/widgets/` holds `ScoreLanes`, `ExprInput`, `CodePane`, `ChannelPlot` and `FlowDiagram`, which draws both the flow and the timing. They are written to
move to weasel later: plain props, CSS modules on weasel's theme tokens, a forge story each, and
**no imports from blits or from `@pg/blits`**. The adapters in `src/blits/` and `src/app/` map blits
onto them.

## Tests

`test/` is vitest in a node environment, over the pure modules only: each patch kind compiled from
a composition gives, to the bit, the poses the matching hand-written `cue` gives, and an owner or
span the poses of hand-written `owns` or `span`; each fit-step list matches its `pipe(...)`; a scrub back over
a stateful voice lands on the pose continuous play showed; the score round-trips voice to clip to
edit to voice; a bad expression errors on its field while compile still returns; a composition
edit stays inside what `load` accepts; every preset compiles and plays clean. The smoke run covers
the rest in a real browser, failing on a console error, a page error, or a blank stage, flow or timing diagram; `--shots <dir>` keeps its screenshots, which otherwise go to a
temp directory removed on exit.

The root `npm run check` lints the playground and runs its tests, but leaves out its typecheck and
smoke run, as it does the site's: the release workflow deletes `workspaces` before `npm publish`
runs `check`, so a workspace step there would fail the release. `npm run playground:check` runs
the typecheck, the tests and the smoke run.

## Not in this version

- Reading back (`history` and `project` at a past time), as a panel of its own.
- A rate below 0 on a span, which blits refuses at its cue.
- A booker with a clock other than the player's own.
- Recording level moves.
- Saving to a file.
