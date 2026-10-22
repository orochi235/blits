# blits marquee

An old-fashioned LED sign played by one [blits](../../README.md) mix: a grid of dots under a
border of chasing bulbs, running a program of messages. It is a demo, and a load you can stretch
for benchmarking, not a published package.

```
npm run dev -w @blits/marquee      # http://localhost:4884, and the same port on the LAN
npm run smoke -w @blits/marquee    # build, then play it headless at three sizes (on the fleet)
```

The message and color apply from the next pass of the program. "speed" ramps the mix's rate.

## Sizing it

`?cols=320&rows=63` sizes the sign, as do the size fields; the default is 80 × 7. Past one line of
text the sign stacks lines a dot apart, each showing the same message, so a tall sign keeps every
dot busy. `?nodraw` skips drawing, so the readout's `mix` time is the mix alone. The readout is
smoothed over about twenty frames: `mix` is `sync` plus one `pull` of every light, and `draw` is
the canvas work.

## How it works

Every dot is a subject, and so is each of the border's three cells, every third bulb: the chase lights a
cell's bulbs alike, so the mix folds the cell once and `main.ts` paints its bulbs with it (the schema
page's "Subject aliases" is why). A pose is `lit`, folded by `max` so a dot shows its
brightest voice, and `tint`, a `color` averaged by weight.

| Voice | What it does |
|---|---|
| hold | A message standing centered and flashing midway. Cued with a `stagger` by column, which is the wipe on and off: each column plays the same pass, later. |
| scroll | A message entering at the right and leaving at the left, a whole column at a time. |
| sparkle | Stray dots lighting for a moment, from a hash of where and when. Weighted by a `level`, which the checkbox sets. |
| chase | One cell of three lit, stepping a cell a beat. Weighted by a `level` too. |

`play` in `src/show.ts` cues one pass of the program on an owner, each message placed on the
owner's clock where the one before it ends, and `main.ts` cues the next pass when the owner is
done. A filament's warm-up and cool-down are the renderer's, in `src/draw.ts`, not the mix's.
