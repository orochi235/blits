# @msb235/blits-tone

Drives [Tone.js](https://tonejs.github.io) from a [blits](https://github.com/orochi235/blits) mix,
on the audio clock. You build the synths, the signals, and the routing; each frame the driver reads
the mix a little ahead and schedules what it finds: each subject's channels as curves on the
parameters you bound, and each hit and mark at the sample it falls on. Its `synth`, `oscillator`
and the rest, and `wire` for any node, hand back a Tone node already wired to the mix, to cue voices
on. Nothing else about Tone is wrapped.

```
npm install @msb235/blits @msb235/blits-tone tone
```

```ts
import { keys, kit, mix } from '@msb235/blits';
import { channels, drive } from '@msb235/blits-tone';

const K = kit({ ...channels });              // detune, volume and gain, plus any of your own
const m = mix(K);
const tone = drive(m, { kit: K });

const lead = tone.synth({ oscillator: { type: 'sawtooth' } });   // Tone's own options
lead.node.toDestination();
lead.cue({ patch: keys(2000, [{ at: 0, delta: { detune: 0 } }, { at: 1, delta: { detune: 1200 } }]) });
lead.node.triggerAttackRelease('A3', '1n');
const harmony = lead.copy();                 // a second synth, nothing shared

// each frame
m.sync(now);
tone.write();
```

## Sounds

- **`tone.wire(node)`** wires any Tone node to the mix and returns a `Sound`. **`tone.synth`**,
  **`polySynth`**, **`oscillator`** and **`noise`** each build that class from Tone's own options
  and wire it. A sound's `node` is the Tone object, yours to connect and dispose. A sound is the
  mix's subject for that node: `m.probe(lead)` reads it.
- **`sound.cue(spec)`** cues a voice on that sound alone and returns blits' `Handle`. The spec names
  no `subjects`; one that does throws.
- **`sound.copy()`** builds a new node of the same class from this one's settings (`node.get()`)
  and wires it as a sound of its own, with no voices and no connections. Copies of the four classes
  above come out with equal settings, a `PolySynth` keeping its voice class, `maxPolyphony` and
  `volume`. A copy starts from the original's base values, not from what a voice is playing.
- **`sound.drop()`** ends the voices cued on it, unwires the node, puts each driven parameter back
  to its value when wired, and drops the subject from the mix. A `cue` after it throws, and the
  node can be wired again. It leaves the node connected.
- `wire` needs `kit` passed to `drive`, and throws for a node already wired, for anything not a
  Tone node, and after `cancel`.
- **A host's subject type has to admit sounds**, since a sound is the mix's subject: use
  `mix<unknown, …>`, or a union with `Sound`. Nothing checks this at compile time.

### Which parameters a sound drives

Each of the node's own properties that is a Tone `Param` or `Signal` and has a channel of the same
name in the kit. Nested ones, such as a synth's `oscillator.frequency`, are not reached. The value
a parameter has when wired is its base, and the channel moves it from there:

| Channel's `rest` | The parameter gets |
|---|---|
| `0`, as `sum()` | base + value |
| `1`, as `mul()` | base × value |
| anything else, or none | the value as it is |

So a wired node with nothing cued keeps its own settings. `channels` holds `detune` (cents) and
`volume` (dB) as `sum()`, and `gain`, for a `Gain` node, as `mul()`. **`frequency` is left out on
purpose:** a synth's note sets its frequency, and the driver replaces what is scheduled on a
parameter it drives, so a `frequency` channel would take pitch away from your notes. Move pitch
through `detune`; add a `frequency` channel only for a node that plays no notes.

## Reading ahead

A value written to a parameter once a frame is late by up to a frame, steps where the mix curves,
and stops for as long as the frame loop stalls. So the driver never writes the present. Each
`write` it reads the mix from now to `ahead` ms out with `mix.trace`, and schedules what that gives
on the audio clock, replacing what the last `write` scheduled: a linear ramp to each point, and a
jump as `setValueAtTime`. Where a `keys` voice's shape is known, its own breakpoints come back and
the ramps are exact, however coarse `grid`; anywhere else the mix is read every `grid` ms. The
engine's docs list what counts as known. Hits and marks go through `mix.book`, which hands each one
over before it comes and again if a seek or a rate change moves it.

The package's tests play a mix through the driver into `Tone.Offline` and compare the rendered
parameter, each ms, with the mix's own value. The mix sweeps 200 to 800 Hz, eased, and back in a
straight line over 2 s; its voices are retimed and sought mid-flight; the frames come at 60 fps
with jitter, a 120 ms stall, and a 200 ms one. The tests hold these bounds:

| Case | `freq` error, max (Hz) |
|---|---:|
| 5 ms `grid` (the default) | 0.15 |
| 25 ms `grid` | 1.80 |
| the straight fall, any `grid` | 0.001 |
| inside the 200 ms stall, 150 ms `ahead` | above 20 |
| inside the 200 ms stall, 250 ms `ahead` | 0.15 |
| audio clock read up to 1 ms off each frame | 0.20 |

Every booked note sounds within a sample of its time at 48 kHz, through a rate change and a seek;
with the clock read up to 1 ms off, within 0.25 ms.

`ahead` has to outlast the longest gap between two writes: past it the parameter holds its last
value until the next `write`. A longer `ahead` costs more reads where the mix is sampled, and a
change made to the mix is heard only once the next `write` replaces the curve, which a stall also
delays.

## Lower level

`drive`'s own calls bind a subject you keep to parameters you name, writing each value as it is.

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
    return undefined;
  },
});
tone.attach(voice, { freq: osc.frequency, gain: amp.gain });

