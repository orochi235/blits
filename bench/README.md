# bench

How blits' frame cost is measured, for whoever changes a hot path next: the tools, the rules every
run follows, the traps that have produced wrong numbers, and the ideas already tried and backed
out, so they are not tried again. Benches run on a fleet node (`onto do --kind bench`), never on
the machine being used.

## Comparing two builds

- `AB_EACH=1 bench/ab.sh <rev-a> <rev-b> <rounds> [rows...]` builds each revision from
  `git archive` and alternates which runs first each round. A revision of `.` is the synced
  working tree; the other has to be a commit `origin` has. `AB_EACH=1` runs each row in a process
  of its own. `bench/abdirty.sh` compares an uncommitted diff with no commit on origin.
- `AB_BENCH=bench/frame.mjs` makes both sides run this tree's bench, so both print `kB/frame`.
- `bench/frame.mjs` takes `form:n:v` for a row its list does not hold, such as `fns-:10000:1`, and
  `OUT=blank` to probe into a pose of the mix's own (`mix.pose()`) rather than a host's `{}`.
- `node bench/medians.mjs <output>` reduces a run to medians; `node bench/allocs.mjs <row>` lists
  the functions that allocate.
- `bench/lineage.sh <rounds> <rev>... -- <rows>` runs this tree's bench over any number of builds,
  releases included, and `bench/lineage.mjs` tables it.

## Rules every run follows

- **Raw output first.** Each run's output goes in `bench/runs/<date>-<what>.txt`, headed by a `#`
  line naming the node and the command, before it is reduced (2026-10-20).
- **Every change measured goes in `ledger.tsv`, kept or backed out.**
  `LEDGER="<what it does>" LEDGER_NODE=<node> LEDGER_FRAMES=<frames> node bench/medians.mjs <output>`
  appends its rows; `LEDGER_REV` names the commit a `.` stood for, and a change backed out is
  written `(backed out) ...`. `node bench/ledger.mjs [row]` lists each row's entries with the
  product of the kept ones' ratios (2026-10-20).
- **Time a history row (`kept`, `seek`, `back`) at `FRAMES=1500`.** At the default 300 its 5 s
  window fills only as the run ends, so nothing it lets go of is measured.
- **Allocation is a median over rounds on a fleet node, never one local run.** A row whose patch
  returns an object reads one of two `kB/frame` values run to run on one build: `fn` 10k×3 read
  2,442 or 4,318 on one Mac (2026-10-11).

## Traps

- **A node's `node_modules` can be stale.** One had a `@weasel-js/history` without `timestampAt`,
  so `kept` and `seek` failed (2026-10-11). Start a bench job with `npm ci`.
- **Leave `seek` out of a run over releases before 0.11.0**, or give it its own: v0.7.1 takes
  1.2 s a frame on it, and the first run over releases hit its 90-minute limit in round 2
  (`runs/2026-10-20-releases.txt`; the rerun without it is `runs/2026-10-20-releases-no-seek.txt`).
- **A 10,000-subject `kept` run on a laptop lands near 5.5 or near 7.5 ms**, by how far V8 grows
  its young generation (`--max-semi-space-size` 4 against 32 gives either). Read it over many rounds.
- **`fns` reads in modes by build**, so time a lanes change on such a row with a switch inside one
  build, not with `ab.sh`.
- **The `kept` rows never run on lanes**: their two plain voices write `dark`, which the stateful
  voice writes too, and a channel any unfitting voice writes is closed. They measure the general
  path alone.
- **The `keys` row probes into a host's `{}`**, so it allocates about 180 kB a frame at 10,000
  subjects where `OUT=blank` allocates 19 to 32 kB (teitou, 3 rounds,
  `runs/2026-11-04-keys-out-blank.txt`): a number stored into a literal's shape is boxed. That is a
  host's cost, which `mix.pose()` removes, not the mix's.
- **On a node, `HEAD` is the node's base commit, not the one synced**, so `same.sh` and `ab.sh`
  refuse it in a dirty tree (2026-10-26).
- **Confirm a short-run regression at `FRAMES=5000`** before chasing it: 330 frames can end before
  the JIT settles. The glow rows read mostly warm-up at the default.
- **`turnover^` and `named` read two ways on identical code**, by process (0.43–0.46 or 0.48–0.54
  ms; 1.23–1.26 or 1.41–1.51 ms). Six runs a side at least.
- **Rows run earlier in one process change a later row's numbers** (the heap a 100k row grew):
  `AB_EACH=1 bench/ab.sh` runs each row in its own process.
- **The heatmap stress demo plays a lanes twin**, so profile `bench/heatmap.mjs` with
  `bench/heatprof.sh` (`INLINE=off`, `LINES`, `CALLERS`), not `bench/stressprof.sh heatmap`.

## Where `seek` stands

A seek back 300 ms and a return before every sync cost about 1.9 ms a frame at 10,000 subjects
(msb-uai, 2026-10-20, 9 rounds, `AB_EACH=1 bench/ab.sh a0a5bf4 c101d90 9`, ms a frame):

| Subjects | `kept` | `seek` | Seek back and return |
|---:|---:|---:|---:|
|  1,000 | 0.627 | 0.861 | 0.234 |
| 10,000 | 7.224 | 9.089 | 1.865 |

