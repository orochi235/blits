# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. Each release lists its changes as **Breaking**, **Added** and
**Fixed**, and the release workflow refuses a tag with no section here.

## Unreleased

### Breaking

- A patch is not asked for a subject its voice gives no weight: `at` is skipped at weight 0, unless
  the voice is fading to rest, while `step` still runs. A blend over 8 stops now runs the 2 around
  its signal per subject rather than all 8. A patch that counted its calls or sent events from `at`
  at weight 0 no longer sees those frames.
- A patch's length is `duration`, not `period`: a pass is one run through a patch whether or not
  it loops, and only a looping voice has a period. `period` is still set on every patch `patch`,
  `keys`, `spring`, `glide` and `tween` build, and a patch that sets only `period` still plays,
  but it is deprecated and a later release removes it.

- A spring, glide or tween's `to`, `push`, `read` and `at` are methods of its class, so call them on
  the patch, as `glide.to(id, 1)`: one taken off it, as `const { to } = glide`, has no patch to act
  on. Its `motion` is a getter on the class rather than its own property.
- `mix.blend` reads its signal once per subject per frame, with the first member's setting, and
  every member takes its share of that one reading; it read it once per member. A host counting
  calls sees a third as many from a three-member blend, and a signal reading `setting.elapsed` or
  `setting.pass` sees the first member's even where a member was sought or retimed on its own. A
  signal keeping state, as `slew`, `lag` and `gate` do, keeps one state per subject for the whole
  blend, which carries on when the member that made it leaves; each member kept its own, and those
  could part ways where members left the lanes in different frames.

### Added

- A mix's host has a type: `mix<I, O, H>` types its `host` option, and every patch, signal and
  setting it plays reads `setting.host` as `H`, without a cast. `Setting`, `Patch`, `PatchOptions`,
  `Signal`, `VoiceSpec`, `MixOptions` and `Mix` take `H` as their last type parameter, `unknown` by
  default, and the stock signals carry it through.
- `slew` and `lag` take `from`: where a subject starts the first time they see it, in place of on
  their input, so a follower can climb from rest.
- `mix.voices(tag?)`: a handle on every voice still in the mix, pending, live, held or fading, in
  cue order, or only those whose `tags` carry `tag`. A host no longer has to keep every handle `cue`
  returned to know what is playing. Each call makes new handles on the same voices, so compare them
  by `id`; nothing is kept for it until it is called.
- A rate for the whole mix, `mix.rate` and `mix.ramp(rate, over)`, shaped like a handle's and
  multiplied into every voice's; 0 pauses the mix. It runs mix time, so everything a voice owns
  slows with it: its clock, its fades, `stagger`, an anchor's `by`, `stepMs` and every `dt`. A
  timestamp the host gives or reads stays on the host's clock: a `start`, an anchor given as a
  number, an announced mark, `marks` and `project`. A paused mix with nothing left to land is
  `inert`, and `history` keeps every rate change, so `project` reads back through them as it does
  through a handle's. A mix whose rate is never set reads the same bits as before, at the same
  cost: every row timed (`fn`, `keys`, `named`, `spring`, `tweens^`, `churn^`, `ahead`, `back`)
  overlaps `9015b0b`'s range over three to five alternated runs on studio.
- Booking ahead against an outside clock, for a host that schedules on one: sound on an
  `AudioContext`, MIDI sent with a timestamp, a video loaded before the voice that shows it.
  `mix.book({ clock, ahead, late, take, tag?, score? })` hands `take` every mark `marks` lists and
  every hit, `ahead` ms before it comes, with its time on that clock. A hit is a new `VoiceSpec`
  field, `hits: [{ at, event }]`: events at times on the voice's clock, once per pass, for the
  voice rather than per subject. A booking whose time moves by more than 1 ms or that goes away (a
  seek, a rate on the voice or the mix, a fade, a `rebase`, an anchor's target moving, the voice
  leaving) has the `stop` that `take` returned called and is booked again; an item first seen past
  is taken at once with `lateBy`, up to `late`. `book` returns a `stop()`. `project` books nothing.
  A mix with no booker costs what it did: every row timed (`fn`, `keys`, `signal`, `blend`,
  `named`, `spring`, `tweens`, `churn`, `weasel`, `sparse`) overlaps `c6de97e`'s range over three
  alternated runs on msb-uai, each row in a process of its own.

### Fixed