// each frame
m.sync(now);
tone.write();
```


- **`drive(mix, options?)`** returns the driver. Options, all optional:
  - `kit`: the mix's kit, which `wire` reads.
  - `ahead`, default 150, and `grid`, default 5: how far ahead a curve is written and how far
    apart its points are where the mix's shape is not known, in ms on the audio clock.
  - `take(item, time, lateBy)`: called for each mark and hit within `ahead`, with `time` in
    seconds on the audio clock, to hand to Tone as it is. `item` is what `mix.book` gives its
    `take`: a hit carries `hit` and its `event`, and a mark has neither. Return a `cancel` to be
    told the item moved or went away; it is then played again at its new time. Without `take`
    no mark or hit is played.
  - `late`, default 50, `tag`, and `score`: passed to `mix.book` as they are.
  - `clock`: the audio clock in seconds, default `Tone.immediate`.
- **`attach(subject, targets)`** binds a subject's channels to parameters: `targets` maps a
  channel name to a Tone `Param` or `Signal`, or a native `AudioParam`; anything else needs
  `cancelAndHoldAtTime`, `linearRampToValueAtTime`, and `setValueAtTime`. Values are scheduled in
  the target's own units. Only a channel holding one number takes a target. Attaching a subject
  twice throws. The driver builds no synths: a subject that should sound on its own needs a
  synth of its own, which the host builds and attaches.
- **`detach(subject)`** unbinds it and cancels what was scheduled ahead, so its targets hold the
  value they had reached.
- **`write()`**, after `mix.sync`: schedules every attached subject's curves from that sync on.
  Before the mix's first sync it does nothing.
- **`cancel()`** detaches every subject and cancels what `take` booked ahead. The driver is done
  after it; drive the mix again to play on.

The host's clock need not be the audio clock: sync the mix to `performance.now()` or a frame's
timestamp as usual. The driver maps one onto the other by the offset `mix.book` keeps, which folds in
5% of each frame's difference and starts over on a jump past 50 ms, such as a suspended context.

## What it does not do yet

- **Only a straight `keys` stretch is exact.** An eased stop, any other patch, a signal weight and a
  fade under way are read every `grid` ms, where the error grows with the square of `grid` and a
  jump between two points plays as a ramp. Each such point is one `mix.project`.
- **A `mix.ramp` is approximated.** `trace` takes mix time, and the engine does not say what
  mix time a moment on the host's clock will read. The driver converts with `mix.rate` as it
  stands at each `write`, which is exact for a rate that holds, a pause included, and drifts
  while the rate ramps: within 5 Hz on the sweep above for a ramp from 1 to 0.5 over 600 ms.
  Hits and marks are unaffected, since `mix.book` converts them itself.
- **Only channels of one number.** A `vec` or `color` channel takes no target; read it with
  `mix.project` yourself.
- **Tone's `Transport` is not involved.** Times are on the audio context's clock, and the mix's
  rate, not Tone's tempo, sets the pace.
