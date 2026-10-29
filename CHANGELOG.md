# Changelog

This package follows [semver](https://semver.org). Below 1.0.0, a breaking change bumps the minor
version and everything else the patch. Each release lists its changes as **Breaking**, **Added** and
**Fixed**, and the release workflow refuses a tag with no section here.

## Unreleased

### Changed

- A voice cued with `subjects` asks `stagger` for each of them at `cue`, not on first sight, and a
  finite loop ends once its latest-staggered subject is done whether or not the host has read that
  subject yet. A read ahead now sees the same end as the live mix. A voice reaching its subjects by
  `target` still ends by the subjects it has met.

## 0.15.0

### Breaking

- `Setting`'s fields are `readonly`, so a patch or signal that assigns to
  `setting.weight`, `dt` or any other field no longer type-checks. The mix reuses one setting per
  voice across subjects, so such a write already reached whatever it called next. A patch's
  `state` is still its own to change in place.

### Changed

- A locus is now a **role**, `VoiceSpec.role`: voices in one role are alternatives, so whichever
  plays it, the subject shows one performance, not two stacked. `locus` is still taken as `role`
  for one release, deprecated, and the mix warns once outside production; a voice given both with
  different values is refused. The mix option for tags that act as roles is `roles`, and `loci` is
  taken the same way. Errors and warnings say role.

### Added

- `within` on a cue: a circle `{ x, y, r }` (the type `Circle`) the host moves, outside which the
  voice's weight signal is 0, so the mix gives those subjects nothing without calling the signal for
  them. The host gives the subjects' positions with `mix.plot(subjects, xy)`, two numbers a subject
  read in place, and calls `mix.moved()` after writing new ones. Positions hold an object subject
  weakly, and `drop` takes a subject's away. Outside production the mix warns once if the signal is
  above 0 just outside the circle, which would cut it off there. A voice naming its `subjects` and
  a role member, an owner's child, a motion, a patch keeping state and a `from: 'current'` voice
  take it; a patch that steps still steps outside the circle, and a `from: 'current'` voice still
  takes its base there, as each does at weight 0. Under history a bound reads as its signal does:
  live on a read back, or with `inputs`, as the signal's recorded reads, a 0 recorded for each
  subject read outside.
- `within` also takes a finder of the host's own, `{ find(out) }` (the type `Finder`), over any axes
  or none: once a frame `find` writes into `out`, an `Int32Array` the mix lends it, the indices of
  the subjects the signal can be above 0 for, and returns how many. A circle and a finder share one
  path through the mix.
- `mix.place(subject)` gives a subject its index, which a finder names it by: the one it has, or a
  new one. It keeps it until `drop`, or for an object until it is collected, and the index then goes
  to the next subject placed. `plot` hands out indices too, in its list's order. With no `plot`,
  `put` writes into positions the mix keeps itself, and a placed subject has none until then.
- `mix.around(circle, { ease })`, a weight signal over the plotted positions: 1 at the circle's
  center, falling to 0 at `r` along an easing, linear by default. A voice it weighs is bounded to
  the circle as if cued `within` it, with no check for a clipped signal, from the first `plot` if it
  was cued before one.
- `mix.put(subject, x, y)` moves one subject, for a host where few move at once. It writes into the
  array `plot` was given, so it mixes freely with writing that array and calling `moved`, or with no
  `plot`, into the mix's own, and keeps the grid as built until a sixteenth of the subjects have left
  their cells. It throws for a subject with no index, or one past the array `plot` was given.
- A watched mix's `voice(handle)` gives `within`, the circle a voice is bounded to by `within` or
  an `around` weight, or its finder, the host's own object, or undefined for none. blits-panel draws
  circles only.
- `color({ lerp: 'oklch' })` and `color(last(), { lerp: 'oklch' })` run on lanes, where they took
  the general path. The pose is the same to the bit.
- `mix.pose()` makes a new empty pose for `probe`'s `out`, holding each channel with a rest in kit
  order. Made once and probed into every frame, its numbers are written without allocating, where
  an `out` made as `{}` can box each one: about 310 kB a frame less on a 10,000-subject scene.
- Named, exported types for option bags and return values that were written inline, so each can
  be read on its own: `LastOptions`, `NumberTuple`, `Layout`, `OverrunOptions`, `MotionOptions`,
  `SpringOptions`, `GlideOptions`, `TweenOptions`, `Spring`, `Glide`, `Tween`, `SpringSpec`,
  `GlideSpec`, `TweenSpec`, `Input`, `Level`, `SlewOptions`, `LagOptions`, `Band`,
  `AnnounceOptions`, `TapeOptions`, `Taken`, `VoiceFade`, `SubjectFade`, `RegistryChange`,
  `WatchedHistory`, `WatchedVoice`, `Probed`, and `Pulled`. `Moving` and `Signal` are interfaces now,
  of the same shape.

### Fixed

- A host writing into a pose `probe` handed back without `out` no longer changes where a later
  `from: 'current'` voice starts, or the speed it starts at: the mix keeps a copy of that pose, not
  the object itself.
- Probes of subjects on lanes cost 4 to 10% less a frame: the copy of laned values into the pose
  stores each channel under its own name, written out once per set of laned channels, where one
  store by a varying name went through V8's generic path. A voice over 10,000 subjects replaced
  every frame (`swap`) takes 1.632 ms a frame against 1.739, its keys form 1.165 against 1.259, and
  a probe then `atRest` of each subject (`probed`) 1.333 against 1.487 (teitou, medians of nine
  runs, each in its own process). A pose the mix makes itself, for a probe without `out`, `atRest`
  or `pull`, is now a plain object of the mix's own shape holding each channel with a rest in kit
  order, so its numbers are stored unboxed. Under a content security policy that refuses
  `Function`, the copy is the loop it was, and the mix asks only once, so a page sees one
  violation at most: each refused `Function` fires one, caught or not.
- A weight signal on lanes is handed, after a stretch of frames at weight 0, the `dt` since its
  last read, as it is off lanes. It was handed the gap since the subject last had a delta.
- Tweens read by `pull` cost about a twentieth less a frame: a probe holds its subject for the
  next fill only while fills look subjects up, which bare tweens never do, and a motion voice's
  fill reads each subject's flags once and weighs a shared fade once. 10,000 one-subject tween
  voices (`tweens^`) take 0.285 ms a frame against 0.300, and one tween voice over 10,000 subjects
  (`weasel^`) 0.369 against 0.391 (keiei, medians of seven runs of 5,000 frames, each in its own
  process); other rows are unchanged.
- 10,000 one-subject tween voices read by `pull` (`tweens^`) cost about 7% less a frame, 0.163 ms
  against 0.175: a crowd row's fill checks once, not every frame, that its stretch is numbered and
  its subject met (teitou, medians of nine runs of 5,000 frames, each in its own process).
- Starting voices allocates about 400 B less each: a voice's `subjects`, given as an array of
  distinct subjects, is copied without being iterated, and voices of a patch writing one channel
  share their channel slots. 10,000 one-subject voices' first frame takes 20.7 ms against 23.5 for
  tweens and 8.9 against 10.8 for fns (teitou, medians of nine rounds; `bench/start.mjs`).
- A mix with no tape no longer makes the closures that record the host's calls only to drop them:
  a cue, a `drop`, a motion change and every handle write each made one. A voice cued and replaced
  leaves 11.7 KB of garbage against 12.4 (keiei, medians of three alternated passes of
  `bench/churnwho.mjs 5000`); frame cost is level.
- A stateless fn voice over every subject cued between frames costs about a quarter less on the
  frame its subjects first meet it: their probe makes its first call on its lane and folds it into
  the lanes' values, where it was folded on the general path. A voice over 10,000 subjects
  replaced every frame among a tween voice per subject (`swap`) takes 2.67 ms a frame against
  3.67, and allocates 2.0 MB a frame against 2.8 (msb-uai, medians of seven runs of 3,000 frames,
  each in its own process).
- That frame costs about a sixth less again where every subject was probed the frame before: the
  voice's lane takes every subject when it opens, and the fill makes each one's first call, where
  each probe met the lane and made it. `swap` takes 2.19 ms a frame against 2.64 (msb-uai, medians
  of seven runs of 3,000 frames, each in its own process); other rows are unchanged.
- A `keys` voice over every subject cued between frames gets both: a probe meeting its lane reads
  it there, and where every subject was probed the frame before, its lane takes them all when it
  opens. A keys voice over 10,000 subjects replaced every frame among a tween voice per subject
  (`swapkeys`) takes 1.21 ms a frame against 2.26 (teitou, medians of seven runs of 3,000 frames,
  each in its own process); other rows are unchanged.
- A `keys` voice per subject read by `pull` costs about a sixth less a frame: rows whose stops
  share their phases and easings, at the same phase, find their segment and ease it once rather
  than once a row. 10,000 of them (`keyses^`) take 0.270 ms a frame against 0.327, and allocate
  half as much (teitou, medians of nine runs of 5,000 frames, each in its own process). A lane fill
  also reads a subject's last-read stamp only where the weight it keeps for `weightOf` could
  change, which takes `weasel^` from 0.204 to 0.198 ms; other rows are unchanged.
- A voice weighted by a signal costs a little less a frame on lanes: its setting's `timestamp`,
  `elapsed` and `pass` are filled once for the subjects that share them, not once a subject. A
  pointer glow over 10,000 subjects read by `pull` (`glow^`) takes 1.657 ms a frame against 1.708,
  and three signal-weighted voices over 10,000 (`signal`) 4.511 against 4.641 (keiei, medians of
  seven runs of 5,000 frames, each in its own process); other rows are within their spread.
- A role, and so a `mix.blend`, costs a further tenth less a frame on lanes where no other voice
  falls between its members in voice order: each subject's members are gathered and folded
  together, at the first member's turn, rather than gathered for every subject and folded in a
  second pass. Three voices in a role over 10,000 subjects (`role`) take 2.555 ms a frame against
  2.839, and a blend of three (`blend`) 2.841 against 3.055 (teitou, medians of nine runs of 5,000
  frames, each in its own process); three plain voices (`fn`) and three signal-weighted ones
  (`signal`) are unchanged.
- A role, and so a `mix.blend`, costs about a tenth less a frame on lanes, and allocates no more
  than its members would apart: a member's numbers reach the role without being boxed, 16 bytes
  each a channel a subject. Three voices in a role over 10,000 subjects (`role`) take 4.349 ms a
  frame against 4.810 and allocate 2.4 MB against 4.0, and a blend of three (`blend`) 4.633 against
  5.128 (keiei, medians of seven runs of 5,000 frames, each in its own process).
- `project` back under `history` reads a motion voice's subject as it showed. A subject retargeted
  and then faded out of the voice or dropped read back to before it left as though met afresh from
  `from`, and a retarget, push or `set` given a time earlier than the frame it was made in read back
  as in force before that frame. A seek already read both right. A read back no longer numbers a
  subject in the live patch either.
- A read ahead across many known events of a stateful mix costs a quarter to a third less a frame
  and allocates half as much: each stop hands a subject's record on to the next instead of copying
  it, and a voice starting many stops on asks only the copies that may hold a record for it.
  Reading 5 s ahead past the starts, fade-ins and ends of seven voices over 1,000 subjects (`far`)
  takes 15.1 ms a frame against 20.5 and allocates 25 MB against 53, and over 10,000 subjects 201
  ms against 305; seeking back over the calls that cued them and reading ahead to where the mix
  was (`redo`), 15.5 ms against 21.0 (teitou, medians of five alternated runs of 100 frames against
  `be0aaa4`). With 31 voices starting 150 ms apart, the record handed on reads 154 ms against 182,
  and looking past the copies 109 against 151 (against `03af146`).
- A voice stopped before its end is let go of when it stops. The mix's schedule kept an entry for
  the time each voice would next change, and one stopped early stayed in it, holding the voice,
  until that time came: 20,000 `patch` voices of 10⁹ ms replaced over 1,000 subjects held 47 MB of
  heap, and now 2.4 (keiei, one run each, `bench/leak.mjs`). A motion patch was never held, as it
  schedules no end.

## 0.14.0

### Added

- `set(subject, value, at?)` on `spring`, `glide`, `tween`, and a voice's handle puts a subject at a
  value and keeps its velocity: a spring or tween heads for its target from there, a glide coasts
  on. A seek plays it again, as it does a push.
- `@msb235/blits/fling`: `fling(element, motion, subject, opts)` drags a subject by pointer and
  flings it on release, and `track` reads a pointer's velocity from its samples with no listeners
  of its own. The package still builds without the DOM's types.
- `glide` takes `bounds: [min, max]`, per axis and optionally per subject: a coast that would stop
  past an edge springs back to it from where it crosses, on a critically damped spring of
  `stiffness` (default 170). A `set` past an edge stays there until the next push. `g.bounds(subject)`
  reads them, and `Patch.motion` reports the `stiffness` of a glide that has them.
- `fling` resists a drag past a glide's bounds, carrying the subject at most `give` (default 120)
  past an edge, and a press holds a subject springing back past one where it is.

### Fixed

- A voice cued with no `start` into a mix whose frame loop sleeps on `inert`, as `ticker` does,
  starts at the next sync. It started at the last one, so an effect cued after a pause had already
  played that far, and a short one was over before its first frame.
- A patch that names no host type can be cued and blended in a mix that declares one, so a patch
  library's patches type-check in a host-typed mix. `VoiceSpec.patch`, `BlendMember.patch`, and
  `blend`'s members take a patch keeping any state.
- A seek back keeps out a subject that had already left a voice at rest by then. After a fade with
  `at: 'rest'`, a seek to a moment where that subject was moving again put it back in the voice,
  playing.

## 0.13.0

### Breaking

- A mix's stock `band` is on at any weight above 0 and off at 0, where it was on above 0.6 and off
  below 0.4. A channel with no rest, such as `last()`, now shows its value through a whole fade in or
  out. Pass `band: { on: 0.6, off: 0.4 }` for the old behavior. `fold` follows the same default.

### Added

- A mix's `loci`: tags that act as loci, so a voice carrying one folds with the others carrying it,
  as if its `locus` named the tag.

### Fixed

- A seek with `state: 'keep'` that sends a subject back before its start now starts it afresh there.
  It kept the state it had stepped to, so what it showed, and how it played on from its start,
  depended on how often the host had read it, and a mix seek could put back the state from before.
- A mix sought back and then ahead to where it stood reads the same `now` on its next sync as one
  never sought. At some mix rates it read one rounding step off, and every later sync kept the error.
- Replacing voices costs less a frame: a crowd catches up only the rows marked stale, where it
  scanned every row, and a few retired voices are spliced out of the list. One subject leaving for
  good each frame and a new one coming (`turnover^`, 10,000 subjects) takes 0.286 ms a frame
  against 0.315, and one voice replaced in place each frame (`churn^`) 0.224 against 0.252 (teitou,
  medians of nine runs of 5,000 frames, each in its own process); steady voices are unchanged.

## 0.12.1

### Added

- `mix.close()`: takes a mix off the list debuggers read, for a host tearing it down, where it would
  otherwise stay listed until collected. It stops every debugger watching it, and frees a debugger's
  hold unless another listed mix shares its transport.

### Fixed

- An arc not yet started, cued late or under an owner yet to start, no longer shows its enter's
  first frame from the moment it is cued.

## 0.12.0

### Added

- `curve(easing)` and `Curve`: the function an easing stands for, from a CSS name, a `bezier`, a
  `steps` or a function, for a host shaping its own ramps with the curves patches use.
- `mix.arc(spec)`: an owner holding three parts that hand over in order on its clock, `enter`,
  `active` for the `hold` and `exit`, each a voice's spec or several layered, with a `blend`
  crossfading across each boundary. Its marks are its own: `in` as the enter ends, `coast` and
  `out` as the hold ends and the exit begins, `end` as the exit ends, where it leaves and `done`
  resolves. `hold: 'open'` holds until `release()` on its handle, which a seek replays; `fade`
  takes it out with no exit. An arc with a finite hold sits in a span. It is klieg's `fire` as a
  blits primitive, under the same part names. The schema page's "Arcs" says what each part does.
- A span child's `earliest` and `rank`. `earliest` is the soonest it may start, a time on the
  span's clock or an anchor; the fit never places it sooner, and the children after it are laid
  out from where it starts. One already past when it is cued places it there, partway through, so a
  span made afresh after a seek plays as it did. One whose anchor has no answer yet waits, with every child
  after it under `queue` or `stagger`, and the span fits again once the anchor answers. `rank` orders the
  children still to start, lower first, ties as cued. Together they replace astv's own change
  order, which sorts its changes by line and starts each no sooner than its orb lands.
- `watched()`: every mix on the page, for a debugger, in one registry that all copies of blits
  share. Each entry can:
  - `watch` what the host reads each frame
  - `read` a subject the host never probes, now or back in history, through `project`
  - `label` a subject
  - list its kit's `channels`, and the `name` and `tags` a voice was cued with
  - `hold` the mix's clock to pause, step and seek it, without writing to the tape, then `free`
    it
  
  A mix nobody watches runs the same code as before, and one a debugger has let go of runs as fast
  as one it never watched. `watched().history` gives history to mixes
  made later that name none. `MixOptions.labelOf` names subjects for it.

### Fixed

- Replacing a voice makes less garbage again: a one-subject tween voice retargeted as it is cued,
  while another leaves and its subject is dropped, allocates 11.4–11.7 KB, from 13.0–13.4
  (`bench/churnwho.mjs`, 5,000 voices, teitou, three passes a side). Frame time is unchanged.
- A voice over every subject that plays more than 60 frames costs less a frame: it now keeps a
  record for each subject, where it kept one for them all that every read had to point at its
  subject and back. Three `fn` voices over 1,000 subjects (`fn`) take 0.212 ms a frame against
  0.226, eight 0.468 against 0.526 (teitou, medians of nine alternated runs of 1,500 frames against
  `a77c5c9`). A voice cued and gone within a few frames still shares one record, which is what it
  was for.
- A crowd of `fn` voices writing arrays, one voice per subject, costs about a tenth less a frame
  where nothing else writes its channels: it runs off lanes, where its subjects are walked once
  instead of twice. A `fn` voice writing a vec for each of 10,000 subjects (`fns`) takes 1.348 ms
  a frame against 1.519 (msb-uai, medians of nine alternated runs of one build with lanes kept
  for it and not). So does a single `fn` voice over many subjects writing a vec, where no other
  voice writes it: weasel's animator written as one (`weaselfn`) takes 1.734 ms against 1.823,
  and one writing a position from each subject's own numbers (`tweenfn`) 1.163 against 1.410.
- A mix with lanes on whose voices all run off lanes costs a probe less bookkeeping: `tweenfn`
  takes 1.097 ms a frame against 1.172 and `weaselfn` 1.644 against 1.723 (msb-uai, medians of
  thirteen alternated runs of one build with the change switched on and off).
- A voice on a lane costs a call less a subject each frame: since 0.11.0 the check for a voice
  hiding past its end left its clock read out of line. A glow weighted by a signal over 10,000
  subjects (`glow`) takes 1.636 ms a frame against 1.696 (teitou, medians of fifteen alternated runs
  against `11a1471`).
- A mix keeping history costs about a fifth less a frame and allocates a third less: the copy of a
  record that falls out of the window is written over as the next one kept, only a motion voice
  works out how far back a read may still reach, and a stock `sum`, `mul` or `max` channel folds a
  voice's number without calling the channel. Three voices over 10,000 subjects with 5 s of history
  (`kept`) take 5.33 ms a frame against 6.56 and allocate 5.7 MB against 8.5; sought back and
  returned before every sync (`seek`), 5.90 ms against 6.76; at 1,000 subjects, 0.412 against
  0.500 and 0.540 against 0.598 (teitou, medians of nine alternated runs of 1,500 frames against
  `00ad148`, each in its own process).
- A `seek` back and a return to where the mix was cost about a third of what they did: a record put
  back takes up the state of the record the seek replaced instead of stepping again from its copy,
  is written over that record instead of copied anew, and the copy its next probe keeps is written
  over one the seek cut; subjects keep their numbers across the seek. Three voices over 10,000
  subjects with 5 s of history, sought 300 ms back and returned before every sync (`seek`), take
  9.83 ms a frame against 28.60, and allocate 8.6 MB a frame against 35.2; 1,000 subjects take 0.86
  ms against 1.88 (msb-uai, medians of nine alternated runs against `4374f34`, each in its own
  process). The same mix never sought (`kept`) reads 7.41 ms against 7.33 at 10,000 subjects and
  0.645 against 0.676 at 1,000. A `step` that reads `setting.weight`, `elapsed` or `pass` now shows,
  after a seek back and return, what a mix never sought shows. A seek no longer boxes its moment
  once per record it puts back: the `seek` row at 10,000 subjects allocates 7.9 MB a frame against
  8.8, and takes 10.44 ms against 9.88, inside its runs' spread (msb-uai, medians of nine
  alternated runs against `1077ab4`). A seek's relink takes each voice's record from the subject's
  old chain where its store can tell the record is still its own, instead of looking it up by
  subject: the `seek` row at 10,000 subjects takes 9.42 ms a frame against 9.95, and 1,000 subjects
  0.864 against 0.884 (msb-uai, medians of nine alternated runs against `c3fe7a8`).
