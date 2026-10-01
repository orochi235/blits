# Notes from magicsmoke

**For:** whoever works on blits next. **Answers:** what magicsmoke, now adopting blits, would like
blits to add, ranked, and what it builds in the meantime. Written 2026-09-30 from a message sent by
the magicsmoke session. Nothing here was measured on the blits side. When an item is dealt with,
delete it, and delete this file once it is empty.

magicsmoke (`~/src/magicsmoke`) fakes hardware failing on a page: sparks, arcs, hum, jolts. A fault
has a 0..1 intensity that drives a seeded self-exciting process of discharges.

## What magicsmoke is building

A new API around blits, adopted on Mike's direction. magicsmoke owns its mix internally but takes
and returns blits types: a fault is a `Handle`, its intensity is a number or any `Signal`, and the
host calls `sync(timestamp)`. The old `createLayer`/`fault`/`update(dt)` API stays on the old engine
for an A/B comparison, then becomes an alias over the new one. The A/B bar is exact: the same seed and
intensity script give identical discharges at identical times. It links blits locally through a
`file:` dependency for now, as klieg does, so it is not waiting on a publish.

The shape inside magicsmoke is **recommended to Mike, not approved**: each fault is a subject with
`intensity`, `surge` (`mul`) and `lift` (`sum`), and `blow` is a `keys` voice; a one-subject mix
carries `whine`, `hum` and jolt displacement (`vec(2, sum())`). The discharge process stays
magicsmoke code: fixed 5 ms substeps, an exponential ease toward its target, reading the probed pose
each sync and emitting discharge events. That works on blits as it is today.

**Don't edit `docs/schema.html` for this yet.** Once Mike approves, the magicsmoke row in the
consumer table ("`blow` is a state patch on the same voice") and the open item "Whether magicsmoke
wants this at all" are both out of date: `blow` becomes a `keys` voice on `surge`/`lift`, and the
answer is yes, with the discharge process left in magicsmoke. The magicsmoke session says it will
message again when that is approved.

## Asks, most wanted first

1. **Fixed-interval state stepping, settable per mix.** `NOTES-ON-SCRUBBING.md` proposes this.
   magicsmoke's process gives the same result however its frames are spaced only because it
   substeps every 5 ms from its own start. With the mix stepping state at an interval it sets, and
   carrying the remainder per subject, the process could become a stateful patch and stay
   deterministic. 5 ms, so a fixed 120 Hz is too coarse.
2. **Events out of a voice.** Smaller than weasel's booking (`NOTES-FROM-WEASEL.md`): a stateful
   patch reports timestamped events during `step`, and the host drains them after `sync`/`probe`,
   in time order, with no retraction. Without this the process can't move into a patch however
   stepping works.
3. **An exponential follow signal beside `slew`**, closed form:
   `v += (target − v) · (1 − exp(−gap / tau))`. magicsmoke's intensity ease uses tau 100 ms. It
   also answers the schema's open "whether `slew` is linear": ship both rather than change `slew`.
   Exactness against a step change in target matters only once item 1 lands.
4. **Cheap observability**, which weasel asks for too: magicsmoke's tuning lab wants each voice's
   live weight per subject after fades, to show the `blow` ramp and the fades.

## Surface magicsmoke imports

`Signal`, `Handle`, `Setting`, `slew` and `level`. Treat them as stable: a break there breaks
magicsmoke.
