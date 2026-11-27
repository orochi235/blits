# Shows

**For:** whoever moves a library's timeline onto blits, or changes `@msb235/blits/show`. **Answers:**
what a `Show` is, how `play` schedules one, the calls made building it, and how each of the five
libraries that stage timed effects on blits would write theirs as one.

Built 2026-11-25; released in 1.5.3.

## What it is

A `Show` is a list of cues as plain data: it round-trips through JSON. `play(mix, show, kinds)`
cues it on a mix under one owner and returns that owner's handle. `kinds` maps each cue's `kind` to
a factory that turns its `params` into what a voice needs and data can't carry: a patch, subjects,
a weight signal.

```ts
import { play, type Show } from '@msb235/blits/show';

const show: Show = {
  name: 'intro',
  duration: 12000,
  cues: [
    { name: 'parts', kind: 'fade-in', start: 0, length: 12000, fade: { in: 900, out: 700 } },
    { kind: 'draw', start: { after: 'parts', by: -4000 }, length: 4000, params: { order: 'sweep' } },
    { name: 'title', enter: { kind: 'rise' }, active: [{ kind: 'float' }, { kind: 'shimmer' }],
      exit: { kind: 'sink' }, hold: 3000, blend: 200, start: { after: 'draw' } },
  ],
};

const handle = play(m, show, {
  'fade-in': () => patch(1, () => ({ parts: 1 }), { writes: ['parts'] }),
  draw: (params, { length }) => ({ patch: drawPatch(params, length), subjects: nets }),
  rise: () => RISE, float: () => FLOAT, shimmer: () => SHIMMER, sink: () => SINK,
});
handle.fade();             // stops the whole show over its longest cue fade.out, here 700 ms
handle.cues[2][0];         // the title's ArcHandle, to release an open hold
```

A cue takes one of two forms.

| Field | A kind cue | An arc cue |
|---|---|---|
| `name` | what anchors call it | same |
| `start` | ms on the show's clock, or an `Anchor`; default 0 | same |
| `fade` | `{ in, out, ease }`, the voice's own fade | the arc's own fade |
| `muted` | cued at weight 0 | same |
| `kind`, `params` | the factory and what it's handed | — |
| `length` or `end` | where it ends; at most one | — (its parts set it) |
| `ease` | the curve its phase runs through | — (each piece takes its own) |
| `freeze` | blits' `'before' \| 'after' \| 'both'` | — (an arc holds its own frames) |
| `enter`, `active`, `exit` | — | a piece `{ kind, params?, length?, ease? }`, or several layered |
| `hold`, `blend` | — | as `mix.arc` takes them; `hold` may be `'open'` |

## Calls made building it

The brief's calls (2026-11-25): a subpath, not a companion; `Cue` is the timed unit and "layer" is
not a schema word; `hold` is the active phase's length and x-pcb's boolean `hold` is `freeze`;
`fade` is blits' fade; the slot form compiles to `mix.arc`; `play(mix, show, kinds)`.

Settled from the code, all 2026-11-25:

- **`Anchor` is blits' own type, unchanged.** It is plain data already (names, queries, numbers,
  `all`/`any` lists); nothing in it needed a serializable twin.
- **A show plays under one owner.** A bare name in an anchor then means another cue of the same show,
  as it does for any owner's children, and the handle stops, seeks, slows or fades the whole show.
  `play`'s fourth argument is that owner's `OwnerSpec`, so a show can be placed, nested or weighted
  as any owner is. It costs history-less back reads, which refuse owners and anchors; a read ahead
  (what x-pcb and x-xstitch do: `sync(0)`, then `project(ms)`) works through both.
- **A cue has a `name`.** Without one nothing could anchor to it. Of a cue its kind made several
  voices for, only the first carries the name, so anchors and `marks` see one voice per cue.
