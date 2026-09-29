# Changelog

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