- A mix sought back often no longer grows without bound: each voice kept a little for every seek
  back to a later moment than the last, and the records subjects left with after each seek, and
  let go of neither. Three voices sought back and returned every frame held 2.26 MB more after
  12,000 frames; they now hold what their live records need.
- A lane fill no longer boxes numbers it hands between its own calls, which it did for 3 to 5
  numbers a subject in some processes and none in others, by the order V8 happened to compile in.
  10k subjects under a `fn` voice and a signal-weighted glow over 200 of them, with 200 subjects
  leaving the glow and 200 entering each frame (bench/reach.mjs `part:200`), allocate 1.27 MB a
  frame against 1.89 and take 1.924 ms against 2.037 read by `probe`, and 1.255 against 1.405 by
  `pull`; with nothing moving by `pull`, 1.108 against 1.221 (keiei). `probed` allocates 1.02 MB a
  frame against 1.65. No steady row moves past its spread: `fn` 2.942 against 2.903, `fn^` 2.323
  against 2.390, `keys` 1.355 against 1.342 (msb-uai); `signal` reads 3.820 against 3.578, inside
  its spread but slower in each of three such comparisons. Medians of six alternated runs, each in
  its own process, `bench/ab.sh` against `main` at `4374f34`.

## 0.11.0

### Breaking

