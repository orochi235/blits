# Findings: apps.playground.blits

Note: the brief names frozen commit 0d1aa23…, which this clone does not hold (`git cat-file` fails). HEAD is
836ce269, and `git status` shows no changes under `apps/playground/`, so the files were read as they stand there.

## A motion option's expression loses its `input` marking when `specOf` wraps it to check its output
- where: apps/playground/src/blits/spec.ts:52 (specOf, the `takes` wrapper inside `fn`)
- scenario: a spring/glide/tween voice with `opts.to = { code: "level('target')" }` (or any expression that returns
  a signal over a level or `around`). `compileExpr` returns `input(fn, [inner])` precisely so that "the wrapper stays
  an input where `inner` is one" (expr.ts:96), and returns an `around` signal bare so the mix still knows it
  (expr.ts:82). `specOf` then wraps the result again in a plain closure, with no `input(...)` and no `bare` check,
  because every per-subject motion option has a `takes` refusal check. The mix therefore sees a non-input function:
  `assess` reports the option as sure, and the history (`inputs: true`) does not treat slider moves on that level
  as inputs, so a seek back by `mix.seek` and a read back trust a value that a slider changed. The same expression
  used as a voice's `weight` (no `takes`) keeps its marking, so the one decision is answered two ways.
- evidence: read
- severity: medium

## A blend member's own `marks` are silently replaced by the lead's
- where: apps/playground/src/blits/blend.ts:8 (SHARED / strayOf / syncBlend); apps/playground/src/blits/cueBlend.ts:21 (cueBlend)
- scenario: two voices share role `r` and `blends.r` is set; the lead has no `marks`, the second has
  `marks: { peak: 200 }` (or they hold different marks). `cueBlend` builds `shared` from the lead's spec minus
  only patch/weight/role/name/tags/hits, so the lead's `marks` (here none) go to every member, and blits'
  `BlendMember` has no `marks` field of its own. `SHARED` in blend.ts leaves out `marks`, so `strayOf` reports no
  stray and `syncBlend`/`withVoice` never copy the lead's marks across. The second voice's `peak` is never placed:
  an anchor `{ start: { of: 'second', mark: 'peak' } }` waits forever, and the score's `innerOf` draws nothing,
  with no error in the editor. Every other field blits shares is in `SHARED` and either synced or reported.
- evidence: read
- severity: medium

## Params list a voice's or group's `start` when an `in` anchor places it, which the mix ignores
- where: apps/playground/src/blits/params.ts:57 (clockParams)
- scenario: a voice with `start: 500` and `anchor: { in: { after: 'intro' } }`. `specOf` and `groupSpecOf` delete
  `start` whenever `anchor.start` or `anchor.in` is set (spec.ts:85, cueGroups.ts:73), and `timingOf` leaves out
  "at 500 ms" on the same test (timing.ts:178). `clockParams` checks only `anchor.start`, so the flow and desk nodes
  show both "in anchored" and "start 500 ms", a start the mix never uses. The two places answer "is start
  overridden?" differently.
- evidence: read
- severity: low

## A replaced Player drops the Events panel's tag filter
- where: apps/playground/src/blits/player.ts:99 (Player constructor, the `from` handover); apps/playground/src/blits/events.ts:29 (EventLog.tag)
- scenario: in the Events panel set the tag filter to `lead` (it writes `player.events.tag` and rebuilds), then
  change the stage (dots → letters, or resize), which makes a new Player with `from: last`. The constructor hands
  over the playhead, sliders, authored levels and pointer, but `events` is a fresh `EventLog` with `tag`
  undefined, so the booker and drain go back to every voice. The panel then shows a blank tag and the full
  stream, and the filter the user set is gone without any action of theirs.
- evidence: read
- severity: low

