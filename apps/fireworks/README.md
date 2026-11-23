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
rate, which slows or hurries the sparks and the sound together. The slider and its readout show
the mix's rate, so they follow the debug panel or a seek back that sets it too.

## How it works

A shell is a subject. `cue` in `src/show.ts` gives each one an owner holding two voices: a rise,
then a bloom placed on the owner's clock where the rise ends.

| Voice | Writes for the sparks | Writes for the sound |
|---|---|---|
| rise | `offset` climbing to the shell's apex, and a trail by `rate` | `freq` and `gain`, a whistle |
| bloom | `offset` at the apex, `tint` in the shell's color, and one burst sent under the tag `bursts` | hits: a bang at 0 ms, then crackles |

The quarks driver reads each shell's pose every frame and emits into one particle system
(`src/sky.ts`). The Tone driver reads the same pose a little ahead and schedules the whistle on an
oscillator the shell borrows from a pool of six, and hands each hit to `take` before it comes, at
its time on the audio clock (`src/sound.ts`). A hit names only a bang or a crackle; `take` reads
the shell off the hit's `subjects` and pans the sound by where it is and sizes a bang by its stars.
A shell launched while all six whistles are in the air rises silently and still bangs.
`src/launch.ts` gives a shell's whistle back to the pool once the shell is over, but keeps its
sparks attached for the show's 30 s of history, so a seek back into it bursts again and borrows a
whistle again for a replayed rise.

Each frame, `src/frame.ts` syncs the mix and launches on its clock, then `src/main.ts` writes both
drivers. The quarks driver emits for the mix time since its last write, and the sparks age by the
mix time the frame played, so the debug panel's pause and seek stop and move them both; the Tone
driver takes the timestamp the mix was synced to.

Nobody has listened to it. `test/sound.test.ts` renders two shells offline through the same
instruments and driver and checks the levels: each bang is about five times louder on its own side,
as a pan of 0.75 gives, the whistle is centered, and nothing reaches full scale, though one bang
peaks at 0.88 of it.