- A voice plays one pass unless told otherwise: `loop` defaults to `false`, where it defaulted to
  `true`. A `cue` that left `loop` out and relied on looping for good now needs `loop: true`. A
  patch with no duration, and a motion patch, have no passes and play as before.
- `Marked.mark` and an anchor's `mark` are a `MarkName`, one of a voice's five or a name it placed
  inside itself, where they were a `Mark`. Code that reads `mark` as one of the five, such as an
  exhaustive `switch`, needs a case for the rest.

### Added

- `marks` on a voice's, an owner's and a span's spec: named marks inside it beside its five, each
  at voice ms into a pass, `marks: { drop: 340 }`. An anchor names one as it names the five,
  `{ of: 'lead', mark: 'drop' }`; `marks` lists it, `book` books it under its name, and a read
  ahead stops at it. Each is reached once, on the first pass that reaches it from where the voice
  starts, while its clock runs forward and before it ends. A name of one of the five, and a time
  outside a pass, are refused at `cue`.
- `@msb235/blits/lean`: the package with a `mix` that leaves lanes out, for a host whose scenes
  are too small to need them. It gives the same poses, and a bundle of `mix`, `kit`, `sum` and
  `patch` is 44.5 kB gzipped against 59.9 from the main entry (esbuild, minified). `lanes: true`
  is refused there. Its engine is exported as `lean`.
- A read ahead after a seek back plays the calls the tape holds: `project(t)` past a recorded
  call threw, and now makes the call on its copies as a seek there makes it on the mix. It still
  throws for a `drop` of a subject a motion patch holds, and for a retarget or push made before
  its voice had met the subject. The tape moves forward and back while the read is made.
- `stepMs` on a voice's spec: the interval its `step` runs at, in place of the mix's. 0 steps it
  once a frame by the frame's gap.
- `share(by, i, n)`: member `i` of `n`'s share of a signal, as `mix.blend` weighs it, to weight a
  voice outside the blend as that member, such as one member played alone.
- `mix.blend` takes a `BlendMember`, `{ patch, name?, tags?, hits? }`, in place of a bare patch, so
  a member answers to its own name in an anchor and carries its own tags and hits. Bare patches
  take the spec's as before.
- A mix warns, once per patch and outside production, when the first delta a voice's `at` returns
  holds a key outside the patch's `writes`, naming the voice and the key. The mix still drops the
  key, as it always has; `checkPatch` in `@msb235/blits/testing` still finds one returned only on
  some subjects or phases.
- `hits` and `seek` on an owner's and a span's spec. A hit is an event at a time on the owner's
  clock, booked once while the owner plays, with its `score` and `tags`; a seek is where that clock
  starts, so an owner cued at a rate below 0 with a seek plays its children back from there.
- `seek({ frame })` and `project({ frame })`, on a mix and a transport, reach a frame by its
  number, which `mix.seq` and `transport.seq` read. Rate 0 can hold mix time still across several
  frames, and a seek or read by time lands on the last of them; by number it lands on any one
  history still holds.
- `catchUp: 'fresh'` on a voice's spec: a stateful subject first probed after its delay ran out
  starts stepping from that probe with fresh state, where the default, `exact`, steps it from its
  origin. The `stepMs` grid still counts from the origin, the fade-in is unchanged, and a handle
  `seek` still rebuilds from the voice's start. Its state depends on when the host first looked,
  so a read that meets such a subject late assesses it `held`.
- A read ahead stops at each known event between now and the time read: each call the tape holds,
  and each mark `marks` would list. A subject asked about is read at every stop, so a patch that
  steps takes one step per stretch and a signal that keeps state sees each boundary: a voice
  starting on the way meets its subject at its start, where it met it at the time read. `assess`
  says `exact` for a stateful signal a read ahead fed, where it said `stepped`. The stops are made
  only while a voice has a `step` or a signal weight; otherwise a read ahead crosses the gap in
  one go as before.

### Fixed

- A seek ahead, or a read ahead, to the mix time rate 0 is holding stays at the host's own time.
  It took the earliest host time the mix read that time at, behind calls already on the tape, so
  a later seek back cued a voice still playing a second time and the next probe never returned.