## `coursesOf` leaves its mixes open when a sync throws
- where: apps/playground/src/blits/course.ts:32 (coursesOf)
- scenario: `compile(c, subjects, { solos: true })` opens a full mix plus one solo per voice, and `close(built)` runs
  only after the loop, with no `try/finally`. A blits throw during `m.sync`/`m.pull`, such as a span refusing a
  layout at its first sync (the playground's author-code wrappers catch only author code, not blits' own
  refusals), escapes with every mix still registered, each on the debug panel's list. `outlineOf` makes the same
  kind of throwaway compile and closes it in `finally` (outline.ts:33), so the two answer it differently.
- evidence: read
- severity: low

## `alignTo` swallows a failed solo seek and leaves the solo ahead of the full mix
- where: apps/playground/src/blits/follow.ts:24 (alignTo)
- scenario: the debug panel seeks the full mix back past what a solo's history holds, or the solo's tape was
  cut by an earlier host call. `m.seek(now)` throws, the `catch {}` drops it, and `m.sync(m.timestamp)` leaves the
  solo where it was, later than `now`. `Player.step` then pulls and records solo poses (plots, the desk, the
  Solo view) from a later time than the full mix, with no sign of it. `Player.seekBack` treats the same failure
  as "can't seek" and falls back to a rebuild.
- evidence: read
- severity: low

## `usesAround`'s doc says `around` mixes keep no history, but `compile` always gives them history
- where: apps/playground/src/blits/pointer.ts:44 (usesAround doc); apps/playground/src/blits/compile.ts:71 (compile)
- scenario: the comment says a composition that calls `around` makes mixes that "keep no history, which blits
  refuses a bounded voice, so a scrub back replays rather than seeks". `compile` passes
  `history: { ms, inputs: true, tape }` to every mix whatever `usesAround` returns, and `Player.seekBack` never
  checks for `around`, so with seek-by-seek a scrub back on an `around` composition does seek. Since 4350a868
  blits takes history beside a bound, so the comment describes behavior the code no longer has, and a reader
  of it gets wrong how scrubbing works here.
- evidence: read
- severity: low

## Files read
apps/playground/src/blits/anchor.ts
apps/playground/src/blits/blend.ts
apps/playground/src/blits/both.ts
apps/playground/src/blits/clip.ts
apps/playground/src/blits/color.ts
apps/playground/src/blits/compile.ts
apps/playground/src/blits/composition.ts
apps/playground/src/blits/course.ts
apps/playground/src/blits/cueBlend.ts
apps/playground/src/blits/cueGroups.ts
apps/playground/src/blits/desk.ts
apps/playground/src/blits/easing.ts
apps/playground/src/blits/edit.ts
apps/playground/src/blits/events.ts
apps/playground/src/blits/expr.ts
apps/playground/src/blits/file.ts
apps/playground/src/blits/fit.ts
apps/playground/src/blits/flow.ts
apps/playground/src/blits/follow.ts
apps/playground/src/blits/frame.ts
apps/playground/src/blits/groupEdits.ts
apps/playground/src/blits/groups.ts
apps/playground/src/blits/keyed.ts
apps/playground/src/blits/keys.ts
apps/playground/src/blits/kit.ts
apps/playground/src/blits/load.ts
apps/playground/src/blits/outline.ts
apps/playground/src/blits/params.ts
apps/playground/src/blits/placed.ts
apps/playground/src/blits/player.ts
apps/playground/src/blits/pointer.ts
apps/playground/src/blits/readBack.ts
apps/playground/src/blits/score.ts
apps/playground/src/blits/scoreHeaders.ts
apps/playground/src/blits/spec.ts
apps/playground/src/blits/stage.ts
apps/playground/src/blits/stages/Stage.module.css
apps/playground/src/blits/stages/Stage.tsx
apps/playground/src/blits/stages/draw.ts
apps/playground/src/blits/stamps.ts
apps/playground/src/blits/timing.ts
apps/playground/src/blits/wire.ts

<!-- done: 7 findings, files read: 42 -->
