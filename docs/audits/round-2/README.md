# Audit round 2

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
| `apps.devtools` | 9 | 9/9 | 5 | 3 | 3 | 5 |   5.0 |   0.0 | - | - | 5 | 2 | 0.64M | $2.04 | `audit2-apps.devtools` |
| `apps.fireworks` | 5 | 5/5 | 6 | 5 | 5 | 6 |   6.0 |   0.0 | - | - | 8 | 2 | 0.92M | $2.70 | `audit2-apps.fireworks` |
| `apps.playground` | 3 | 3/3 | 1 | 1 | 1 | 1 |   1.0 |   0.0 | - | - | 1 | 0 | 0.40M | $1.17 | `audit2-apps.playground` |
| `apps.playground.app.part1` | 28 | 28/28 | 6 | 3 | 2 | 7 |   8.3 |   1.3 | - | - | 7 | 2 | 1.79M | $5.05 | `audit2-apps.playground.app.part1` |

Totals: 19 distinct findings, 21 fix commits, 6 questions, 3.75M weighted tokens, $10.96.