- `weightOf` on lanes reports the weight a voice over every subject gave a subject before a
  subject fade made it keep a record per subject, until the next read. It said 0, where the
  general path said the weight.
- A seek or read back to before a `drop` finds a subject's fade out of a voice as it stood: mid
  ramp, or faded out. It found the subject at full weight, and one faded out of a voice that had
  not met it stayed out even before the fade. A subject a motion's retarget brought back after a
  fade out is found faded out between the two.
- `rise` on a voice faded before its start leaves it `pending`, to start on time and follow its
  anchor again, as a seek back finds it. It went `live` at once and played from where its clock
  would have read 0, ahead of its start, so a seek back played on differently from playing
  straight through.
- A read back to the frame a `drop` was made in, before anything read the mix that frame, shows
  the subject met afresh, as the frame did. It showed the record the subject had before the drop,
  a slewed weight's state included, in `project(t)` and `project({ frame })`.
- `assess` after a seek back says `stepped` for a stateful signal the seek put back from a copy
  history kept and stepped on, where a read at the mix's own time said `exact`. It goes on saying
  so for that record as the mix plays on, since the state carries on from the step.
- A voice running back from past its end shows nothing until it reaches its passes, unless it
  freezes after, as a voice playing forward shows nothing before its start unless it freezes
  before. It showed its last frame: `rate: -1, seek: 600` on a 300 ms pass showed it for its
  first 300 ms, and so did a child its owner, turned back, had put past its end.
- An owner's `out` and `end` marks are known while it plays, at its last child's end, once every
  child's end is. They were fixed only when it left, so `marks` listed them only then and only
  under `history`, a booker took them a frame late, an anchor to an owner's end waited until it
  left, and without `history` they were never booked. Its `coast` stays listed once it has left,
  where it went with its last child.
- `pull` reads `undefined` at a position its list has gained. A list read as `[undefined]` and
  then as `[undefined, undefined]` threw, reading the new position as the subject it read there
  last time.
- A spring, glide or tween made by another copy of blits of the same release, loaded beside this
  one, runs as a motion on this copy's mix: on lanes, and retargeted, pushed and read through its
  handle, which refused it. It played through `at` off the lanes. Copies of different releases
  still keep apart.
- `mix.span` refuses a rate below 0. A span cued backward placed none of its children, which
  waited for good, and never left. Its handle's `rate` still turns one that plays.
- A voice whose patch has no duration books no hits while its clock runs back, as every other
  voice does. One cued backward booked each hit ahead of it.
- A fade set for a time after a voice's passes run out no longer begins in place of the voice
  ending, where one frame crossed both: `fade({ at })` on a voice with no `freeze` that ended
  before `at` played on, held at its last frame, until the fade finished.
- A seek forward to the time of a recorded call lands that frame once. It landed it again after
  the call, so a `rise` played there on a voice past its end began the voice's fade over.
- A voice cued with `seek`, or sought while pending, keeps its count of rebuilds with its
  controls when it starts. A seek back to after its start, then a handle `seek` played again
  before the subject was read, left the subject's state as it was rather than rebuilding it.
- A mix sought back time after time no longer steps a subject from the same copy of its state,
  further each time. A seek lets go of the copies made after the moment it sought, so a mix
  sought 300 ms back and to where it was before every frame stepped each subject from the copy
  before its first seek: 70 steps at the first frame and 1069 at the 300th, at `stepMs` 5. The
  copy a record is put back from now keeps its state stepped ahead to near the moment sought,
  and the next record put back from it steps on from there: 67 to 74 steps at every frame. It
  shows the same values. Under `maxDt`, without `stepMs`, or for a patch that `reads` a host
  field, a record steps from the copy as before.
- Replacing a voice makes less garbage. A one-subject tween voice retargeted as it is cued, while
  another leaves and its subject is dropped, allocates about 13 KB, from 21.5
  (`bench/churnwho.mjs`, 5,000 voices), and a `pull` keeps what it knows of a channel between
  calls, about 1.2 KB a call for four channels. Frame time is unchanged.
- A seek back, or a read back, places a subject whose start had moved while it waited where the
  move put it. A copy of a record kept while its `stagger` delay was running, on a voice with
  `freeze: 'before'`, holds the start as it was then; a rate, a ramp, a `seek` with
  `state: 'keep'`, an owner's rate or the mix's rate then moved that start, and a record put back
  from the copy to a moment past the old start kept the old one, so its `step` ran on from the
  wrong time. A seek lets go of the later copies, so a mix sought back before every frame showed
  it at every frame from then on; `project(t)` showed it for `t` up to one copy's interval past
  the move.
- A seek back to before a subject faded out of a voice finds the voice reaching it again, where
  the voice had not met the subject before the fade. The subject stayed out of the voice with
  `lanes: false`, and with lanes on for a voice naming its `subjects`; otherwise lanes brought it
  back, so the two paths read differently. A read back to before the fade, `project(t)`, left
  it out on both, and reaches it now.
- A seek or a read back into a subject's ramp out of a voice, `fade({ subject, over })`, finds
  the ramp once it has ended. The subject read at full weight there, and after a seek it stayed
  in the voice at full weight for good.
- `weightOf` reads 0 after a seek back until the subject is probed again. What a subject's last
  probe by then read is not kept, and it reported a weight from after the moment sought, or one
  older than its last probe for a voice on a lane, so the two paths read differently.
- A write to the handle of a voice waiting for its cue after a seek back changes nothing, and the
  tape does not record it. It put the voice on the mix's schedule, so the voice started at its
  start time outside the mix, folded in but missing from `voices()`, and it branched the tape,
  which left the voice's cue in the old future.
- Dropping a subject no longer costs time in step with how many subjects the mix holds. With a
  tween voice per subject, stopping one voice and dropping its subject cost 2.2 µs among 1,000
  subjects and 15.6 among 10,000; it costs 0.9 and 2.6 (`bench/restart.mjs`).
- The first `pull` after a voice naming a subject comes or goes, or a subject is dropped, no
  longer reads every subject's chain to find the ones that changed, and a retargeted tween copies
  its stretch without an iterator. The frame after 100 voices are replaced among 10,000 took
  about 2.1 ms and takes about 1.35.

## 0.10.0

### Breaking

- A booker is ended with `cancel()`, and `take` returns `{ cancel() }` to hear that its item moved
  or went away. Both were `stop`: `mix.book(...).stop()` and `{ stop() }`.

### Added

- A booked hit carries `subjects`: the ones its voice names with `subjects`, or undefined for a
  voice that names none. `BookedHit` and `BookOptions` take the subject type as a second
  parameter.
- `at(timestamp)` on a booker: where a host time falls on the outside clock, by the offset the
  booker keeps.
- `mix.timestamp`: the host's timestamp at the last sync.

## 0.9.0

### Breaking

- A stock `last()` channel in a locus takes its heaviest member's value, and the later cued of
  two as heavy. It stepped through its members in cue order, so three voices at weights 0.3,
  0.3, and 0.4 showed the second. Two members read as before.
- A placement whose `end` comes before its start is an instant: the voice starts and ends at its
  start, shows nothing, and warns once outside production. Its `end` mark was reported ahead of
  its `start`, so a voice anchored after it started before it did, and with a `fade.out` it
  showed a whole fade from its start. An `end` that leaves less room than `fade.out` now
  shortens the fade to finish when asked, where the fade ran its whole length past it, and an
  `out` before the start is reported at the start, where its fade always began.
- A `to` or `push` that brings back a subject faded out of its voice is made at the frame of
  the call, as one for a subject never faded is. It was made at the subject's next read, so how
  far the motion had got depended on when the host next probed the subject.
- A handle `seek` on a pending voice holds: the voice starts on time, already at the sought
  position, and one freezing before shows that frame while it waits. The seek was taken from
  the moment of the call, and lost outright when an anchor or the mix's rate moved the start.
- A rate of 0, a negative rate, or a ramp set on a pending voice applies from its start, as a
  rate above 0 always did. At rate 0 the voice starts on time and holds its first frame, where
  it stopped its clock short of its start for good and never showed.

- A voice playing backward ends where it starts. When its clock runs back to 0, `played`
  resolves and it leaves over `fade.out`, showing its first frame through the fade, or holds
  that frame where it freezes before; its `coast`, `out`, and `end` marks are there. A voice at
  a rate below 0 showed nothing once past its start and never left the mix. A stateful patch
  steps once more to the moment its subject reached its start.
- A voice cued at a rate below 0 with no `seek` starts at its end, where it started at 0 and
  was over at once.
- A fade in counts from no earlier than its voice's start. A subject whose delay had already run
  out when the voice started (a negative `stagger`, or a seek made in the frame of the cue)
  came in with its fade partway or done.

### Added