- **A kind cue's end is placed, and its `fade.out` ends there**, as x-pcb's ramp out does and as
  blits' `Placement.end` does. `length` places it after the start (an anchored start shifted by
  `length`, which every anchor form allows); `end` places it outright. With neither, the cue lasts
  to the show's `duration` where its start is a number, and otherwise as long as its patch. A cue
  freezing `'after'` gets no placed end, since it stays until the show is stopped, and an `end` on
  one is refused; its `length` still goes to the factory.
- **The factory gets the resolved length**, `(params, { length, cue })`, since x-pcb's and
  x-xstitch's patches are built to it. It is undefined where nothing gives one, and the factory
  picks its patch's own. `play` calls each factory once per cue, in show order, so a kind may carry
  a value from one cue to the next (x-xstitch's `from: 'carry'`).
- **`ease` warps a cue's phase**, as x-xstitch's does: `play` hands the patch `ease(phase)` in place
  of `phase`. It works only on a `patch()`-made patch; on `keys`, a motion or a `wave` it is refused,
  since their shape is read as data. The general form is the voice clock remap in `docs/TODO.md`,
  which this becomes once it lands. A shader patch wrapped so runs on the CPU, since its WGSL never
  sees the curve.
- **`ease` and `fade.ease` take blits' easing names and shapes, not a function**, so they stay data.
- **`muted` cues the cue and writes 0 to its handles' `weight`**, rather than leaving it out:
  anchors to it still answer, and a host unmutes it live by writing the weight back, 1 where the
  kind gave a weight signal (the handle's weight multiplies into it) or none, the kind's number where
  it gave one. x-pcb and beamos both leave muted layers out, which silently stalls anything anchored
  to one.
- **The show stops over the longest `fade.out` among its cues**: `play` gives the owner that fade
  out unless its spec sets one, since an owner's `fade()` ramps by its own `fade.out` and ignores
  its voices'.
- **Every cue is checked before any is cued**: an unknown kind, an unknown key (data typed by hand
  loses a misspelled one silently otherwise), a cue with neither a `kind` nor any part, and both a
  `length` and an `end`. A kind that throws drops the owner and what was cued before it.
- **`duration` is the host's length for its scrubber.** `play` reads it only as the default end
  above; it does not stop the show there, so a frozen last frame stays.
- **`handle.cues` lists, per cue, the handles of the voices it cued**: one, or several where its
  kind layered voices, or the arc's handle for an arc cue.

## The five schemas as shows

Read 2026-11-25 at klieg `0d68212`, blinken `3d39043`, x-pcb `203ad1d`, x-xstitch `728fdba`,
beamos `207ea23`.

### x-xstitch

`SHOWS.closeup` (`src/motion/player.ts`):

```json
{ "name": "Close-up, then the whole", "duration": 30000, "cues": [
  { "kind": "stitch", "start": 0, "length": 8000, "freeze": "after",
    "params": { "from": 0, "pace": 1 } },
  { "kind": "stitch", "start": 8000, "length": 20000, "freeze": "after",
    "params": { "from": "carry", "to": 1 }, "ease": "ease-in" },
  { "kind": "follow", "start": 0, "length": 12000, "params": { "amount": 1 },
    "fade": { "in": 3000, "out": 3000, "ease": { "bezier": [0.3333, 0, 0.6667, 1] } } }
] }
```

What doesn't fit:

- **`ease: 'in'` is `u ** 2.2`**, which no CSS curve is; `'ease-in'` above stands in for it. A
  bezier fitted to it comes closer, and `{ linear: [...] }` sampled from it as close as wanted. `'inout'` is smoothstep, which is exactly
  `cubic-bezier(1/3, 0, 2/3, 1)`.
- **`follow`'s and `flip`'s ramps move from the value into the weight** (`fade`). That reads the same
  because `follow` and `flip` fold by `max` with rest 0, where weight scales the value.
- **`from: 'carry'`** stays in the `stitch` kind, which keeps where the last stitch cue ended. That
  relies on `play` calling kinds in show order.

### x-pcb

A layer of `src/motion/presets.ts`:

```json
{ "kind": "pour", "start": 4600, "length": 7400, "params": {},
  "fade": { "in": 1200, "out": 900, "ease": { "bezier": [0.3333, 0, 0.6667, 1] } } }
```

`hold: true` becomes `"freeze": "after"`; `muted` and `params` keep their names.

What doesn't fit:

- **The envelope is a value today**: each kind's function is handed `env` and multiplies it in.
  As a weight fade it reads the same on every `max` channel with rest 0 (`parts`, `silk`, `pour`,
  `peel`, `readout`). A kind that uses it otherwise (`draw` times its growth by `in` and `out`)
  reads `cue.fade` from its factory's second argument and keeps doing so.
- **A left-out `in` means the whole length** in x-pcb, and no fade in here. Moving over writes it out.
- **`hold` with an `out`** holds the envelope's last value, 0, in x-pcb. Frozen here it holds the
  last frame at full weight until the show is stopped.

### beamos

A `Layer` (`src/effect/types.ts`):

```json
{ "name": "glow", "kind": "glow", "start": { "after": "outline", "by": -200 }, "length": 900,
  "fade": { "in": 150, "out": 300 },
  "params": { "settings": { "hue": 0.6 }, "keys": { "size": [[0, 0.2], [1, 1, "ease-out"]] } } }
```

`id` becomes `name`; `settings` and `keys` go in `params`, and the kind returns one voice for the
steady settings and one `keys` voice per keyed one, layered, as `patchesOf` does now. A `Ref`
becomes an anchor: `"x.start"` is `{ with: 'x', by }` and `"x.end"` is `{ after: 'x', by }`.

What doesn't fit:

- **A subject layer's end is its reveal's end** (`coast`), which beamos rewrites refs to. A frozen
  cue's `end` mark never comes, so an anchor on one names it: `{ of: 'x', mark: 'coast', by }`.
  Whether a layer freezes is its kind's `role` today; here it is the cue's `freeze`, in the data.
- **`Effect.out`, the mirrored stack for beaming out**, is a second show. Playing it mirrored is the
  host's call.
- **`seed`** goes in each cue's `params`; the show has no seed of its own.

### blinken

An `EffectSpec` from `src/builtins.ts` is one arc cue:

```json
{ "name": "hold", "enter": { "kind": "cut-on" },
  "active": [{ "kind": "stand" }, { "kind": "flash", "params": { "flashes": 3, "from": 0.3333, "to": 0.6667 } }],
  "exit": { "kind": "cut-off" }, "hold": 3600 }
```

A program's scenes are arc cues one after another, each `start: { after: <the scene before> }`,
and a scene's own modulator layers are kind cues `start: { with: <scene> }`.

What doesn't fit:

- **The effect's `order`, one arc per group of letters each a lag after the last**, has no field.
  Staggering the pieces' voices would stagger the subjects but not the arc's handovers. blinken
  keeps compiling an effect with an order into one arc cue per group, at starts `g * lag`.
- **A piece's own `order` or `spread`** is a param of its kind. A move and a modulator share one
  registry, so their names must not collide.
- **`params` (what a scene may tune, and which piece field each reaches)**, `about`, warnings and
  input stops are blinken's editor and staging, kept beside the show.

### klieg

`fire(text, { enter: 'rise', active: ['float', 'shimmer'], exit: 'sink', hold: 'click' })`:

```json
{ "enter": { "kind": "rise" }, "active": [{ "kind": "float" }, { "kind": "shimmer" }],
  "exit": { "kind": "sink" }, "hold": "open", "blend": 250 }
```

`'until-release'`, `'click'` and `'forever'` are all `'open'`; `blendMs` is `blend`.

What doesn't fit:

- **klieg crossfades its own slots** (`weightAt`, `motion/compositor.ts`), not through `mix.arc`. It
  has to move onto `mix.arc` before an arc cue reads the same.
- **A caller's own `MotionPatch`** in a slot is code, not data; it needs a registered kind.
- **`look`, `effects`, `lighting`, `tint` and `transform`** are word-level options, not timeline.
  `tint` may be a function. They stay `FireOptions` beside the cue.
