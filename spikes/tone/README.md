# Spike: blits driving Tone.js

**Throwaway.** This asks whether a blits mix can drive a runtime that schedules on the audio clock,
using only `project` and `book`, and answers yes. It is not a package. Run on 2026-10-08 against
`main` at `1e6e37c`, Tone 15.1.22, in headless Chromium.

## What it does

`probe.js` plays one subject through a mix of three voices:
- a `keys` sweep on `freq`, from 200 to 800 Hz and back over 2 s;
- a sine swell on `gain`;
- a silent voice whose `hits` sound a note four times a pass.

Mid-flight the host retimes things. At 1.5 s it sets the notes voice's rate to 1.5 and ramps the
sweep's rate to 0.5. At 2.5 s it seeks both voices. The frames come at 60 fps with ±1.5 ms of
jitter, plus a 120 ms stall at 1 s and a 200 ms one at 3.2 s.

Each parameter is a `Tone.Signal` routed straight to an output channel, and `Tone.Offline` renders
the result. That way the rendered buffer *is* the parameter's curve, and it is compared each ms
against the mix's own value at that moment. Two hosts are compared:

| Host | Parameters | Notes |
|---|---|---|
| frame | `setValueAtTime(probe, frame)`: what writing `param.value` each frame does | sounded at the first frame past each hit |
| ahead | each frame, `cancelAndHoldAtTime(now)`, then `linearRampToValueAtTime(project(t).probe(…), t)` every `step` ms up to `ahead` ms | `book({ clock, ahead })`, each hit scheduled at its `when` and disconnected when its `stop` is called |

## Results

| Host | `freq` error, max (Hz) | `freq` error, RMS (Hz) | Error in the 200 ms stall (Hz) | `gain` error, max | Notes sounded | Note error, mean / max (ms) |
|---|---:|---:|---:|---:|---:|---:|
| frame | 71.938 | 8.8253 | 94.58 | 0.33933 | 22/22 | 12.11 / 127.48 |
| ahead, 1 ms step | 0.134 | 0.0022 | 24.72 | 0.00000 | 22/22 | 0.00 / 0.00 |
| ahead, 5 ms step | 0.671 | 0.0153 | 24.72 | 0.00006 | 22/22 | 0.00 / 0.00 |
| ahead, 25 ms step | 3.828 | 0.1976 | 24.72 | 0.00154 | 22/22 | 0.00 / 0.00 |
| ahead, 5 ms step, 250 ms ahead | 0.671 | 0.0153 | 0.00 | 0.00006 | 22/22 | 0.00 / 0.00 |

The "max" and "RMS" columns leave out the window of the 200 ms stall, which the "stall" column
reports on its own. Reading it:
- **Notes booked by `book` land on the exact sample**, through a rate change and a seek, both of
  which re-book what was ahead. The frame host is off by up to a frame, and by 127 ms in a stall.
- **The read-ahead curve's error is the grid cutting corners.** The worst point is the sweep's
  eased peak at 1 s, and the error grows with the square of the step. No step is audible as a
  zipper: the only jumps between samples are the deliberate seek, where the mix itself jumps.
- **The read-ahead has to outlast the longest gap between frames**, as `book`'s `ahead` already
  documents. With 150 ms ahead and a 200 ms stall, the parameter holds for the last 50 ms. With
  250 ms ahead, the stall costs nothing.
- **Cost.** A projection of this mix costs about 7.4 µs in Node (one subject, three voices), so a
  5 ms grid over 150 ms is 31 projections, about 0.23 ms a frame; a 1 ms grid is about 1.1 ms.

## What blits lacks for this, by inference

- **Sampling the mix over a window takes a projection per point.** A read that returns a run of
  values over a window, or a `keys` voice's own breakpoints as exact ramps, would be cheaper. It
  would also be exact where a grid only gets close.
- **`project` takes mix time.** With `mix.rate` at anything but 1, the adapter has to convert mix
  time to the audio clock itself. The probe retimed only handles, which leave mix time on the
  host's clock.
- **After a `mix.seek` back under `history`, a read ahead past a recorded call throws.** That is
  the item `NOTES-ON-SCRUBBING.md` holds, and it would stop this adapter until it is built.

## Running it

```sh
cd spikes/tone && npm install && node serve.mjs   # http://localhost:4890/spikes/tone/index.html
```

Then, in the page: `await probe('frame')` or `await probe('ahead', { step: 5, ahead: 150 })`.