- `seek` on a cue: where in itself the voice starts, in voice ms.
- A voice with no end cued backward, a loop for good or a patch with no duration, plays from 0
  into the pass before, with `setting.pass` and `setting.elapsed` below 0. It runs on the
  general path.
- `handle.ramp` through 0 eases a voice into reverse, or out of it.
- `@msb235/blits-tone`, a package in `packages/tone` that drives Tone.js from a mix on the audio
  clock. Its own changelog has what it does.

### Fixed

- `project(mix.now)` reads what `probe` does. It landed what the next sync would, so after a
  handle `seek` past a voice's end it showed the voice gone while the mix still showed its last
  frame, and after a fade it placed a voice anchored on the faded one a frame early.
- A read back of a voice that was pending counts each subject's origin from the controls the
  voice had then, not from where a later seek, rate, or anchor has since put it.

- A seek back inside `history.ms` plays the host's calls again when the mix's rate is above 1.
  The tape was let go of by mix time while its calls are stamped in host time, so at rate 2 a call
  made 250 ms of host time before a seek back was already gone and never played again.
- A voice taken out with a time already older than history reaches, such as `fade({ at })` given
  a moment long past, comes back for a seek or a read back to before that call. It was forgotten
  at the next sync, so `seek` and `project` to the frame before the call found no voice.
- A `HistoryStore` is told of every seek back through `cut`, as its doc says. It was told only
  when the seek read records from the store, so a mark announced with a past `at`, paged at once,
  stayed in the store after a seek back to before it was announced.
- A `color(last())` channel on a lane switches off when its voice's weight falls to 0, as it does
  off lanes. A lane left it on, so a weight coming back inside the band (0.4 to 0.6 by default)
  showed the color where a mix with `lanes: false` showed none.

- A span's children play from where the one before each ended, not from the frame that noticed
  it. Each child leaving fitted the rest again from the sync's time, so the next started up to a
  frame late and the rest sped up to make room: 200 children of 10 ms in a 2000 ms span, fitted
  with none skipped at cue, had 199 skipped once synced every 16 ms. A read ahead never fitted
  again, so `project` showed a child retimed by `faster` up to a frame ahead of the mix.

- A voice whose owner runs backward leaves over its `fade.out` from where it reached its start,
  as one turned back by its own handle does. An owner run back to its start left at once and
  took every voice it held with it, so a child with a 100 ms `fade.out` vanished in one frame
  and listed no `coast`, `out`, or `end` mark. An owner at its start now stays for what it
  holds and leaves with its last child.

- `setting.dt` is the gap since the subject was last sampled for a patch with no `step`, and for
  a weight signal, as its doc says. It was the time since the subject's origin, growing every
  frame: a mix synced at 16, 48, and 64 handed such a patch 16, 48, and 64, and now hands it 16,
  32, and 16.

## 0.8.1

### Fixed

- A frame under `history` costs what it did in 0.7.1 again. 0.8.0 added two costs to every frame:
  a sync shifted the whole list of frames history can reach to let go of the oldest, 7,200 of
  them at 60 fps under the default 120 s; and an object a voice gave a channel with no `rest` to
  fold into, such as `last<Row>()`, was copied for every subject on every frame. The frames now
  leave from the front without a shift, and such a channel's pose holds the patch's own object, as
  in 0.7.1; an array is still copied. astv's motion bench on one machine, mean µs a frame over
  two runs, 0.7.1, 0.8.0, then this: one window landing 6 text changes of 5 rows, 19.6, 28.8,
  19.5; its busy stage, 354.6, 402.2, 340.7; 10 flights a second, 6.4, 8.0, 6.6.

## 0.8.0

### Breaking

- `handle.seek(elapsed)` rebuilds each subject's state for the new position: fresh from the
  patch's `state`, with what signals keep started over, and stepped from the voice's start to
  `elapsed` at the next probe, on the `stepMs` grid where there is one. It left state where it was,
  so a spring seeked back to 0 read about 111 where a fresh one reads 0. `seek(elapsed, { state:
  'keep' })` keeps the old behavior. The same holds for an owner's seek and its children.
- A `keys` channel given a `delayBy` waits, then travels in the time left, landing with the other
  channels at the end of the duration, as klieg's own `delayBy` does. It shifted the phase without
  compressing it, so a channel waiting 200 ms of 1000 stopped 80% of the way there.
- In a `locus`, each channel folds at the summed weight of the members that write it, not the whole
  locus's. A channel only one member writes fades with that member rather than holding at full
  weight until it snaps to rest.
- `cue` refuses a `loop` that is not `true`, `false` or a whole number of passes; `spring` refuses
  a stiffness or mass that is not positive, or a negative damping; `glide` refuses an `ms` that is
  not positive. Each played wrongly: a fractional loop jumped at its end, and a spring with no
  stiffness snapped to its target.
- `sync(NaN)` throws. It slipped past the check that the clock only goes forward.
- A voice refuses a rate that is not finite and a weight that is NaN, at `cue` and on its handle.
  Both were accepted. A negative voice rate still is.
- `{ steps, jump: 'start' }` reads `1/n` at 0, as CSS does. It read 0.
- A history store's contract changed. `cut` takes the `seq` of the frame a seek went back to, not
  a mix time, and every `Paged` record carries the `seq` it was made in; keep one record per key
  and `seq`, since rate 0 lets several frames share a mix time. The transport pages its announced
  marks, rate changes and frames too, as `mark`, `pace` and `frame` records with `mix: ''`, and a
  `left` record's `data` is now `[record, sync]`. A store written for 0.7 forgets the wrong records
  on a seek back.
- `vec(3, sum())` is typed `Channel<[number, number, number]>`, a tuple of the length it was given,
  so a kit over a tuple pose needs no cast. A length that is not a literal still gives
  `Channel<number[]>`. Types only: code that calls such a channel's `merge`, `scale` or `lerp`
  itself with a `number[]` annotates the channel as `Channel<number[]>`.
- `probe(subject, out)` writes into the array `out` already holds for a `vec` channel, or a `color`
  that averages in OKLab or runs on a lane, where that array is the channel's length. It put a new
  array there on every probe. A host that kept `out.position` from one probe and compared it with
  the next now holds the same array both times: copy what has to outlast the next probe. A probe
  with no `out` still makes its own arrays.
- The deprecated names are removed. A voice's or an owner's `hold` is `freeze`, as since 0.6.0. A
  patch's `period` is `duration`: a hand-made patch that set only `period` now has no duration.
  `hex()` is gone, and `hex({ space: 'srgb' })` with it: `last<number>({ lerp: mixHex })` is the
  same channel for a color kept as 0xrrggbb, and `color(last(), { lerp: 'oklch' })` with `toHex`
  at write is the one that also runs with `color()`'s coverage. Nothing blends red, green and blue
  each on its own any more; a host that wants that gives `last` a `lerp` of its own.

### Added

- `angle({ turn })`, a channel for a rotation about one axis: it adds as `sum` does, and `lerp` and
  a weight below 1 go the short way round, so 350 to 10 passes 0. `turn` is one full turn in the
  channel's unit, default 360. It runs on lanes.
- `quat()`, a channel for a rotation in space as a unit quaternion `[x, y, z, w]`: contributions
  compose in cue order, and `lerp` and a weight take the short arc. It runs on lanes, through its
  own `fold`.
- `Vec<N>`, the tuple of `N` numbers a `vec` channel holds.
- `fold(kit, deltas, weights?)` folds deltas into one pose by a kit's arithmetic with no mix and no
  clock: what a mix gives for voices contributing those deltas at those weights, every weight 1
  where none is given.
- `project(time)` reads an earlier time on a mix made without `history`, where how the mix stands
  now says what it showed then: every voice plays as it was cued and reads by its clock alone (no
  state, motion, anchor or owner, no write to its handle, no channel without a rest at a weight
  that moves), the mix's rate was never set, and `time` is no earlier than the last cue, `drop`,
  `touch`, `announce` or `rebase`, or the last frame a voice left in. Anywhere else it throws and
  says which of those it met, where it threw for any time behind the mix. A host that cued its
  voices once need not build a second mix to read an earlier frame.
- `handle.to`, `handle.push` and `handle.read` reach the `to`, `push` and `read` of the motion
  patch a voice plays, so a host holding only the handle need not keep the patch or cast it. `to`
  and `push` throw for a voice whose patch does not take them; `read` gives undefined.
- `mix.touch(subject?)` says that something a patch reads from outside the mix changed since the
  last sync, so the next probe calls the patch again where it would have answered with what it
  read this frame: for one subject, or for all. A host need not move the clock to show the change.
- `input(read)` makes a signal of the host's own that reads something outside the clock. The host
  calls its `touch()` after each change, and a voice weighted by it keeps its lane, where one
  weighted by a signal flagged `input` by hand never runs on one. `input(read, of)` marks a signal
  built on others, an input where any of them is. `level` is `input` over one number.

- `@msb235/blits/testing`, for a library writing patches: `setting()` makes a `Setting` to call a
  patch outside a mix, and `checkPatch(patch, { subject, kit })` lists what a mix cannot rely on.
