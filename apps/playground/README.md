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
in dev. `scripts/docs.mjs` pulls the doc comments of `VoiceSpec` and `Handle` out of blits' types
into `src/generated/docs.json` (gitignored), which the panels show as tooltips on each field.

## The screen

The stage is top left, with a dots/letters switch above it and, beside the switch, the columns and
rows or the text; clicking a subject picks it for the inspector, top middle. The right column holds
the flow. The middle column has two tabs: **Plots**, the inspector, and **Voice**, which holds the
levels, voice and patch panels. Selecting a clip, on the score or in the flow, opens Voice. The
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
  mix?: { stepMs?: number | 'off'; maxDt?: number; reduce?: boolean; lanes?: boolean };
}
```

`mix` holds the `MixOptions` every mix of the composition is made with; the Voice tab's mix panel
edits them. Unset, `stepMs` is one frame and the rest are blits' defaults.

A `Voice` carries blits' own `VoiceSpec` field names (`start`, `rate`, `loop`, `stagger`, `target`,
`freeze`, `weight`, `fade`, `locus`, `from`, `anchor`), so the voice panel teaches the real spec, plus
an `id`, a `name`, a `hue` and a `patch`. A `PatchSource` is one of:

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

## The kit

One kit, `src/blits/kit.ts`, drives both stages, so any composition plays on either.

| Channel   | Fold                      | Dot          | Letter          |
|-----------|---------------------------|--------------|-----------------|
| `offset`  | `vec(2, sum())`           | moves        | slides, lifts   |
| `turn`    | `sum()`                   | turns a tick | tilts           |
| `scale`   | `mul()`                   | size         | size            |
| `color`   | `hex()`                   | fill         | tint            |
| `opacity` | `mul({ bounds: [0, 1] })` | alpha        | alpha           |
| `glow`    | `max()`                   | halo         | halo            |

## The score

One lane per voice, each voice one clip. `ScoreLanes` knows only clips and links between clip
edges; `src/blits/score.ts` turns voices into clips and the widget's edits back into voices.

| On the clip            | blits idea                    | Editing it                                               |
|------------------------|-------------------------------|----------------------------------------------------------|
| clip body              | `start`                       | drag sideways; locked while anchored                     |
| sloped ends            | `fade.in` / `fade.out`        | drag the slope's top corner                              |
| dividers inside        | passes of the period          | drag the right edge, snapping to whole passes: `loop`    |
| arrow at the end       | `loop: true`                  | drag it back to make the loop finite                     |
| thin bar under it      | stagger spread, first to last | none; `stagger` is an expression                         |
| hatched extension      | `freeze`                      | the clip's menu                                          |
| shared color bracket   | `locus`                       | drag a lane label onto another's, or the clip's menu     |
| dashed link            | `anchor`                      | Alt-drag from an edge to another clip's edge             |

A voice whose period is 0, an aperiodic `fn` or a motion voice, has no passes, so its right edge
does not drag.

## The flow

The right column draws the composition's signal flow, top to bottom: levels, the signal ops and
expressions they feed, the voices those weigh, the channels each voice writes with the rule each
folds by (`KIT[ch].kind`), and the pose. `flowOf` in `src/blits/flow.ts` builds it from the
composition alone, finding the levels and signal calls in each `weight`, `stagger` and `target`
with acorn; `FlowDiagram` draws it with `@weasel-js/diagram`. A voice that failed to compile, or a
level an expression names that the composition lacks, is outlined red. Clicking a channel shows its
fold: everything that reaches it, and the rest it folds from, under a breadcrumb back.

## The panels

| Panel     | Shows                                                                                   |
|-----------|-----------------------------------------------------------------------------------------|
| Voice     | the spec fields, each with blits' doc comment on hover; `stagger`, `target` and `weight` as expressions |
| Weight    | a number, or a signal expression; a menu inserts common signals                         |
| Patch     | a kind menu (switching starts a blank patch of that kind), then by kind: a weasel `Timeline` track per channel for `keys`, with an `EasingPicker` per key; code panes for `fn`; numbers or expressions per option for motion |
| Live      | in live mode only: weight; `fade` with its `over`, `at` (a mix time or `'rest'`), `deadline` or the picked `subject`, and `rise`; `seek`, showing the `Doubt` it answers, with `state: 'keep'`; the `rate` setter and `ramp`; and for a motion voice a per-subject `to` (a glide's `velocity`, by `push`) |
| Inspector | for the picked subject, a plot per channel over the last 3 s: each voice alone thin, the mix thick; then each voice's `weightOf` |

Every voice's errors show on their own field. Two voices with one name are an error on the second
one's `name`, since anchors find voices by name.

## How it runs

- **Compile.** `compile` (`src/blits/compile.ts`) is pure: a composition and its subjects in, the
  full mix out, with handles and patches by voice id, a solo mix per voice for the inspector, and
  errors by field. A voice with errors is left out; the rest still play. Every edit recompiles and
  replays to the playhead.
- **Play and scrub.** The `Player` (`src/blits/player.ts`) advances in whole 1000/60 ms frames and
  pulls every subject every frame, in every mix, so live play and a replay give the same poses.
  Scrubbing forward plays ahead; scrubbing back rebuilds and replays from 0, because a stateful
  signal or a spring reads each frame's gap.
- **The inspector reads only public API.** Each solo mix plays one voice and is read with `probe`;
  blits exposes no per-voice contribution, and the playground does not reach inside for one. The
  Player records the picked subject's history as it steps, so a plot never replays anything.
- **Levels.** A slider move is not recorded into the composition. It survives rebuilds, so a scrub
  back replays it at the slider's current value, and it is dropped when the composition's own value
  for that level changes or the level goes away.
- **Live mode.** While the transport's live toggle is on, the live panel acts on the running
  handles instead of the composition. A change reaches the voice in the full mix and in every solo
  mix, where it plays silent but keeps time for anything anchored to it; a weight lands only where
  the voice is heard. A badge says the changes are in force; the next edit or backward scrub drops
  them.
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
| spring retarget | `spring` on `offset`, retargeted from live mode               |
| freeze handover | `freeze: 'after'`, the next voice's start fading the last out |
| pointer glow    | weight as `slew(level('mouse'))`                              |
| fold rules      | one delta through `sum`, `mul` and `max`                      |

## Widgets

`src/widgets/` holds `ScoreLanes`, `ExprInput`, `CodePane`, `ChannelPlot` and `FlowDiagram`. They are written to
move to weasel later: plain props, CSS modules on weasel's theme tokens, a forge story each, and
**no imports from blits or from `@pg/blits`**. The adapters in `src/blits/` and `src/app/` map blits
onto them.

## Tests

`test/` is vitest in a node environment, over the pure modules only: each patch kind compiled from
a composition gives, to the bit, the poses the matching hand-written `cue` gives; a scrub back over
a stateful voice lands on the pose continuous play showed; the score round-trips voice to clip to
edit to voice; a bad expression errors on its field while compile still returns; a composition
edit stays inside what `load` accepts; every preset compiles and plays clean. The smoke run covers
the rest in a real browser, failing on a console error, a page error or a blank stage; `--shots <dir>` keeps its screenshots, which otherwise go to a
temp directory removed on exit.

The root `npm run check` lints the playground and runs its tests, but leaves out its typecheck and
smoke run, as it does the site's: the release workflow deletes `workspaces` before `npm publish`
runs `check`, so a workspace step there would fail the release. `npm run playground:check` runs
the typecheck, the tests and the smoke run.

## Not in this version

- Reading back (`history` and `project` at a past time) and drained events, as panels of their own.
- Recording level moves.
- Saving to a file.
