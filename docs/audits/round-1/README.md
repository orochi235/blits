# Audit round 1

Blind pairs at `14f899f038bda0564b8f0836ef7cfe95f16ae600` (2026-11-21). Each area's directory holds its file list (`files.txt`), both
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
| `core.part1` | 47 | 47/47 | 6 | 3 | 1 | 8 |  13.0 |   5.0 | - | - | 10 | 1 | 3.55M | $10.26 | `audit1-core.part1` |
| `core.part2` | 47 | 47/47 | 2 | 4 | 0 | 6 |  14.0 |   8.0 | - | - | 7 | 0 | 3.93M | $10.99 | `audit1-core.part2`, left out: merge conflict |

Totals: 14 distinct findings, 17 fix commits, 1 questions, 7.48M weighted tokens, $21.25.
