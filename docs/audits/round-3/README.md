# Audit round 3

Blind pairs at `0d1aa23ae22834c481f05bd51a4972ebae74778d` (2026-11-21). Each area's directory holds its file list (`files.txt`), both
reviewers' findings (`A.md`, `B.md`), the matching (`match.json`), the fixer's report (`fix.md`) and the
numbers below (`area.json`).

"Read" is how many listed files each reviewer says it read. "Est." is Chapman's estimate of what the area held,
"left" that less the distinct findings, and "last left" the previous pass's figure, which this pass tests.
"New code" counts findings citing a file changed since that pass. "Commits" is what the fixer committed.
"Weighted tokens" counts each kind of token at its price against an input token; "cost" is list price.
One record per job is in `usage.jsonl`. The shas in `fix.md` are the fixer's, on its node; the same commits
as applied here are `fixCommits` in `area.json`.

| Area | Files | Read A/B | A | B | Shared | Distinct | Est. | Left | Last left | New code | Commits | Questions | Weighted tokens | Cost | Branch |
|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|
| `apps.playground.app.part2` | 28 | 28/28 | 8 | 7 | 3 | 12 |  17.0 |   5.0 | - | - | 8 | 1 | 2.55M | $6.84 | `audit3-apps.playground.app.part2` |
| `apps.playground.blits` | 42 | 42/42 | 7 | 6 | 2 | 11 |  17.7 |   6.7 | - | - | 10 | 1 | 2.73M | $7.61 | `audit3-apps.playground.blits` |
| `apps.playground.blits.presets` | 15 | 15/15 | 3 | 3 | 0 | 6 |  15.0 |   9.0 | - | - | 5 | 1 | 1.16M | $3.36 | `audit3-apps.playground.blits.presets` |
| `apps.playground.widgets` | 43 | 39/43 | 5 | 7 | 3 | 9 |  11.0 |   2.0 | - | - | 9 | 1 | 1.70M | $5.03 | `audit3-apps.playground.widgets` |

Totals: 38 distinct findings, 32 fix commits, 4 questions, 8.15M weighted tokens, $22.84.