- A subject meeting a voice over every subject on a lane does less to meet it. A lane finds a
  subject's place by its number in an array rather than a Map, the voice's record comes from the
  chain the probe just linked rather than a second lookup, the voices naming the subject are looked
  up only when one has started on it since, and the subjects that fold the voice on the general path
  this frame share one list of it rather than a copy each in a Map. With 10k tween voices of one
  subject each and a voice over all of them replaced every frame (`swap`), a frame takes
  4.66–5.13 ms on teitou, from 6.22–6.43.
- A voice over every subject coming, starting or going relinks each subject's chain by that voice
  alone, taking it off or putting it on at its place in voice order, where every chain was linked
  afresh through every voice reaching the subject. The same `swap` frame takes 4.24–4.47 ms on
  teitou, from 4.81–4.93; a voice per subject (`named`) is unchanged.
- A subject owing the same voices as the one before it in a frame takes that answer rather than
  working out again whether it may fold them after the lanes, and a retired voice leaving its lane
  writes no weights back to its records, which nothing reads once it is done. The same `swap`
  frame takes 3.55–3.70 ms on teitou, from 3.77–4.09.
- A projection that retires a copy of a motion voice leaves the live patch asking the live voice
  for its time. The copy carried the voice's hooks, and retiring it cut the patch off from the
  mix: an untimed `to` or `push` after such a projection took its time from the subject's next read
  rather than the latest frame. A motion patch now asks its mix by voice id, where each voice made
  a weak reference and two closures of its own: a one-subject tween voice holds about 250 B less
  (`bench/heapwho.mjs 5000 tweens` 3747 B from 4004, `weasel` 3448 from 3704).
- A spring, glide or tween playing one object subject finds its number for it through the weak
  reference it numbered it by, rather than a WeakMap of its own: a one-subject tween voice over an
  object holds 3610 B, from 3747 (`bench/heapwho.mjs 5000 tweens`). Starting them takes no less
  time.
- A spring, glide or tween makes its buffer when it numbers its first subject, rather than one for
  its law when it is made and another then, and works out a still start without asking `to` again:
  making and cueing 10k one-subject tween voices takes 2.5–2.8 ms on teitou, from 5.1–6.8, and
  their first frame 15.7–16.9 ms, from 19.0–21.1 (`bench/start.mjs`).
- A pose never holds a patch's own array. Where a channel's `merge` returned its second argument,
  as `last()` does, the mix put that array into the pose as it was: with two voices on a keyed
  array channel, a host editing its pose edited the stop, and every later frame read the edit. The
  mix now copies such a value, into the array the pose already holds where one fits.
