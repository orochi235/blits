# Scrubbing a stateful mix: what is left

**Status: one item unbuilt, decided.** Fixed-interval stepping (`stepMs`), closed-form motion
(`spring`, `glide`), copies of state, the history horizon, recorded input, reading back
(`mix.project`, `MixOptions.history`), moving the mix (`mix.seek` with `history.tape`, 2026-10-07)
and rebuilding state on `handle.seek` (2026-10-08) are built, and the schema page's Score section
describes them and the decisions behind them. Delete this file once the item below is built or
turned down, moving any decision into `docs/schema.html` first.

**For:** whoever works on reading back next. **Answers:** what seeking still gets wrong.

## Left to build

**A read ahead after a seek back plays what is cued, not what the tape recorded.** The decision
(2026-10-07, Decision 10 in the draft this file held) was that `project` ahead of the mix applies
the tape's recorded calls to its throwaway mix. It cannot as built: each recorded call is a
closure over the live mix and its voices (`record` in `src/tape.ts`), and a projection is a copy.
Building it means recording each call as data, a kind and its arguments naming voices by id, and
applying it to whichever mix is given; motion retargets would then need the projection to stop
reading the live patch's stretches, which the live mix also writes.