One build's `seek` runs spread 8.67 to 10.07 ms there, so a change worth under about 5% does not
show in 9 rounds. A profile names the put back of a record stepped on from the copy it would be
put back from as the lever (9% in `keptOf`, the first read of that copy). An inexact build skipping
every read of the copy read 8.400 against 8.766 ms in 5 rounds, runs overlapping, so an exact skip
saves at most about 4%; the cost looks like a cache miss that a skip would move to the next read
rather than remove (inferred, not measured). An exact skip needs every field `copyHeldInto` copies
shown equal on the record, or those fields cached on its `Ahead`, which grows it by about what the
read saves. A narrower inexact skip made 403 of 2,000 `SAME_SEEK=1` scenes differ and failed 7
tests. Not built.

## Tried and backed out

Each moved no number outside run-to-run spread, or cost more than it saved. The ledger holds the
rows where one was timed.

| Change | Result |
|---|---|
| A store site per lane position for a scalar channel, a site per scalar channel in `copy`, folding a delta's number in `foldDelta` (2026-10-11) | no change to the `keys` row's allocation |
| Growing a lane's arrays to the subjects probed last frame; handing `LaneHost.ready` its numbers through `Lanes.arg` | no change |
| Filling a band-switching lane's bands only on the frame its weight reaches 0, not every frame at 0 (msb-uai, 2026-10-10, 7 rounds against `350991c`) | `glowl` 2.359 to 2.393 ms, runs overlapping |
| Writing a spare copy's state into its own object in place (`7768e08`, reverted in `d1ef4fe`) | `seek` 9.52 against 9.32 ms; two walks over the keys cost more than the allocation saved |
| Putting records back through one class's methods instead of two closures per voice (`c101d90`, reverted in `b6e8f88`) | `seek` 8.852 against 9.089 ms, rank test short of chance |
| Storing a channel's primitive rest without `copy` (`f1523e0`, 2026-10-20) | no row moved |
| Storing a rest into the pose by name, the ceiling for a function made per kit (keiei, 2026-10-20) | the ledger's "ceiling" rows |
| Answering a probe with nothing laned at the top of `Lanes.prepare`; taking `own`'s targeted voices off lanes as a crowd (2026-10-21) | no change |
| Leaving `GENERAL_PROBE` unstamped in `linked` (2026-10-21) | about 9% faster, but a voice coming back onto a lane could report a stale `weightOf` |
| Storing stretches as Float64Arrays (`b4a4260`, 2026-10-02); reading a crowd's keys stops as flat numbers (2026-10-03) | no change |
| On `swap`: linking a voice stepped twice once; handing `foldNow` its met lanes; skipping the chain walk for a never-linked voice; presizing a lane's `records`/`deltas` (2026-10-26) | no change (`bench/runs/2026-10-26-{dedupe-steps,met-lanes,unchained-walk,presize-records}.txt`) |
| On roles: clearing `taken` once before inline members; priming a signalled setting once a lane call; clearing once before a member-at-a-time gather (2026-10-26) | short of significance (`bench/runs/2026-10-26-role-*.txt`, `-locus-*.txt`) |
| Carving motion buffers from a shared slab; keeping a named subject's record out of the WeakMap (2026-10-25) | no change to starting tweens |
| One `Seat` per crowd voice (`eed156c`); skipping the due-queue push of a voice retiring at once (2026-10-29) | no change to a stop |
| Pooling everything per voice (2026-10-05); cutting churned-voice garbage from 21.5 to 11.7 KB (2026-10-24) | no row moved; weasel's lever is blits' per-frame work, not bytes per voice |
| A motion patch's `runs` as a plain array | `tweens^` 6% slower; copying into a Float64Array first made `weasel^` 15% slower |
| The keys search inside `fold` | `fold` stopped inlining and boxed each row's phase (+155 kB a frame) |
| Skipping `pullRun`'s `FILLED`/`IDLE`/`SEEN` checks behind a write counter (2026-11-03, reverted in `4a80fd1`) | `tweens^` −3%, but `turnover^` and `churn^` +4–5% |
| Counting `pullRun`'s probes in locals; answering `runMotion`'s same-`since` check before `same`; inlining `linked` into `probe`/`atRest`; moving `popDue`'s loop out; skipping `atRest`'s second `chains.get` | no change |
| A public `keys` read into a reused out object (2026-10-08) | slower than `at` (0.87 against 0.78 ms); V8 removes `at`'s fresh object |
| Writing `pullRun`'s `LANE_PROBE`/`LANE_FILL` once per run | not tried, and not to try: every pace loop reads them by slot, so it would make a second place for the answer |
| Writing the trail's subject list only where a subject moved (2026-11-11) | `tweens^` +4% (`bench/runs/2026-11-11-trail-list-ab.txt`) |
| Three variants of `levelsOf`'s delay hash (2026-11-11) | none faster than about 2 ns a subject |
| Copying each fn result into a delta the record owns, to end the finder commit's pretenuring (2026-10-29) | GC pauses fell, `glowb^` 14% slower; the pauses are 8 µs of a 100 µs loss |
| Building records with a class (`new`) | layout and time unchanged |

A lane switching a band off at weight 0 costs the `glowl` rows about 3% (teitou, 2026-10-10,
against `da6e613`: `glowl` 1.680 to 1.736 ms), and filling only once did not recover it, so the
repeat fill is not shown to be the cost. `glowc` and `glowkeys` read slower on lanes (3.3 against
3.0 ms, 2026-10-21) though nothing in them runs on a lane, since the flicker still shares one
record that every read points at its subject and back.

## Still allocating

Numbers that are still boxed on their way out: a role's `gatherInto`, a crowd's `KeyRows.fold`,
and what `host.signal` returns. Under `from: 'current'`, `keep` still copies a pose a probe into
`out`. None is timed.
