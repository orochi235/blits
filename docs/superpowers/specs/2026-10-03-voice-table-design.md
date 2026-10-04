# Many voices, laid out for memory

**Status: design, not built** (2026-10-03). For Mike, to approve before any of it is built, and for
whoever builds it. It answers: how blits keeps a frame cheap when a host runs a voice per node, at
10k voices and at 100k.

## The problem, measured

`bench/split.mjs` on teitou splits a frame of N tween voices of one subject each against one tween
voice over N subjects. Reading back costs the same either way. The fill does not, and `sync` grows:

| N | fill, a voice per subject | fill, one voice | extra per voice | `sync`, a voice per subject |
|---|---|---|---|---|
| 1k | 0.042 ms | 0.024 ms | 18 ns | 0.005 ms |
| 10k | 0.70 ms | 0.22 ms | 48 ns | 0.077 ms |
| 100k | 24.8 ms | 2.2 ms | 226 ns | 2.8 ms |

The extra cost per voice grows with N, so it is memory, not instructions: each voice is a `Voice`,
a `Lane` with its own arrays, and a motion patch's own `Motions` buffer, all scattered across the
heap, and a fill touches every one. `sync` walks every voice the same way, and then walks them all
again to prune the finished ones, splicing each out of an array.

A motion patch belongs to one voice, so the handoff's earlier plan, grouping voices that share a
patch, does not apply to the case that matters.

## Goal

At 10k and at 100k single-subject motion voices, a fill within 1.5× of one voice over the same
subjects, and a `sync` whose cost follows what is due that frame rather than how many voices
exist. No public API changes, and the one copy of the closed forms stays the one copy.

## Design

Three pieces, built and measured in this order; each stands alone.

### 1. `sync` by what is due

Each voice gets one number, **due**: the earliest mix time at which `moveTo` would change it — its
start, its anchored out, the end of its last pass, the end of a fade, or the end of a subject's own
ramp out. A binary heap keyed by due holds the live voices. `moveTo` pops only voices due by `now`,
runs today's per-voice logic on them unchanged, and pushes each back with its new due.

- A handle change that can move a voice's due — `rate`, `ramp`, `seek`, `fade`, an anchor being
  placed — recomputes it. They already all pass through `noted`, `beginFade`, `fadeSubject` or
  `place`, so the heap is updated there and nowhere else.
- During a rate ramp the end of the last pass is not a simple division, so a ramping voice is due
  every frame until its ramp ends. Ramps are short and rare.
- `opened`, which `moveTo` stamps on a voice's first frame, is stamped at cue time once the mix has
  a clock, and on the first sync otherwise.
- Finished voices are removed by swapping with the last element instead of `splice`, with
  `voices` order kept where the fold depends on it (voice order inside a chain is by id, which
  `chain` already sorts by).
- A projection keeps today's full walk: it copies a few voices once, and correctness there is
  worth more than speed.

### 2. A table of hot voice numbers

The numbers a fill reads for every voice each frame — clock anchor (`anchorNow`, `anchorElapsed`),
`rate`, `weight`, whether it has a fade in, out or rate ramp, its state — are mirrored into one
`Float64Array`, a row per live voice, written where those fields are written today (the same
places that call `noted` and `lanes.refill`). `Voice` objects stay the source of truth and the
public handle; the table is a cache the fill reads instead of the object. A voice with a ramp, a
fade or subject ramps under way is flagged in its row, and the fill reads that voice's object
as today.

### 3. One lane for single-subject motion voices

Every motion voice that reaches exactly one subject (named by `subjects`, or met once) moves off
its own `Lane` onto one shared **solo-motion lane**. Its entries sit in flat arrays, one row per
voice: the voice's table row, the subject's slot, the per-subject numbers a `Lane` keeps today
(delay, since, weight, probed weight, sample bookkeeping, first-call flag), and a **copy of the
voice's current stretch**: release time, seconds, and `x0`, `v0`, `to` per axis.

- The copy is pushed, not polled. `Motions.write` — the one place a stretch is replaced — calls a
  hook the mix sets at cue, as `frame` and `revive` are set today, and the hook rewrites that
  entry's copy. A subject with a change pending or an earlier stretch kept is flagged, and takes
  today's path, as `runMotion` already does.
- The fill loop reads only the shared lane's arrays and the voice table, and calls the existing
  `evaluate` with the lane's buffer and offsets in place of `Motions.runs`. Same closed form, same
  bits, one copy.
- `weightOf`, `settle`, sample-to-delta and the idle and pacing rules work per entry as they do
  per lane today, reading the shared lane's arrays. `meet` adds an entry; `part`, `drop` and retire
  remove one by swapping in the last.
- A voice that stops qualifying — gains a second subject, keeps state, takes a weight signal —
  leaves for a lane of its own, as voices leave lanes today.

## Testing

- `test/lanes.test.ts`'s `agree` harness already plays every scenario with lanes off and on, read
  by `probe` and by `pull`, and compares every channel, `weightOf` and `atRest` bit for bit. Its
  scenarios gain voice-per-subject versions of each: springs and tweens per subject, with fades,
  subject fades, retargets mid-flight, `seek`, rate ramps, `hold`, voices added and finishing mid
  run, and sparse probing.
- `sync` by due: a test that plays the same mix stepping every frame and stepping at uneven gaps,
  and compares every voice's state and marks after each sync with today's full walk, kept behind a
  test-only switch for exactly this.
- `bench/split.mjs` and `bench/frame.mjs` (`springs`, `tweens`, a new 100k row), A/B against `main`
  on the fleet after each piece.

## What it costs

- Two caches (the voice table and the stretch copies) that must be written everywhere their
  sources are. The hooks above are the only writers; a test asserts the copies equal their sources
  after every scenario in the harness.
- A second lane kind in `lanes.ts`, which grows by roughly a third.
- Projections stay on today's slower path, deliberately.

## Not in this

Shared voices already fill in one loop; nothing here changes them. Non-motion voices of one subject
(`keys`, `fn`) still take the general path, as solo lanes do today; if they need the same treatment
it is the same table with a different sampler, after this lands.
