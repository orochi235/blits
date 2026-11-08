# What a blits driver has to handle

**For:** anyone writing or maintaining a driver, a package that turns what a blits mix plays into
something outside it (`packages/quarks` for particles, `packages/tone` for audio, `packages/rapier`
for physics). **Answers:** what a driver has to get right that blits does not do for it. Every rule
here was learned from a bug in a driver; the last column says which, so a rule can be checked
against the case that taught it. When a driver breaks a rule, fix the driver or say in its README
that it does not handle that case.

## Clock

| Rule | Learned from |
|---|---|
| **Don't own the clock.** Take a mix the host made and synced. A driver that must make its own mix also works when that mix is on a shared `transport`, where the host syncs the transport and the mix's own `sync` throws. | rapier threw on a transport until `sim.step()` (2026-11-03) |
| **Keep time as mix time** (`mix.now`), never the host's timestamp, for anything logged or scheduled. They part at the first seek, `rebase` or rate other than 1. | rapier logged pushes at host time (fixed 2026-11-03) |
| **Work at any `rate`**: other than 1, ramping, and 0, and across `rebase` after a hidden tab. Convert between host and mix time through `mix.time` and `mix.when`, which follow a ramp. Output owed per mix time is owed by `mix.played` since the last write. Whatever the host advances on its own clock, as three.quarks' `batch.update`, is advanced by mix time too. | tone's curves drifted 3.6 Hz during a ramp; quarks emitted too few particles while the rate ramped down, and its README example moved particles at full speed on a paused mix |
| **Decide what a long frame does** (two seconds after a tab comes back): catch up, clamp to the mix's `maxDt`, or drop. Say which. `mix.played` counts each sync up to `maxDt`. | quarks emitted a long frame's whole gap past `maxDt` (fixed by `mix.played`, 2026-11-03) |

## Seek and history

| Rule | Learned from |
|---|---|
| **Hear every seek** with `mix.onSeek`, which fires once each seek has landed, paused or not, with the mix time, the last frame kept and whether it went back. Don't work one out from `seq`, timestamps or `project`: several seeks can land between frames. | rapier guessed from `seq` and `project({ frame: seq - 1 })`, and missed seeks while paused (fixed 2026-11-04) |
| **Say what a seek does to output already sent**: particles alive, audio scheduled, bodies in flight. Whatever state the driver holds is restored or rebuilt to match the time sought. A seek is not a frame: tell them apart by `onSeek`, or by `mix.played`, which a seek leaves alone, never by comparing mix time with host time. A driver that reads ahead cannot take back what it already scheduled into a hidden tab's gap. | rapier's replay; tone's `cancel`; quarks lost the frame after a seek back |
| **Log host input read each frame.** A seek's catch-up reads the host as it is now, not as it was, so input the driver reads from the host has to be kept by mix time and replayed. On a seek back, cut what was logged after `onSeek`'s `frame`, unless a seek forward needs it, as rapier's pushes ahead. | rapier's log of pushes; rapier replayed one frame's push over a seek forward (fixed 2026-11-03) |
| **Put the driver's own calls on the tape** with `mix.call`, where they change what it puts out: the mix makes them again wherever it makes the host's, and a host call after a seek back, a `cue` included, leaves them behind with the mix's calls ahead, until `tape.switchBranch` brings them back. Cut what they logged after `frame` on a seek back, and the tape makes it again. | rapier kept its own log of `impulse` and `drop`, which a `cue` after a seek did not cut and `switchBranch` did not bring back (fixed 2026-11-04) |
| **Show a seek at once.** What the driver shows reflects the time sought as soon as the seek lands, so scrubbing a paused page moves it: `onSeek` says when. | rapier showed the old world until the next frame (fixed 2026-11-03) |
| **Catch up before letting go.** After a seek the driver's state can stand far behind the mix, and the next read steps through the whole stretch: prune or page what that stretch reads only after it has. | rapier paged its pushes before the world stepped through them, so a seek forward after a seek back past memory replayed with the wrong ones (fixed 2026-11-04) |
| **Page to a history `store`**: state packs to plain data, and any log of the driver's own pages through the store and comes back on `prepare`, including through a transport's store. | rapier (2026-11-03, twice) |
| **Bound every list** that grows per frame or per write: prune it to what history can reach, or page it. | rapier's log of pushes; the engine's `Voice.earlier` |

