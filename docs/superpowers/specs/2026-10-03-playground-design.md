# blits playground — design

**Status: designed 2026-10-03, not built.** Branch `playground`. This document is scaffolding: once
the app exists, what stays true moves into `apps/playground/README.md` and this file is deleted.

**For:** whoever builds the playground, and Mike when he comes back to change it. **Answers:** what
the playground is for, what a composition is, how the screen is laid out, how each blits idea is
drawn and edited, and how playback works.

## Purpose

A place to compose with blits, watch it play, and learn how it works by doing. Output is secondary:
a composition is kept in the browser and can be shared by URL, but nothing downstream loads it. It
is also where UI ideas for apps downstream of blits get tried, informally — there is no variant
mechanism; an idea is built into the app.

Every widget is written so it can move to weasel later: widgets know nothing of blits, take plain
props, follow weasel's conventions (CSS modules, theme tokens), and ship forge stories. A small
adapter maps blits onto them.

## Where it lives

`apps/playground`, a new workspace (add `apps/*` to the root `workspaces`): Vite + React +
`@weasel-js/labkit`, `@weasel-js/ui`, `@weasel-js/core` and `@weasel-js/theme`, with `@weasel-js/forge` for stories, pinned to the
version `site/` uses (1.7.3), and blits from the workspace root through a path alias. Port 4881,
`server.host: '::'`, `strictPort: true`; the site (4880) links to it from its nav.

```
apps/playground/
  src/widgets/        no blits imports; each with *.stories.tsx (forge CSF)
    ScoreLanes/       clips, slopes, passes, hatches, groups, links, ruler, playhead
    ExprInput/        one-line code input with an error under it
    CodePane/         multi-line code with per-line error marks
    ChannelPlot/      thin lines per source, a thick result line, a playhead (on Plot2D)
  src/blits/          the blits side
    composition.ts    Composition, Voice, PatchSource, Expr
    compile.ts        Composition → { mix, solos, handles } | errors
    score.ts          Voice[] ↔ ScoreLanes props and edits
    kit.ts            the one shared kit
    stages/           Dots, Letters
    presets/          one Composition per file
  src/app/            layout, transport, panels, persistence
```

## The kit

One kit drives both stages, so every preset plays on either.

| Channel   | Fold                      | Dot          | Letter          |
|-----------|---------------------------|--------------|-----------------|
| `offset`  | `vec(2, sum())`           | moves        | slides, lifts   |
| `turn`    | `sum()`                   | turns a tick | tilts           |
| `scale`   | `mul()`                   | size         | size            |
| `color`   | `hex()`                   | fill         | tint            |
| `opacity` | `mul({ bounds: [0, 1] })` | alpha        | alpha           |
| `glow`    | `max()`                   | halo         | halo            |

`Pose` is the kit's pose: `{ offset: number[]; turn; scale; color: string; opacity; glow }`. A subject is `{ index, row, col, x, y, char }`; dots fill `row`/`col`/`x`/`y`, letters `index`/`char`.

## The composition

Types are named for what they are inside `composition.ts`; code that needs blits' own `Voice` or
`Patch` beside them aliases blits' on import.

```ts
interface Composition {
  version: 1;
  title: string;
  stage: { kind: 'dots'; cols: number; rows: number } | { kind: 'letters'; text: string };
  length: number;                       // ms the score shows
  levels: { name: string; value: number; min: number; max: number }[];
  voices: Voice[];                      // cue order, which is fold order
}

type Expr = { code: string };           // source of (s) => …, or (s, setting) => … for a signal

interface Voice {
  id: string; name: string; hue: number;
  patch: PatchSource;
  start: number; rate: number; loop: boolean | number;
  stagger?: Expr; target?: Expr; hold?: 'before' | 'after' | 'both';
  weight: number | Expr;
  fade: { in?: number; out?: number; ease?: Easing };
  locus?: string; from?: 'current';
  anchor?: Placement;
}

type PatchSource =
  | { kind: 'keys'; period: number; stops: Keyframe<Pose>[]; ease?: Easing }
  | { kind: 'fn'; period: number; writes: Channel[]; at: string; state?: string; step?: string }
  | { kind: 'spring' | 'glide' | 'tween'; channel: Channel; opts: Record<string, number | Expr> };
```

Field names are blits' own, so the voice panel teaches the real `VoiceSpec`. An expression is
compiled with `new Function`, in a scope that provides blits' signal makers (`slew`, `lag`, `peak`,
`gate`) and `level(name)`, which reads the composition's level of that name. A function an
expression returns is guarded the way composition-lab's draft pane guards a piece: a throw rests that
call and is counted, rather than taking down the frame.

## Layout

DAW-style: stage top left (a switch between dots and letters), inspector top middle, voice and
patch panels down the right, the score full width along the bottom with the transport on its ruler.

