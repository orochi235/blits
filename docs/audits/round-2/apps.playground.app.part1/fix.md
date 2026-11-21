Marks table keeps the oldest 120 marks instead of the newest (A+B): fixed b72fd41e

Refused or unchanged level, stage or title edit pushes an undo step and rebuilds the player (A): fixed d18c4f3e

Channel ease can't turn steps off while the patch's ease is stepped (A+B): fixed 4f2ae0d9

Booker drain tag dropped when a stage change builds a new player (A): fixed 6baa96b2 — question: the tag still lives outside the composition, so undo can't restore it. Should it move into the composition?

Emptied retarget/push expression leaves the old error on screen (A): fixed a19bf153

Save revokes the object URL in the same tick as the click (A): fixed c09e2599 — question: the browser failure is inferred, not reproduced; the test only checks that revoking now waits a task.

Anchor "insert…" targets the group's own member, or a voice name that doesn't exist (B): fixed 39f0b969 — made the strict call: with no voice to wait on, the menu is disabled. "It" also stays in the asker's score, matching how `timing.ts` resolves a plain name.

The playground is private, so none of these got a CHANGELOG line.

Checks:
- `npx vitest run apps/playground/test/edit.test.ts`: pass (11)
- `npx vitest run apps/playground/test/events.test.ts`: pass (19)
- `npx vitest run apps/playground/test/player.test.ts`: pass (18); it failed (1 of 18) with the old `player.ts` swapped back in
- `npx vitest run apps/playground/test/aim.test.ts`: pass (2)
- `npx vitest run apps/playground/test/file.test.ts`: pass (4)
- `npx vitest run apps/playground/test/groups.test.ts`: pass (8)
- `npx vitest run apps/playground/test/channelTiming.test.ts`: pass (2)
- `npm run typecheck`: pass (exit 0)
- `npm run lint`: pass (exit 0, 1 info)

tally: 7 of 7 fixed, 0 extra fixed