- A voice holds less while it plays. A store keeps its first id inline rather than in a Map, a
  voice's small arrays are sized to what they hold, `setting.keep` is made the first time a patch
  reads it, and a spring, glide or tween keeps its methods on its class rather than in closures of
  its own: a one-subject tween voice keyed by a number, cued and retargeted as weasel's animator
  does, holds 3.7 KB, from 5.3
  (`bench/heapwho.mjs 5000 weasel`, which breaks a voice's bytes down by the field that holds them).
- A crowd voice that starts or begins fading in the frame the lanes are qualified again plays on
  them. A qualify that kept the crowds as they stood, as when a voice over every subject leaves,
  dropped the news, and the row stayed silent: a voice starting at 50 ms on one subject read nothing
  on the lanes while one over every subject faded out then.
- A subject numbered by a mix, or by a motion patch, is let go once collected even when it was the
  first object numbered and was collected before a second came. Its number, its lane positions and
  its motion state were held for good.
- A crowd copies its rows' motion stretches as a fill begins, rather than in the loop that reads
  every row. Once voices had faded, V8 spent that loop's inlining on the copy and stopped inlining
  each row's ease, and every mix in the process stayed slower afterwards. With 10k tween voices of
  one subject each read by `pull`, a frame takes 0.24 ms on teitou after every voice has been
  replaced once, from 0.31, and 0.40 ms with one replaced each frame (`churn^`), from 0.44.
- A crowd compacts its rows once a quarter of them are empty, rather than half: one replacing a
  voice a frame carried as many empty rows as live ones, all walked every fill. The same 10k voices
  replaced once each take 0.31 ms a frame on teitou, from 0.33 (`bench/scatter.mjs replaced`).
- A voice weighted by a signal on a lane is weighed under the fade its lane already worked out,
  where the general path's weighing worked the fade out again for every subject; a laned `fn` call
  in a mix keeping no history no longer asks the mix for its horizon. On teitou three signal voices
  over 10k subjects take about 0.91 of the time they did, three plain `fn` voices 0.91 and a blend
  of three 0.95.
- A voice's handle is one object of a class, where each `cue` made a dozen closures: cueing 10k
  tween voices of one subject each takes 7.7–9.7 ms on teitou, from 13.5–15.3, and 10k `fn` voices
  2.8–3.1 ms, from 4.8–7.1.
- A voice naming its subjects keeps them in a list, with a set only past eight, and a motion patch
  numbering one subject makes no `FinalizationRegistry` until it numbers a second: a tween voice of
  one subject holds about 5.3 KB, from 5.6 (`bench/heapby.mjs`).
- A voice over every subject coming, starting or going among a crowd no longer qualifies every
  voice again, and a probe meeting it folds it onto the lanes' values where it comes after every
  other laned voice, rather than reading the general path for the frame: with 10k tween voices of
  one subject each and a voice over all of them replaced every frame (`swap`), a frame takes
  6.0–6.1 ms on teitou, from 12.2–12.5. A qualify that would rebuild the crowds and laned channels
  unchanged keeps them as they stand.
- `atRest` answers from the lanes' values for a subject every voice of which is laned, rather than
  folding a pose to compare: asked of 10k subjects under two voices, a frame takes 0.94–1.07 ms on
  teitou, from 1.41–1.43 (`rest`).
- A subject fading out of a voice with `handle.fade({ subject })` gets the same weight on a lane
  as on the general path. A lane held the voice's weight to 1 before multiplying in the subject's
  ramp, where the general path holds the product: a voice at weight 1.6 halfway out of a subject
  read 0.5 of its delta on a lane and 0.8 elsewhere. Below weight 1 the two differed only in the
  last bit.
- A voice weighted by a signal runs on lanes, weighed by the general path's own arithmetic, where
  it always took the general path; a signal that keeps state through `setting.keep` takes its voice
  off lanes from the first call, as a patch that keeps state does. Three such voices over 10k
  subjects take 0.79 of the time they did on teitou. A signal holding state of its own outside
  `setting.keep` is now called for every subject the mix has met, probed or not, as a stateless
  patch on a lane already is.
- `atRest` reads a voice's weight as the probe it repeats did, holds and stagger delay included.
  It handed a weight signal the voice's time before its holds and the subject's delay, so
  `weightOf` changed after it, and a channel with no rest could switch on or off and stay so.
- A locus whose members are all `keys` or stateless `fn` voices runs on lanes, so `mix.blend` over
  such patches does: each subject's members are gathered as the general path's locus fold gathers
  them and folded in at its first member's place. A motion member keeps the whole locus on the
  general path. On teitou three voices in a locus over 10k subjects take 0.72 of the time they
  did, and a blend of three weighted by a signal 0.84.
- A voice in a locus folds only the channels its patch writes, as a voice outside one does; a
  delta's other keys were folded too.
- A `keys` or stateless `fn` voice naming one subject and writing several channels joins a crowd,
  as one writing a single channel does, where it took the general path. On teitou 10k such voices
  read by probe take 0.79 of the time they did and 1k take 0.65; 100 take about 1.1.
- A crowd's `keys` rows fold their stops straight into the lanes, through the same segment search
  `readKeys` makes, rather than through a delta per row: 10k `keys` voices of one subject each
  take 0.74 of the time they did read by `pull` and 0.85 by probe on teitou.
- A crowd more than half empty rows slides its rows down in place, where the mix qualified every
  voice again: with one of 10k tween voices replaced each frame, the worst of 12,000 frames fell
  from about 9 ms to 3 on teitou.
- A fold with a locus in play allocates nothing per subject: 10k subjects under three voices in a
  locus take 0.83 of the time they did on teitou, with a third of the collections.
- A read back copies records holding plain data directly, not through `structuredClone`: a
  projection made and probed every frame over 1k subjects and three voices takes 0.61 of the time
  ahead and 0.81 back.
- A spring works out its time terms once for the subjects released together: one spring voice over
  10k subjects read by `pull` takes about 0.89 of the time, and a spring voice per subject 0.86.
- A voice shares one record among the subjects it does not reach, where it kept a full one for
  each subject it was asked about. 1000 voices each picking one subject by `target` held 269 MB
  after their first frame and now 37 MB; that first frame takes 77 ms on teitou, from 123, and
  each later frame 0.86 of the time.
- A voice and its records make their maps, arrays and promises on first use, and a subject's
  number needs no token object. A voice of one subject holds 2.5 KB after its first frame as a
  `fn` (3.4 KB before) and 5.2 KB as a tween (7.3 KB). On teitou cueing 10k tween voices of one
  subject each takes about 18 ms, from 26, and reading their first frame about 31, from 39.
  `setting.keep` is now one function per voice that writes to the record being called for, so one
  kept and called after its call, which `Setting` never allowed, no longer reaches the record it
  came with.

## 0.4.0

### Breaking

- A tween's `MotionSpec` reads `ms: undefined` where its `ms` is a function of the subject.
- `Handle.state` can read `'held'`. Only a voice cued with `hold` reaches it, so nothing changes at
  run time for one cued without, but a `switch` over every state no longer covers them all.

### Added

- `mix.inert` is true when another frame would change no pose, so a host's loop may sleep while
  `live` is still true: every voice is done, held after its passes at a plain weight, or a motion
  whose every subject has landed on its target. A retarget, a fade or a cue makes it false again.
- `handle.fade({ subject, over })` fades one subject out of a voice, which plays on for the rest.
  Once the ramp ends the voice forgets the subject (its record, its lane position and a motion
  patch's state for it) and no longer reaches it; a motion patch's `to` brings it back, met afresh.
  `mix.drop(subject)` clears it too. It keeps the voice on its lane.
- `tween`'s `ms` may be a function of the subject, asked each time one of its stretches starts.
- `hold: 'before' | 'after' | 'both'` on a voice. Before, a subject shows the voice's first frame
  while the voice is pending and while the subject waits out its `stagger`; after, a finite loop
  shows its last frame once its passes are done and stays, `held`, until faded. `fade.in` counts
  from the first frame shown. What WAAPI calls `fill`.
- `handle.played` resolves true when a finite loop's last pass ends, false if the voice leaves
  first. It never rejects.

### Fixed

- A `keys` or stateless `fn` voice naming one subject and writing one channel fills from its
  channel's crowd, as a motion voice does, where it took the general path. On teitou 10k `fn`
  voices of one subject each read by `pull` take 0.7 of the time they did.
- A voice naming its subjects that is cued, starts or retires relinks only those subjects, and
  joins or leaves its crowd in place, where it made every subject relink and the lanes qualify
  every voice again: a frame stopping one of 10k such voices and cueing another fell from about
  9 ms to 0.6 by `pull` on teitou. `mix.drop` looks only at the voices over every subject and
  those naming the one dropped, where it walked every voice.
- `mix.drop` frees a subject from a voice faded off it with `handle.fade({ subject })`, and a mix
  whose last ramp of that kind is dropped can read `inert` again; it also frees the subject from a
  motion patch that another voice plays on after the voice naming the subject left.
- `pull` reads a list it read before in the same order from the lanes in one run, checking the
  frame once rather than per subject: a tween voice over 10k subjects read by `pull` takes about
  0.83 of the time it did on teitou.
- A lane gives a `vec(1)` channel an array of one, as the general path does, where it gave a
  bare number; and a motion voice on one folds without making an array per subject per frame.
- A `tween` divides elapsed by its length in milliseconds, so a point a whole fraction of the way
  in lands exactly: 150 ms into a 200 ms linear tween from 0 to 100 reads 75, not 74.99999999999999.
- `pull` over a list read again in the same order skips looking each subject up, and copies lane
  values a column at a time; a motion voice's lane fills in one loop. One tween voice over 10k
  subjects read by `pull` takes 0.59–0.66 of the time it did on teitou; a spring 0.68–0.74.
- Motion voices of one subject each fill from one crowd of flat rows per channel, and `sync` visits
  only voices with something due: 10k tween voices of one subject each take 0.54–0.59 of the time
  they did on teitou, 100k take 0.31–0.33.

## 0.3.0

### Breaking

- `spring` and `glide` build patches of a third form, `'motion'`, instead of `'fn'`, and carry
  their kind and constants on `patch.motion`, a `MotionSpec`. `Patch.form` and `Engine.runs` take
  `'motion'`, so an engine that declares `runs` must list it to run a spring or a glide. A motion
  patch throws when two of its subjects, or a subject's start, target and velocity, or a `to` or
  `push`, move on different numbers of axes. It makes a subject's first stretch at its first `to`
  or `push` as well as at its first read, so `read(subject, at)` answers from then on.
- An untimed retarget lands at the subject's own voice time at the mix's latest sync, not at the
  subject's next read, so a subject the host did not probe changes at the same moment as one it
  did; `read` with no time answers at that time, counting every change due by then. For a subject
  no frame of its voice has met yet, or still inside its stagger, an untimed change applies at its
  first read, after any timed change due by then, and `read` with no time returns undefined, as it
  does once the voice is gone. Changes apply in time order, not the order they were made.
- `drop(subject)` also forgets a motion patch's state for the subject, so it starts afresh.
- With lanes on, a stateless patch calling `setting.send` from `at` sends every frame for every
  subject the mix has met, probed that frame or not; and a patch that first calls `setting.keep`
  partway through playing can advance that state once more for one subject the host did not probe
  that frame.
- `mixHex`, and so the `hex` channel, blends in OKLCH rather than sRGB, taking hue the short way
  round and a gray end's hue from the other end. A crossfade from red to blue passes through
  0xba00c2 rather than 0x800080, and black to white through 0x636363 rather than 0x808080. A blend
  costs about 45 ns where the two ends repeat frame to frame and 210 ns where every call brings new
  colors, against 8 ns in sRGB. `hex({ space: 'srgb' })` keeps the sRGB blend.
- `Mix` has a `pull` method, so an engine's `create` must return a mix that implements it.

### Added

- `tween(writes, { from, to, ms, ease? })`, a motion patch that eases each subject from one value
  to another over `ms`, with `from` and `to` given per subject and read once when the mix first
  meets it. `to(subject, target)` retargets one subject from where it is over a full `ms` again,
  and `read` reports value and velocity as a spring's does. It runs on lanes as springs do, with
  each subject's endpoints as data, so a tween over every subject no longer needs a `fn` that looks
  its endpoints up on each call: in weasel's shape (10,000 string ids, endpoints in a map) a frame
  costs 0.83 of that `fn`'s and pauses for collection a quarter as long. A motion lane no longer
  allocates a delta per subject either, which takes a spring frame over 10,000 subjects to
  0.82–0.90 of the last build's. `MotionSpec` gains
  `{ kind: 'tween', ms, ease }`.
- Lanes: a channel every voice writing it can run that way is computed for every subject at once,
  in flat arrays, at the frame's first probe, rather than subject by subject, and gives the same
  pose. `keys`, a stateless `fn` and `motion` voices with a number weight qualify. Three `keys`
  voices over 10,000 subjects fell from 6.1 to 2.6 ms a frame. A lane whose subjects were mostly
  left unprobed last frame stops filling and its subjects take the general path until probes pick
  up again, so a host probing 5% of 10,000 subjects pays about what it would with lanes off, not
  ten times it. `MixOptions.lanes: false` turns lanes off. They cost a little on frames they
  don't serve: a voice per subject reads up to 7% slower at 10,000 subjects (about 20% at
  100–1,000, a few hundredths of a millisecond), a mix probing few of its subjects about 0.03 ms
  more, and a projection made every frame about 10% more.
- `mix.pull(subjects, { channel: Float64Array, ... })` writes each subject's pose into one array per
  channel, in the order given, giving what `probe(subject, out)` gives without a pose object per
  subject. A channel of `n` numbers takes `n` places a subject; one with no value writes NaN. While
  every voice runs on a lane it copies straight from the lanes: a frame of three `keys` voices
  over 10,000 subjects costs 0.84 of the same frame read through `probe`, a spring 0.91.
- `mix.project(timestamp)` reads the mix at another time without moving it: `probe` gives the pose
  then, and `assess` says per channel whether it is `exact`, `stepped` or `held`. Ahead it plays
  what is cued forward; behind it needs `MixOptions.history: { ms, every? }`, which keeps every
  handle change, the voices that left, and copies of stateful state, so a read back under `stepMs`
  lands on the pose the mix showed, and with `inputs` it records what input weight signals and the
  host fields patches `reads` held, so a read back over a `level` or a pointer is known. `Patch.clone` copies state `structuredClone` cannot.
- The score: a voice takes a `name` and an `anchor` placement, `start` or `in` and `out` or `end`,
  each a timestamp or another voice's mark (`after`, `with`, `before`, or `of` plus `mark`),
  selected by name, tag or written channel with a resolver. Each source can keep its own `score`,
  with names namespaced per score. `mix.announce(name, { at? })` puts a named mark on a score for
  anchors to wait on, and `mix.marks(from, to)` lists every mark the plan knows.
- `spring` and `glide` keep every stretch within the mix's history, so a read before a retarget
  finds where the subject was.
- A cue can name its subjects, `subjects: [a, b]`, in place of a `target`. The mix files the voice
  under each one, so a voice per subject costs the same as one voice: the first frame of 1,000
  subjects on a voice each fell from about 500 ms to 1 ms.

### Fixed

- A voice faded before its start plays once its start arrives. It used to stay out of every
  subject's fold until some other voice was cued or left.
- A probe after a `seek` in the same frame reads the voice where the seek put it, rather than the
  value an earlier probe that frame read before the seek. A stateful patch still steps once.
- A probe looks its subject up once rather than once per voice, which makes frames with several
  voices 5–12% faster.
- A `keys` patch reads a keyed `vec` channel into an array its voice reuses, rather than a new one
  each read, which halves collections at 10,000 subjects and leaves frame time unchanged.

- A finite loop's fade out starts when its last pass ended, not at the first frame after, so it
  plays the same at any frame rate.
- The published `package.json` no longer lists `workspaces: ["site"]`, which only the repo's docs
  site uses.

## 0.2.1

### Added

- Channel `bounds`: `sum`, `mul` and `max` take `{ bounds: [min, max] }`, and `vec` inherits its
  axis channel's. The mix clamps the folded value to the range, so stacked voices and a retarget
  that carries speed stop flat at the bound. Bounds are part of the channel's kind.

## 0.2.0

### Breaking

- A `keys` voice cued with `from: 'current'` now leaves at the velocity the subject had, taken from
  its last two probed poses, instead of on the first segment's own curve. A subject that was still
  leaves at rest. Only the first segment changes, and it still lands on its stop.
- `Handle` gains `ramp`, so an object written to stand in for a handle needs one.

### Added

- `handle.ramp(rate, over)`: eases a voice's playback rate to a new one over `over` ms, so a pause
  or a slow-motion does not snap. The voice clock integrates the ramp.

- `spring` and `glide`: momentum in closed form, per subject, so where a subject is does not depend
  on frame rate. `spring.to` retargets and `push` sets a velocity mid-flight, each starting the next
  stretch from where the subject is and how fast it moves; `read` returns both, for handing motion
  to another patch.

### Fixed

- Keyed stops, and a `from: 'current'` retarget, interpolate through the channel's own `lerp`, as
  the schema says. They used plain numeric interpolation unless `lerpBy` named one, so a keyed
  `hex` color blended its packed integer instead of its components. `lerpBy` still wins, and a
  `keys` patch read outside a mix uses the `kit` it names.

## 0.1.1

### Fixed

- Published from the release workflow through npm's trusted publishing, with a provenance
  statement. The code is 0.1.0's; only the version and this changelog differ.

## 0.1.0

First release, published by hand. A mix folds concurrent effects into one value per subject per frame: each effect runs
on its own clock with its own state and weight, and the rules for combining them belong to the
channel being written rather than to the effect writing it.

What is here: the stock channels (`sum`, `mul`, `max`, `last`, `vec`, `hex`), both authoring forms
for a patch (a function of phase, or a list of keyframes), voices with rates, loops, stagger, fade
envelopes and loci, the five signals (`peak`, `slew`, `lag`, `level`, `gate`) with their state
kept per voice and subject, per-subject state that catches up by its own gap or, under `stepMs`, at a
fixed interval so it plays the same at any frame rate, events a patch sends for the host to `drain`,
`handle.weightOf` for reading a voice's weight per subject, the checks that let one package's
patches mix into another's (`Channel.kind`, `Patch.kit` and `Patch.reads` checked at `cue`, and
`tags` to drain one package's events), and the `Engine` seam behind `mix`.

[klieg](https://github.com/orochi235/klieg) composes its motion, its effects and its lighting on
this, which is where the arithmetic was proven: that port changed no number and moved no baseline.

Zero runtime dependencies. ESM only. The design is `docs/schema.html`, shipped alongside.
