# blits marquee

An old-fashioned LED sign played by one [blits](../../README.md) mix: a grid of dots under a
border of chasing bulbs, running a program of messages. It is a demo, and a load you can stretch
for benchmarking, not a published package.

```
npm run dev -w @blits/marquee      # http://localhost:4884, and the same port on the LAN
npm run smoke -w @blits/marquee    # build, then play it headless at three sizes (on the fleet)
npm run shots -w @blits/marquee    # build, then screenshot each effect alone into shots/ (on the fleet)
```

The message and color apply from the next pass of the program. "speed" ramps the mix's rate.

## Sizing it

`?cols=320&rows=63` sizes the sign, as do the size fields; the default is 80 × 7. Past one line of
text the sign stacks lines a dot apart, each showing the same message, so a tall sign keeps every
dot busy. `?nodraw` skips drawing, so the readout's `mix` time is the mix alone. The readout is
smoothed over about twenty frames: `mix` is `sync` plus one `pull` of every light, and `draw` is
the canvas work. `?show=flip` loops one text effect on the message, for looking at it alone.

## How it works

Every dot is a subject, and so is each of the border's three cells, every third bulb: the chase lights a
cell's bulbs alike, so the mix folds the cell once and `main.ts` paints its bulbs with it (the schema
page's "Subject aliases" is why). A pose is `lit`, folded by `max` so a dot shows its
brightest voice, and `tint`, a `color` averaged by weight.

Each effect is a module of its own in `src/effects/`, and `src/effects/index.ts` lists them all by
name. An effect declares its tuning as `params`: plain data giving each number's label, range and
default, which a control panel can be built from. A **text effect** has `stage(board, text, hex,
values)`, which returns the patch to cue on the dots, the per-dot `stagger` to cue it with and how
long it lasts; `fits(board)` says whether there is room for it. A **layer** has `patch(board,
values)`, cued looping on the dots or the cells, and the `weight` it plays at when on.

| Effect | Kind | What it does |
|---|---|---|
| hold | text | Stands centered and flashes midway. Its `stagger` by column is the wipe on and off: each column plays the same pass, later. |
| scroll | text | Crosses the sign a whole column at a time. |
| flip | text | Letters unfold from edge on, tumble end over end and fold away, staggered by letter. |
| roll | text | Each letter a slot reel spinning through random glyphs, landing left to right, then rolling away. |
| fall | text | Columns drop in from above at random and later fall out the bottom. |
| tile | text | The message repeated in tilted brick rows over the whole sign, neighboring rows scrolling opposite ways. Needs room for two lines. |
| sparkle | layer | Stray dots lighting for a moment, from a hash of where and when. |
| chase | layer | One border cell of three lit, stepping a cell a beat. |
| rainbow | layer | Hue running across the sign. It writes only `tint`, at weight 3, so it recolors whatever else is lit. |

Each layer's checkbox sets a `level` weighting it, between 0 and its own weight.

`play` in `src/show.ts` cues one pass of the program on an owner, each message that fits placed on
the owner's clock where the one before it ends, and `main.ts` cues the next pass when the owner is
done. A filament's warm-up and cool-down are the renderer's, in `src/draw.ts`, not the mix's.