## Reading

| Rule | Learned from |
|---|---|
| **Don't assume a subject was probed.** Lanes fill only subjects probed this frame or the last, and a read ahead (`project`, `trace`) has to see changes on subjects nothing read. | tone missed an untimed retarget (fixed in engine 0.19.0); the panel's pick missed subjects read only through `pull` |
| **A read at another time cannot see the driver's state.** `project` and `trace` fold each subject alone, and a patch reads no other subject, so a pose that comes from the driver's state, as a body's from rapier's world, shows that state as the last sync or seek left it. This is a limit of the engine's design, not a driver bug: say so in the README. | rapier's bodies in `project` and `trace` (2026-11-04) |
| **Know what weight 0 and an ended voice do to the channels read.** A channel scaled by weight goes to 0, and a patch's `at` is skipped at weight 0. Input that has to outlast the weight comes from the host, not a channel. | magicsmoke's fizz follows its level after the weight drops, hence quarks' `attach` `rate` |

## Exactness

| Rule | Learned from |
|---|---|
| **Turn rates into whole counts exactly**, with no slack and no drift from summing floats. A host moving its own float loop onto the driver may ask for that loop's rounding instead, as quarks' `carry: 'float'` gives it, at the cost of emitting the same across a `rebase`. | quarks' carry, twice; magicsmoke's fizz (2026-11-04) |
| **Keep the order of draws from a shared random stream** when output must repeat. | magicsmoke interleaves each fault's fizz with its discharges |
| **Treat a time within rounding of a scheduled point as that point.** | tone lost the line into a point a microsecond away |
| **Get angle units right**: an `angle` channel's `turn` is 360 unless set. | rapier's 2D `rotation` blended radians the long way round |

## Lifecycle and packaging

| Rule | Learned from |
|---|---|
| **Releasing lets go of everything wired**: `detach`, `cancel` and `drop` leave nothing a replacement driver cannot wire again. | tone's `cancel`, and its `detach` (fixed 2026-11-03) |
| **Calls on the driver are not on the tape unless it puts them there.** Wiring, attaching and `burst` are the host's, and a seek does not undo or replay them; say so, or put what must replay on the tape with `mix.call`, or route it through the mix (an event a patch `send`s). | tone's wiring; quarks' `burst` |
| **Several drivers on one mix share its drains.** A drain takes every event under its tag, so a driver draining a shared tag hands on what belongs to another. | quarks lost another driver's bursts (fixed 2026-11-03) |
| **A late subscriber gets the current state**, not only changes after it subscribes. | the panel after a reload |
| **Peer range and pin**: take the engine's major from the oldest minor whose API the driver uses (`^1.1.0` for one calling `mix.onSeek`), widen the range at each new major, pin the engine to build and test against, and work with two copies of blits loaded. | every release |
| **Name the mixes the driver makes**, so the debug panel lists them, and **keep the history a debugger gives** (`watched().history`) a mix made with none. | the site's demos; rapier's mix was unnamed and logged one frame of pushes under the panel's history (fixed 2026-11-03) |

## What `checkDriver` checks

`checkDriver`, in `@msb235/blits/testing`, plays a scene the driver's own tests give and returns a
sentence per problem: `expect(checkDriver(scene)).toEqual([])`. It checks that the driver puts out
the same alone and on a shared transport, nothing new while paused, the same across a `rebase` over
a hidden tab, the same after a seek back and on for a driver whose output follows the mix
(`restores: true`), and after a seek back and on again with no frame between, and that what it
keeps (`size`) stops growing. A run that gives `call`, a call the host makes on the driver once, is
checked to have it made again past a seek back, left behind by a host call after the seek, and
brought back by `switchBranch`. It cannot say what a long frame
should put out, or what a seek owes a driver whose output stays once sent, since both are the
driver's to decide: those rules stay in the driver's own tests. `packages/quarks/test/conformance.test.ts`,
`packages/tone/test/conformance.test.ts`, and `packages/rapier/test/conformance.test.ts` are scenes to copy.

