# Changelog

## Unreleased

The API reads in the called vocabulary. `rig` and `Rig` are `kit` and `Kit`; `mix.sample` is
`mix.probe`; a channel's `join` is `merge`; `VoiceSpec.group` is `locus`; `mix.clear` is `mix.mute`;
and the mix clock's value is a timestamp, so `sync(timestamp)` and `setting.timestamp` replace
`sync(now)` and `setting.now`. Nothing else moved.

A stateful signal's state is kept by the mix, through the new `setting.keep`, per voice and subject.
Two voices handed one `slew` or `gate` now follow on their own instead of sharing a value. A `slew`
measures its own gap, which fixes it rising too fast in a voice whose patch has no `step`: that
voice's `dt` counts from when it first saw the subject, and `slew` was rate-limiting by it. A signal
reading outside input carries `input: true`, set by `level` and inherited by what is built on it.

## 0.1.0

First release. A mix folds concurrent effects into one value per subject per frame: each effect runs
on its own clock with its own state and weight, and the rules for combining them belong to the
channel being written rather than to the effect writing it.

What is here: the stock channels (`sum`, `mul`, `max`, `last`, `vec`, `hex`), both authoring forms
for a patch (a function of phase, or a list of keyframes), voices with rates, loops, stagger, fade
envelopes and groups, the four signals (`peak`, `slew`, `level`, `gate`), per-subject state that
catches up by its own gap rather than by the frame, and the `Engine` seam behind `mix`.

[klieg](https://github.com/orochi235/klieg) composes its motion, its effects and its lighting on
this, which is where the arithmetic was proven: that port changed no number and moved no baseline.

Zero runtime dependencies. ESM only. The design is `docs/schema.html`, shipped alongside.