- `handle.seek` answers how sure the state it leaves is, as a `Doubt`: `exact`, `stepped` or
  `held`. `SeekOptions` is exported.
- `wave(duration, { shape, cycles, phase, depth, kit })` swings each numeric channel `depth` names
  up to `depth` either side of its rest in `kit` (0 without one), as a sine, triangle, saw, or
  square, `cycles` times a pass. It is an `fn` patch that keeps its options on `patch.wave` for an
  engine that reads data; `waveAt` is the unit wave.
- A `keys` patch carries the options it was given as fields: `ease`, `easeBy`, `delayBy` and
  `lerpBy`, beside `keys` and `kit`. They were kept in a table keyed by the patch object, so a copy
  such as `{ ...p, duration: 2000 }` lost its easing; a copy now plays by the fields it carries,
  and may change one.
- `Channel.copy`, for a channel whose `rest` is an object the mix cannot copy itself, such as a class
  instance, and that has `fold`; `cue` refuses such a channel without one. The mix copies arrays,
  typed arrays and plain objects itself.
- `npm run test:general` runs the suite with lanes off, so every test checks the general path
  against the lanes.

### Fixed

- A handle `seek` made in the frame its voice was cued in put every subject's origin before the
  voice began, so the fade in read as over at once, and under a fade out a subject first probed
  after the seek read a weight the others did not. The origin is now the cue's frame, as it is for
  a seek in any later frame.
- A rate above 0 set on a voice still pending applies from the voice's start. It was taken from
  the moment it was set, so the voice's clock passed 0 before the start: the voice then began
  partway in, and a subject it froze before played, and stepped its state, while the voice was
  still pending.
- `fade({ at: 'rest' })` begun after a subject's probe in the same frame finds that subject at rest
  at its next probe, where it stayed in the voice until the frame after.
- Seeking back many times no longer throws `Maximum call stack size exceeded`. Every `seek` to an
  earlier time wrapped each voice's records in another layer, kept for the life of the mix, so a
  scrubbed mix grew with every seek and a subject not probed since was found through all of them:
  20,000 seeks overflowed the stack. A voice now keeps one store however often the mix seeks. Two
  seeks back with no probe between could also read a wrong pose, as two fuzzer programs did.
- An anchor cued after its target had left waited for good, and kept the mix from coming to rest,
  unless the mix's history still reached the target. A mix now keeps the marks of the first and last
  voice to leave under each name, tag and channel, and an anchor no voice the mix still knows answers
  reads those, placing its voice as it would have while the target was there. It holds that much and
  no more, however many voices leave.
- A channel whose `rest` is an object or a typed array had it handed to `fold` by reference, so it
  accumulated across frames and every subject's pose shared it.
- `fade()` during a fade-in made the weight rise before it fell: the fade-in kept climbing under
  the fade-out. It now stops where the fade-out begins.
- A seek put a voice's controls back without its rise ramp, so a seek to before a later `rise()`
  read the voice at 0.
- A `from: 'current'` retarget under an easing that jumps or leaves vertically at its start
  (`steps` with `jump: 'start'`, `bezier [0,1,0,1]`) threw the value hundreds of thousands out. Such
  an easing now takes no slope bend.
- A channel with no `rest` stayed switched on across a weight of 0, so a weight going 0.7, 0, 0.5
  found it on at 0.5.
- `slew` and `lag` step by no more than `maxDt`, as `step` does. After a long gap a slew finished
  at once.
- A `keys` patch reads a channel whose stops are all plain numbers, lerped straight across, by a
  search and lerp of its own, giving the same bits: `patch.at` over 10,000 four-stop tracks takes
  about 0.70 of the time it did.
- Two copies of blits loaded together, as a library pinning its own copy brings, read each other's
  patches and channels: a `keys` patch one copy made kept its easing on the other's mix, which read
  it linear, and the facts a stock channel carries for lanes are shared too.
- Under `history`, a read back to a frame in which the host changed a voice between the sync and
  the first probe shows the change in that frame, as the live probe did. It showed from the next
  frame.
- A subject's fade-in start and step origin came from its voice's rate and anchor as they stood at
  the subject's first probe, so a rate change, ramp or handle seek before then moved them and the
  numbers depended on when the host had looked. Every voice now keeps the clocks it ran on, and a
  subject's origin is when its voice's clock first read the subject's delay. A stateful subject met
  late steps from that origin, capped by `maxDt`, where it started stepping from first sight. A
  read ahead no longer loses a stateful voice whose anchored start falls inside it.
- A seek or read back was keyed on mix time, which rate 0, a backdated `fade({ at })` and several
  handle calls in one frame can all share, so it could restore the wrong moment or drop a voice
  whose fade was backdated. The transport now numbers its frames, history entries carry the frame
  they were made in, and a seek or read to mix time `t` lands on the last frame at or before `t`.
  The tape stamps calls by host time, so frames rate 0 holds at one mix time stay apart.
- A frame that passed both a voice's start and the `fade({ at })` set for it began the fade a frame
  late, so 16 ms and 32 ms frames disagreed.
- With a history store, the transport kept every announced mark, rate change and frame for good, and
  a long run slowed quadratically: 20,000 frames took 19.8 s, against 0.17 s now.
- Lanes and the general path disagreed in three places. A `level` set between two probes in one
  frame now reaches the next probe on lanes too; `inert` reads the same for a motion voice at weight
  0, which lanes kept awake until it landed; and `project` reads a subject faded out of a voice as
  out of it after a retarget or a `drop` brought it back, on both paths. A voice weighted by an input
  signal not built on `level`, or whose patch reads host fields, never runs on a lane, since a
  change to either between two probes would not reach it.
- A span that skipped several children at cue played the last of them in full on the next sync, and
  then reported none skipped.
- A pose read NaN for a voice still waiting on a `start` the host gave, once the voice was set to
  rate 0 while the mix's rate was 0. It reads as any voice before its start does.
- A frame allocates much less, which is most of what made the garbage collector run during one. A
  probe into `out` reuses its arrays, a motion voice off lanes reuses its last delta, and a fill
  no longer boxes a number per subject. `bench/frame.mjs`, 10,000 subjects probed into one `out`:
  three `keys` voices went from 1.8 MB a frame to 0.16 MB and take 0.81 of the time; a `tween`
  voice from 0.72 MB to 0.02 MB, 0.90 of the time; a `tween` voice with lanes off from 2.6 MB to
  0.32 MB, 0.82 of the time.
- Cueing a voice over every subject costs much less. A voice with no `subjects`, `target`,
  `stagger` or signal weight, whose patch keeps no state, kept a record for each subject probed;
  it keeps one for them all, and a read ahead copies that one. `bench/frame.mjs`, 10,000 subjects
  each under a `tween` voice of its own, with a voice over all of them replaced every frame: 9.3 MB
  a frame to 2.7 MB, in 0.74 of the time. A read 500 ms ahead of 1,000 subjects under three voices,
  made and probed every frame: 2.4 MB to 1.5 MB, in 0.80 of the time. A mix made with
  `lanes: false`, or with `history`, keeps a record for each subject as before.
- Under `history`, dropping subjects and reading them back each took time that grew with the square
  of how many had left: every drop went through every record its voice had kept, and so did every
  read back. 8,000 subjects dropped in one frame took 173 ms and take 7; reading them back took 180
  ms and takes 3 (`bench/drops.mjs`).

## 0.7.1

### Fixed

- Under `history`, a mix whose subjects come and go no longer slows as the voices that have left
  pile up. `drop` and a freed slot visit only the voices that left that can hold the subject,
  history lets go of them from the front of the list, and the tape is pruned a second at a time
  rather than every sync. A 200-subject roster replacing 4 subjects a frame climbed to about 1.2 ms
  a frame as 14,000 voices that had left built up; it now holds at about 0.065 ms.
- An anchor naming a score reads only the voices on that score, and only in the mixes on the
  transport that hold one; it reads each voice that has left once rather than every frame, and
  picks in one pass instead of sorting. astv's busy stage, whose rail waits on the latest `coast`
  of its motion score, takes about 0.45 ms a frame in astv's motion bench, against 4.3 ms on 0.7.0.
  With 200 mixes on scores of their own beside it, a frame's sync takes about 14 µs, against 21
  before the transport listed the mixes holding each score (Node, medians of six alternated runs).

## 0.7.0

### Breaking

- With lanes on, a stateless patch's `send` from `at` sends only for subjects probed this frame
  or in the last frame with a probe, where it sent for every subject the lane had met.
- A `keys` patch's stops are not read for a subject its voice gives no weight, as `at` already
  was not, unless the voice is fading to rest or is in a locus. A `lerp` or `lerpBy` that counted
  its calls no longer sees those frames. A `from: 'current'` voice still takes its base on its
  first read.
- `sync` throws for a timestamp earlier than the last sync's, short of a `rebase`. It used to take
  one and half work: stateless voices moved back while a stateful patch without `stepMs` was handed
  a negative `dt`. A host moving the mix calls `seek`.
