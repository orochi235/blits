# Handoff — blits

**For:** the next session on blits. It holds current state and the traps that live in no other
doc; everything else is a pointer. Keep it short: open work goes in `docs/TODO.md`, the owner's
calls in `docs/decisions.md`, measurements in `bench/README.md` and `bench/runs/`.

## Where things live

| What | Where |
|---|---|
| What blits is, and the design | `docs/schema.html` |
| Open work, tagged by who can take it | `docs/TODO.md` |
| The owner's calls not in the schema | `docs/decisions.md` |
| What shipped | `CHANGELOG.md` |
| How to measure, traps, what was tried and backed out | `bench/README.md` |
| The naming sheet | `docs/vocabulary.json` (semanticore serves it as a page) |
| The site, the playground, the panel, the DevTools extension, each companion | their own README |

## State

- `main` at `git@github.com:orochi235/blits.git`, public. Released: engine and blits-panel 1.7.0
  (in lockstep), blits-rapier 0.7.10, blits-quarks 0.17.10, blits-tone 0.12.11.
- `npm run release -- <version>` (`scripts/release.mjs`) releases the engine, then the panel at the
  same version and each companion, one tag at a time, waiting on each run; a rerun resumes from the
  first missing tag. release.yml runs the check once and sets `BLITS_CHECKED` so `prepublishOnly`
  skips it; a publish by hand still checks.
- `npm run check` is lint, typecheck of `src` and `test`, then the suite. It does not typecheck the
  site; `.github/workflows/site.yml` does, on every push to `main`, then deploys to
  `michaelbaker.tech/blits/`.
- Consumers on blits: klieg, wod, sherpa (through klieg, one deduped copy), magicsmoke, astv,
  blinken, weasel, portfolio, agnew, each pinning its own version.

## Now (2026-11-27)

- 1.7.0 is out, carrying what weasel's animator rebuild waited on (branches
  `animator-rest-from-blits`, `clock-remap`, `coast-on-glide` there; weasel-7a moves the pins).
  **Never tag a release without Mike saying "release".**
- Replay fuzz 1–600 across every mode fails only program 98 under the transport, the maintainer
  entry "A read ahead cannot see a resting frame it skips" (2026-11-27).
- `.playwright-mcp/find.ts` finds and shrinks one program's first failing check outside vitest
  (`npx esbuild .playwright-mcp/find.ts --bundle --platform=node --format=esm
  --outfile=.playwright-mcp/find.mjs && node .playwright-mcp/find.mjs 242 alone`; `transport` for
  the remaps-transport-store mode). In zsh, a loop over `"242 alone"` needs `${=s}`, or the seed
  reads NaN and every program "passes".
- Branches `clock-remap` and `animator-rest` are merged; their worktrees are weasel-7a's to remove.

## Traps

- **`npx vitest` hangs on this laptop** with no output (seen 2026-11-27); run tests through
  `onto do --kind test` even for one file.

- **`onto test` runs the suite only, not lint**, and release.yml lints before it publishes, so an
  agent's unformatted file stops a release. Run `npx biome check .` on a merge before calling it
  done (a 1.3.0 publish run failed on four bench JSON files, 2026-11-12).
- **A companion that starts calling a new engine export raises its `@msb235/blits` peer floor in
  the same change.** The release checks only that a range takes the new engine, not that it leaves
  out engines too old to run the package; quarks, tone and rapier shipped calling `bind` on
  `^1.0.0` and `^1.1.0` (fixed 2026-11-21).
- **`npm run typecheck` on a fleet node can fail with TS6305** ("output file … has not been built
  from source file") on the companions: the node's root `dist` build is judged current when it is
  not. Send `sh -c 'npx tsc -b --force && npm run typecheck'` instead (2026-11-23).
- **WebGPU tests need a real browser**, so `onto test` leaves them out. Send them with
  `onto do --kind test --node teitou -- npm run test:gpu`.
- **Explainer source may import only from under `site/src/explainers`**, and blits only as
  `@msb235/blits`, the alias reaching the public entry alone.
- **A stale served vocabulary page has overwritten `docs/vocabulary.picks.json` before.**
  `git diff` it before trusting it. Run semanticore at its `main` HEAD; `0c1df0c` is the last build
  known to render the sheet.
- **Public renames go through a deprecated alias** that warns once a mix, kept for one release and
  removed in the next (`locus` → `role` set the pattern).
- **Methods run per subject are installed on the prototype** at the foot of `mixer.ts`, `lanes.ts`
  and `motions.ts`; as plain functions they cost up to 9%.
