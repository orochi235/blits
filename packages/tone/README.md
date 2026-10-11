# @msb235/blits-tone

Drives [Tone.js](https://tonejs.github.io) from a [blits](https://github.com/orochi235/blits) mix,
on the audio clock. You build the synths, the signals, and the routing; each frame the driver reads
the mix a little ahead and schedules what it finds: each subject's channels as curves on the
parameters you bound, and each hit and mark at the sample it falls on. Nothing else about Tone is
wrapped.

```
npm install @msb235/blits @msb235/blits-tone tone
```

```ts
import { keys, kit, mix, mul, sum } from '@msb235/blits';
import { drive } from '@msb235/blits-tone';
import * as Tone from 'tone';

const m = mix(kit({ freq: sum(), gain: mul() }));
const osc = new Tone.Oscillator().start();
const amp = new Tone.Gain(0).toDestination();
osc.connect(amp);
const drum = new Tone.MembraneSynth().toDestination();

const tone = drive(m, {
  take: (item, time) => {
    if ('hit' in item) drum.triggerAttackRelease('C2', '8n', time);
  },
});
tone.attach(voice, { freq: osc.frequency, gain: amp.gain });

// each frame
m.sync(now);
tone.write(now);    // the timestamp you just synced to
```

## Reading ahead

A value written to a parameter once a frame is late by up to a frame, steps where the mix curves,
and stops for as long as the frame loop stalls. So the driver never writes the present. Each
`write` it reads the mix at points `step` ms apart from now to `ahead` ms out, with
`mix.project`, and schedules a linear ramp to each on the audio clock, replacing what the last
`write` scheduled. Hits and marks go through `mix.book`, which hands each one over before it comes
and again if a seek or a rate change moves it.

The package's tests play a mix through the driver into `Tone.Offline` and compare the rendered
parameter, each ms, with the mix's own value. The mix sweeps 200 to 800 Hz and back over 2 s; its
voices are retimed and sought mid-flight; the frames come at 60 fps with jitter, a 120 ms stall,
and a 200 ms one. The tests hold these bounds:

| Case | `freq` error, max (Hz) |
|---|---:|
| 5 ms `step` (the default) | 0.68 |
| 25 ms `step` | 3.90 |
| inside the 200 ms stall, 150 ms `ahead` | above 20 |
| inside the 200 ms stall, 250 ms `ahead` | 0.68 |
| audio clock read up to 1 ms off each frame | 1.00 |

Every booked note sounds within a sample of its time at 48 kHz, through a rate change and a seek;
with the clock read up to 1 ms off, within 0.25 ms.

`ahead` has to outlast the longest gap between two writes: past it the parameter holds its last
value until the next `write`. A longer `ahead` costs a projection per point, and a change made to
the mix is heard only once the next `write` replaces the curve, which a stall also delays.

## API

- **`drive(mix, options?)`** returns the driver. Options, all optional:
  - `ahead`, default 150, and `step`, default 5: how far ahead a curve is written and how far
    apart its points are, in ms on the audio clock.
  - `take(item, time, lateBy)`: called for each mark and hit within `ahead`, with `time` in
    seconds on the audio clock, to hand to Tone as it is. `item` is what `mix.book` gives its
    `take`: a hit carries `hit` and its `event`, and a mark has neither. Return a function to be
    told the item moved or went away; it is then played again at its new time. Without `take`
    the driver books nothing.
  - `late`, default 50, `tag`, and `score`: passed to `mix.book` as they are.
  - `clock`: the audio clock in seconds, default `Tone.immediate`.
- **`attach(subject, targets)`** binds a subject's channels to parameters: `targets` maps a
  channel name to a Tone `Param` or `Signal`, or a native `AudioParam`. Values are scheduled in
  the target's own units. Only a channel holding one number takes a target. Attaching a subject
  twice throws.
- **`detach(subject)`** unbinds it and cancels what was scheduled ahead, so its targets hold the
  value they had reached.
- **`write(timestamp)`**, after `mix.sync(timestamp)` with the same timestamp: schedules every
  attached subject's curves. Before the mix's first sync it does nothing.
- **`cancel()`** detaches every subject and cancels what `take` booked ahead.

The host's clock need not be the audio clock: sync the mix to `performance.now()` or a frame's
timestamp as usual. The driver keeps the offset between the two as `mix.book` does, folding in 5%
of each frame's difference and starting over on a jump past 50 ms, such as a suspended context.

## What it does not do yet

- **A curve is only as exact as its grid.** The error grows with the square of `step`, and a jump
  in the mix that falls between two points is played as a ramp across one step. A read of the mix
  over a window, giving a `keys` voice's breakpoints as exact ramps, is undecided in the engine;
  until then each point is one `mix.project`, 31 a `write` at the defaults.
- **A `mix.ramp` is approximated.** `project` takes mix time, and the engine does not say what
  mix time a moment on the host's clock will read. The driver converts with `mix.rate` as it
  stands at each `write`, which is exact for a rate that holds, a pause included, and drifts
  while the rate ramps: within 5 Hz on the sweep above for a ramp from 1 to 0.5 over 600 ms.
  Hits and marks are unaffected, since `mix.book` converts them itself.
- **Scrubbing.** After a `mix.seek` back under `history`, `mix.project` throws for a time past a
  recorded call, and `write` throws with it, leaving every target holding its value.
- **Only linear ramps, and only channels of one number.** A `vec` or `color` channel takes no
  target; read it with `mix.project` yourself.
- **Tone's `Transport` is not involved.** Times are on the audio context's clock, and the mix's
  rate, not Tone's tempo, sets the pace.