- `project` takes mix time, not the host's timestamp. The two differ only on a mix with its own
  rate or one that was rebased, where `project(mix.now - 300)` reads 300 ms of mix time back.
- `Mix` has `seek`, `now` and `tape`, which an engine of its own has to provide.
- `Mix` has `span`, which an engine of its own has to provide.
- `Mark` has a fifth value, `coast`, so a `switch` over it that checks every case needs one more.
- `project` ahead of the mix after a `seek` back throws for a time past a call the tape will make
  again, which it used to leave out; a seek there makes it.
- An engine of its own is handed `MixOptions.transport` and `name`, and a `Mix` that can share a
  transport has to keep its clock there.
- `Mix` and `Transport` have `prepare`, which an engine of its own has to provide.

### Added

- `transport(opts)` makes one clock several mixes share, each over its own kit, by passing it as
  `MixOptions.transport` with a `name`. `sync`, `rebase`, `rate`, `ramp` and `seek` on the
  transport move every mix on it, and a mix's own throw. A query naming a `score` looks in every
  mix on the transport, so an anchor in one mix waits on a voice in another; one naming no score
  stays in its own mix. The transport has `announce` (on a named score), `marks`, `project(time)`
  with `.of(mix)`, `live`, `inert`, `onWake` and `drop(mix)`. One tape records every mix's calls
  and a seek replays them in the order they were made; under history a seek back before a `drop`
  puts the mix back. `Marked.mix` names the mix a mark came from, and voice ids are unique across a
  transport. A mix made alone has a transport of its own, so nothing changes for it.
- `fade({ at, over })` with `at` a mix time begins the fade exactly there: ahead, the voice plays
  untouched until then with its `out` and `end` fixed from the call, and `rise` before then takes it
  back with nothing changed; at or behind now, the fade began then and is partway. It wins over an
  anchored `out`.
- A voice **coasts** when its last pass ends, for its latest-staggered subject: the moment
  `played` resolves true. `coast` is a mark like the other four, listed by `marks`, booked by
  `book`, read ahead by `project`, and waited on with `{ of, mark: 'coast' }`. It falls with `out`
  on a voice that does not freeze, and where a frozen voice starts showing its last frame, which
  has no `out` until it is faded. An owner coasts with its last child, a span where its fit ends. A
  voice that loops for good, or fades before its last pass ends, never coasts.
- `color()`, a channel holding color as OKLab `[L, a, b, coverage]` with its merge rule as a
  parameter. `color()` averages: voices stack as a premultiplied sum, so it runs on lanes, and the
  pose carries the summed weight as coverage. `color(last())` replaces. `{ lerp: 'oklch' }`
  interpolates round the hue instead of across OKLab, off lanes. `oklab(0xrrggbb)` makes a value;
  `toHex(pose, under)` lays a pose over the subject's own color and `css(pose)` writes an
  `oklab()` string with the coverage as alpha. `color(last())` runs on lanes too, the last voice
  past the band winning, unless a voice writing it is a motion, sits in a locus or names one
  subject. `hex` still works, but it is deprecated for
  `color(last(), { lerp: 'oklch' })`, which replaces and interpolates as it does, and a later
  release removes it.
- `mix.span(spec)` cues an owner that lays out the voices it holds in an `order` (`queue`,
  `stagger`, `together`) and fits them into its `duration`, again whenever one joins or leaves.
  Each child says how it may give way with `faster`, `slower`, `overlap`, `ballast` and `priority`. The
  span first retimes its children by one factor toward the budget, faster where they run past it
  and slower where they leave room, each as far as its hints allow; then its `fit` decides the
  rest: `condense`, `shed`, `conclude` and `overrun` are exported, `pipe` runs several in turn,
  and `lax` is every one with `overrun` last.
  Where nothing fits, `spill: 'instant'` jumps the weaker children to their end at once and
  `'overrun'` lets the span run long. A span with a budget stays until it has passed, so late
  children can join, and `handle.result` says how the last fit came out.
- `ticker().wake()` asks for a frame. A mix changed before `stop` and not synced since fires
  `onWake` no more, so nothing else starts the loop again; `add` asks for a frame too, as it
  always did, now documented.
- An anchor can wait on several: `{ all: [...] }` answers the latest of them and `{ any: [...] }`
  the earliest, and both nest.
- `handle.rise({ over })` turns a fade out around: the voice climbs back from where its fade had
  got to, up the same curve, and plays on as if never faded, so a host can take back a leave
  without the jump a fresh fade in from 0 makes. It is recorded, so history and `seek` replay it.
  A fade waiting for rest is taken back at once; a voice not fading is left as it is.
- `mix.seek(time)` moves the live mix to a mix time and plays on from there, under `history` with
  a `tape`. `history.tape` takes weasel-history's `createHistory` (`@weasel-js/history`), or
  anything of the `Tape` shape, and the mix records every call the host makes on it, its handles
  and its spring and glide patches. Back, the mix restores itself as it stood at the end of that
  frame: voices that left since return on the handles the host holds, with `done` and `played`
  starting over, and voices cued since wait `pending` on theirs. Forward, by a sync or a later
  seek, the recorded calls play again at the mix times they were made. A call made while recorded
  calls lie ahead starts a branch, and the tape keeps the old future: `mix.tape.branches()` lists
  them and `switchBranch` picks one. State steps once from the nearest copy history kept, exact
  under `stepMs`. Playing past a time again sends its events and books its marks and hits again.
  The host keeps passing its own clock.
- `mix.now` reads the mix clock, which `seek` and `project` take.
- `history.store` pages out what `history.ms` would drop, as plain data, so `ms` bounds memory
  rather than how far back a seek reaches. `store.page` takes records leaving memory,
  `store.load(t)` gives back what a restore to `t` needs, and `store.cut(t)` forgets what a seek
  back left behind. `transport.prepare(t)` (and `mix.prepare` for a mix alone) loads before a seek
  or read past memory; without it, it throws `HistoryMiss` before anything moves. Object subjects
  need `MixOptions.keyOf`, a patch with `state` or `step` needs `pack` and `unpack` (which `patch`
  now takes), and every mix on a transport with a store needs a unique `name`. A voice cued with
  `as: { kind, data }` leaves memory once it has left and history no longer reaches its end, and
  `history.revive` builds its spec again when a seek needs it, behind the handle the host holds.
  With a store, blits never prunes the tape; the host bounds it. Without one, nothing changes.

### Fixed

- A lane fills only the subjects probed this frame or in the last frame with a probe, not every
  subject it has met; one probed in neither takes the general path if it is probed before the next
  fill. Three `keys` voices over 10k subjects, every subject probed once and then 40% each frame
  (`view`), take 0.561 ms a frame against 0.878. No other row moves past its run-to-run spread:
  `signal` and `named` at 10k read 1.06 and 1.09 here and 0.96 and 0.91 in a run against the
  build before (teitou, medians of six alternated runs, each in its own process).
- A second `seek` or `project` back no longer reaches into time the first one's history had
  already let go of, where it read wrong values: after seeking back to 1600 under `ms: 500` from
  2000, a seek to 1200 read 0 where the mix had shown 90. It throws as a read older than history
  does.
- Under `history`, a subject faded out of a voice or dropped after the moment a `seek` or a
  `project` reads back to comes back with the record it had, and with a motion patch's state for
  it. It used to come back as never seen, its state started afresh.
- `project` across a `rebase` reads the moment the host saw: it converted a host timestamp with
  the offset in force now, so a 1000 ms rise synced at 0 and 200, rebased and synced at 10200 read
  0 at 200, where the host had seen 20. Taking mix time, it reads 20.

- A probe and `atRest` no longer allocate on the heap to find a subject's voices. Each passed the
  mix's clock, a fractional number, to a function too large for V8 to inline, which stores such a
  number on the heap to pass it; and the function that links a subject's voices made a closure
  context on every call, though only relinking uses one. Collections over 5000 frames of 10k
  subjects fall from 666 to 375 with a probe and `atRest` of each (`probed`), 279 to 121 with
  `atRest` alone (`rest`), 428 to 285 with a voice per subject (`named`), and 741 to 524 with three
  `fn` voices over every subject (`fn`). A frame takes 0.857 ms against 0.885 for `rest`, 1.263
  against 1.325 for `named`, and 2.074 against 2.156 for `fn`; `probed`, at 1.507 against 1.504,
  and the rows read by `pull` are unchanged (teitou, medians of twelve alternated runs).