## The score

One lane per voice; each voice is a clip.

| On the clip            | blits idea                         | Dragging it edits                                        |
|------------------------|------------------------------------|----------------------------------------------------------|
| sloped ends            | `fade.in` / `fade.out`             | the slope's top corner                                   |
| dividers inside        | passes of the period               | the right edge, snapping to whole passes: `loop`         |
| arrow at the end       | `loop: true`                       | dragging it back makes the loop finite                   |
| thin bar under it      | stagger spread, first to last      | nothing; `stagger` is an expression                      |
| hatched extension      | `hold`                             | a toggle in the clip's menu                              |
| shared color bracket   | `locus`                            | dropping a clip on another's lane label                  |
| dashed link            | `anchor`                           | Alt-drag from an edge to another clip's edge             |
| clip body              | `start`                            | dragging sideways; disabled while anchored               |

`ScoreLanes` knows only clips (start, length or open-ended, fade in and out, pass boundaries, a
spread bar, hatches before and after, a hue, a label, a group) and links between clip edges. Its
`onChange` reports edits in those terms; `score.ts` turns voices into clips (passes from the
patch's period and `loop`, spread from the stagger expression evaluated over the stage's subjects)
and edits back into the composition.

## Panels

| Panel            | Shows                                                                                       | Built on                         |
|------------------|---------------------------------------------------------------------------------------------|----------------------------------|
| Voice            | spec fields grouped as `VoiceSpec` groups them; hovering one shows its doc comment from the typedoc JSON the site generates | labkit `ControlPanel`, `ExprInput` |
| Patch: `keys`    | a timeline track per channel written, dope or graph; a key at time t is a stop at that phase carrying every channel keyed there | weasel `Timeline`, `EasingPicker` |
| Patch: `fn`      | period, `writes` checkboxes, `at`, optional `state` and `step`                              | `CodePane`                       |
| Patch: motion    | parameters as numbers or expressions; in live mode, a retarget control                     | labkit `ControlPanel`            |
| Weight           | a number, or a signal expression; presets insert text                                      | `ExprInput`                      |
| Inspector        | for the clicked subject, a plot per channel: each voice's contribution thin, the fold thick, and each voice's `weightOf` | `ChannelPlot`                    |

The inspector uses public API only: `compile` builds one solo mix per voice beside the full mix, and
each is read through `probe`. blits exposes no per-voice contribution, and the playground does not
reach inside for one.

## Runtime

- **Compile.** `compile(composition)` is pure. It returns the full mix, the solo mixes and the
  handles keyed by voice id, or errors keyed by field, which the panels show in place. Every edit
  recompiles and replays to the playhead.
- **Play.** A rAF loop advances score time t; each frame calls `sync(t)` on every mix, then one
  `pull` per mix reads every subject into flat arrays the stage draws from.
- **Scrub.** Forward syncs ahead. Back rebuilds and replays from 0 to t in 1000/60 ms frames,
  because a stateful signal reads the frame's gap. The transport has play, pause, rate, a loop
  region and a slider per level. Level moves are not recorded: a scrub back replays them at the
  slider's current value.
- **Live mode.** A transport toggle. While on, the voice panel's controls act on the running
  handles (`weight`, `fade`, `seek`, `ramp`, a motion's `.to()` or `push`) instead of the
  composition; a badge says these are temporary, and the next edit or backward scrub drops them.
- **State.** labkit's `localStorageAdapter` keeps the current composition, `urlHashAdapter` backs a
  share button, and labkit's `UndoStack` covers the composition. Nothing is written to disk.

## Presets

| Preset          | Shows                                                           |
|-----------------|-----------------------------------------------------------------|
| stagger wave    | `stagger` as an expression of column, with `fade.in`            |
| crossfade       | two voices in one `locus`, weight handed between them           |
| spring retarget | `spring` on `offset`, retargeted from live mode                 |
| hold handover   | `hold: 'after'`, the next voice fading the last `at: 'rest'`    |
| pointer glow    | weight as `slew(level('mouse'))`                                |
| fold rules      | one delta through `sum`, `mul` and `max`                        |

## Testing

- vitest: each `PatchSource` kind compiled from a composition gives, to the bit, the poses the
  matching hand-written `cue` gives; `score.ts` round-trips voice → clip → edit → voice; a bad
  expression yields an error on its field and a compile that still returns.
- forge stories for every widget in `src/widgets/`.
- `npm run playground:smoke`, added to `npm run check`: headless Playwright loads each preset, plays
  one second, and fails on a console error or a blank canvas. Screenshots go to a temp directory
  removed on exit.

## Not in this version

Reading back (`history` and `project` at a past time) and drained events, shown as panels of their
own; recording level moves; saving to a file.
