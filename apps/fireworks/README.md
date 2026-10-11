# blits fireworks

A fireworks show played by one [blits](../../README.md) mix through two drivers at once:
[`@msb235/blits-quarks`](../../packages/quarks/README.md) for the sparks and
[`@msb235/blits-tone`](../../packages/tone/README.md) for the sound. It is a demo and a test bed
for the two drivers together, not a published package.

```
npm run dev -w @blits/fireworks     # http://localhost:4883, and the same port on the LAN
```

Press "Start the show": a browser plays no audio before a click. "Launch" sends one shell up,
"keep launching" sends them on its own, a click on the sky aims one, and "speed" ramps the mix's
rate, which slows or hurries the sparks and the sound together.

## How it works

A shell is a subject. `cue` in `src/show.ts` gives each one an owner holding two voices: a rise,
then a bloom placed on the owner's clock where the rise ends.

| Voice | Writes for the sparks | Writes for the sound |
|---|---|---|
| rise | `offset` climbing to the shell's apex, and a trail by `rate` | `freq` and `gain`, a whistle |
| bloom | `offset` at the apex, `tint` in the shell's color, and one burst sent under the tag `bursts` | hits: a bang at 0 ms, then crackles |

The quarks driver reads each shell's pose every frame and emits into one particle system
(`src/sky.ts`). The Tone driver reads the same pose a little ahead and schedules the whistle on an
oscillator the shell borrows from a pool of six, and hands each hit to `play` before it comes, at
its time on the audio clock (`src/sound.ts`). A shell launched while all six whistles are in the
air rises silently and still bangs.

The frame loop in `src/main.ts` syncs the mix, then writes both drivers. The quarks driver takes
the frame's gap in mix time, so it and the sparks' own aging are scaled by `mix.rate`; the Tone
driver takes the timestamp the mix was synced to.