- A fill no longer stamps every subject: the lanes keep which fill ran a lane, and a subject is
  stamped only when it is left to the general path. A spring is solved by a function per kind of
  spring, small enough for V8 to inline where it samples, where one function over all four left
  spring fills running at one of two speeds. At 10k subjects, a frame takes 0.438 ms against 0.473
  with a spring voice read by `pull` (`spring^`), 0.411 against 0.463 with a spring voice per
  subject (`springs^`), 0.937 against 0.996 and 0.884 against 0.935 for the same by `probe`,
  0.306 against 0.319 with one subject replaced each frame (`turnover^`), 0.226 against 0.233 with
  one voice replaced each frame (`churn^`), and 0.167 against 0.170 with a tween voice per subject
  (`tweens^`); a probe and `atRest` of every subject (`probed`) is unchanged, 1.497 against 1.504
  (teitou, medians of eight alternated runs, twelve for `probed`).

## 0.6.0

### Breaking

- A voice's `hold` is `freeze`, SMIL's name for it, and a voice frozen after its passes is in state
  `'frozen'`, not `'held'`: a host comparing `handle.state` to `'held'` must compare to `'frozen'`.
  `hold` is still taken on a voice and an owner where `freeze` is not set, but it is deprecated and
  a later release removes it; where both are set, `freeze` wins. `assess` still says `'held'` for a
  channel whose input is not known, which is another thing.

### Added

- `ticker()`, one frame loop for any number of mixes: `add(mix)` syncs it every frame, `after(fn)`
  runs once the mixes have synced, and `hold()` keeps the loop awake. It runs on animation frames, or on a
  timer where there are none, as in a worker or Node, or with `grain: 'timer'`; `fps` caps the rate on
  a grid, so a 60 Hz display capped at 30 runs every other frame. It sleeps while every mix is
  `inert` and wakes on a mix's `onWake`. A mix or callback that throws stops neither the loop nor the
  others; the error is thrown again on a microtask.
- `mix.onWake(fn)`: called when a host call makes the mix need frames again after a sync — a cue,
  a fade, a rate, a seek, a `drop`, a motion retargeted — once until the next sync, and never
  during one. A host's loop sleeping on `inert` wakes on it instead of on every path that cues.

### Fixed

- `slew` and `lag` given `from` start a subject on their input when `dt` is infinite, as under
  reduced motion, rather than showing `from` for its first frame and snapping on the next.

## 0.5.0

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
- `keys` copies each stop's array when it is made, so editing an array after passing it to `keys`
  changes nothing; it showed on the general path and on a lane, and a crowd row now keeps its own
  copy of the numbers. Make a new patch to change its stops.

- A spring, glide or tween refuses a value of the wrong kind for its channel: an array on a channel
  holding a number, or a number on one holding an array. A value every subject shares is refused at
  `cue`, and one given per subject on that subject's first sample. A one-element array on a number
  channel used to play as its number, through a fold about 5× slower (1.2 ms a frame at 10k subjects
  against 0.24, on teitou); a number on an array channel played as the channel's rest.

- `atRest` after a probe of the subject in the same frame answers for the pose that probe gave,
  rather than folding the subject again: a weight reading host input that moved between the two no
  longer changes the answer. With lanes off, a probe then `atRest` of 10k subjects under two voices
  (`probed-`) takes 2.64–2.71 ms a frame against 3.80–3.87 (teitou, three alternated runs); a mix
  that never asks `atRest` reads as before.

### Added

- A mix's host has a type: `mix<I, O, H>` types its `host` option, and every patch, signal and
  setting it plays reads `setting.host` as `H`, without a cast. `Setting`, `Patch`, `PatchOptions`,
  `Signal`, `VoiceSpec`, `MixOptions` and `Mix` take `H` as their last type parameter, `unknown` by
  default, and the stock signals carry it through.
- `slew` and `lag` take `from`: where a subject starts the first time they see it, in place of on
  their input, so a follower can climb from rest.
- `mix.voices(tag?)`: a handle on every voice still in the mix, pending, live, held or fading, in
  cue order, or only those whose `tags` carry `tag`. A host no longer has to keep every handle `cue`
  returned to know what is playing. Each handle listed is the one `cue` returned for that voice, so
  it compares `===` with it.
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
- Owners, for placing, timing and fading voices as one: `mix.owns(spec)` cues a voice with no
  patch, and a voice cued with `owner: handle` plays under it. A child's `start` and anchors count
  on the owner's clock, in ms from its start, and a bare name in its anchors means a sibling. The
  owner's `rate`, `ramp` and `seek` move every child's clock with its own, leaving their state where
  it is; its `weight`, a number or a signal, and its `fade` multiply into each child's weight per
  subject; a child with no `hold` takes the owner's. The owner is `played` once every child has
  finished its passes and leaves with its last child, and its fade ending takes them all. Owners
  nest, `handle.owner` names a child's owner, and `marks`, hits, `history` and `project` all read
  through the chain of owner clocks. An owner refuses `loop`. A mix with no owner costs what it
  did: every row timed (`fn`, `keys`, `signal`, `blend`, `named`, `spring`, `tweens^`, `churn^`,
  `weasel^`, `swap`, `sparse`) overlaps `995cd97`'s range over four alternated runs on teitou, each
  row in a process of its own.

### Fixed

- `pull` queues the subjects it reads from the lanes as runs, a first subject and a count, rather
  than one by one, and writes each run into its arrays as a block. Its loop over the subjects no
  longer shares a function with its tail: compiled while the first long list was read, `pull`
  deoptimized at its tail on every frame a voice came or went. At 10k subjects, a frame takes
  0.167–0.180 ms against 0.228–0.235 with a tween voice per subject (`tweens^`), 0.218–0.227
  against 0.269–0.278 over one voice (`weasel^`), 0.218–0.234 against 0.291–0.307 with one voice
  replaced each frame (`churn^`), and 0.308–0.314 against 0.330–0.344 with one subject replaced
  each frame (`turnover^`) (teitou, eight alternated runs).

- A fill samples a tween on a lane or in a crowd and folds it in one loop, calling its closed form
  and the channel's fold directly, and keeps no copy of the sample: one is worked out again from
  the tween's stretch when a probe later in the frame needs it. The steady frame no longer
  allocates 16 B a subject (8 B over one voice). At 10k subjects read by `pull`, a frame takes
  0.225–0.234 ms against 0.321–0.327 with a tween voice per subject (`tweens^`), 0.269–0.280
  against 0.350–0.357 with one voice over all of them (`weasel^`), 0.295–0.308 against
  0.373–0.404 with one voice replaced each frame (`churn^`), and 0.324–0.337 against 0.397–0.468
  with one subject replaced each frame (`turnover^`) (teitou, eight alternated runs).

- A voice retiring no longer has the mix read every voice it holds to take it out of the list: up
  to 8 a frame are found by their id. At 10k voices with one leaving each frame (`turnover^`), a
  frame takes 0.407–0.416 ms against 0.427–0.436 (teitou, three alternated runs).

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
- A voice over every subject keeps the subjects its `target` turned away as a bit by the number
  lanes give each, where it kept a map entry for each: memory no longer grows with voices times
  subjects. 1000 voices each picking one of 1000 subjects by `target` hold 4.6 KB a voice after
  their first frame, from 37.1, and over 3000 subjects 4.2 KB, from 135; that first frame takes
  35–38 ms on teitou, from 72–79, and later frames are unchanged (`bench/memory.mjs`, row `own`).
  With `lanes: false` the answers are kept in a map as before.
- A crowd's `keys` rows read their stops from one array the crowd keeps, copied as each row
  joins, rather than through each row's voice, tracks and stop arrays: 10k `keys` voices of one
  subject each read by `pull` take 0.34–0.36 ms a frame on teitou, from 0.66–1.02, and by probe
  0.81–0.83, from 1.00–1.37. A row whose stops are not plain numbers on its channel's axes reads
  them as before.
- A `keys` patch keeps its stops' phases in a plain array made with it, and those of the stops after
  phase 0 only once a `from: 'current'` voice first reads them, where it made a typed array of
  each as it was built: making and cueing 10k one-subject `keys` voices takes 10.9–11.9 ms on
  teitou, from 13.9–14.8, with their first frame and later frames unchanged.
- A projection copies each voice into an object V8 keeps in fast mode, where the copy was a
  dictionary that every read of it looked up by name: a projection made and probed every frame
  takes 0.57–0.58 ms ahead and 0.74–0.87 back on teitou, from 0.81–0.84 and 0.95–1.09 (`ahead` and
  `back`, 1000 subjects under three voices, four alternated runs).
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
- A crowd voice that starts or begins fading in the same frame as a voice whose change needs the
  lanes qualified again plays on them. Taking the frame's changes one at a time stopped at the
  first that needs a qualify, such as a locus member off the lanes starting, and the qualify that
  followed never heard of the rest: a voice on one subject starting at 50 ms beside a glide in a
  locus starting then read nothing on the lanes for good.
- A paused mix asks a weight signal again at each sync, on lanes and for a blend, as the general
  path already asked a plain voice's. A sync that moved host time while the mix clock stood still
  was not a new frame: a laned voice kept the weight its lanes were last filled with, and a blend
  the reading it took before, so a signal the host set while paused, such as a `level`, changed
  nothing until the mix ran again. A paused mix on lanes now fills them each frame, as a running
  one does.
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
