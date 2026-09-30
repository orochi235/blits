# The blits site: explainers and API reference

**Status: designed 2026-09-30, unbuilt.** Nothing below exists yet. This file is scaffolding for
the build; once the site is built, anything still worth keeping moves into the site's own README and
this file is deleted.

**For:** whoever builds the site. **Answers:** what the site is for, how it is put together, and
what each page shows.

## What it is for

In priority order, as decided:

1. **Making the vocabulary visible.** Voices, loci, fades, signals and the fold are hard to picture
   from prose, so the site is mostly live explainers, one per word, each showing the arithmetic
   rather than describing it.
2. **Consumers' docs.** For klieg, wod, sherpa, magicsmoke, weasel and astv: from "I have an effect"
   to "it's on a mix", reference plus live examples to copy.
3. **The pitch** to someone arriving from npm. The home page does this in one picture and stops.

`docs/schema.html` stays as it is, the design record. The site takes its section order as a loose
outline and writes its own prose for newcomers; it does not render, replace or absorb the schema.

## Layout

| Piece | What it is |
|---|---|
| `site/` | An npm workspace in this repo (`"workspaces": ["site"]` in the root `package.json`). Never in the package's `files`, so it never ships to npm. |
| Framework | Astro 7 with its React and MDX integrations. Pages are MDX and render to static HTML; explainers are React islands, hydrated `client:visible`. |
| blits itself | Imported from `../src` through a path alias, `@blits/*`, in `site/tsconfig.json` and Astro's Vite config. The site always runs the working tree, with no build step and no stale `dist`. |
| Controls | `@weasel-js/labkit` 1.7 from npm, with its peers (`react` 19, `@weasel-js/core`, `@weasel-js/theme`). |
| API reference | TypeDoc 0.28 run as a prebuild step: `typedoc --json site/.generated/api.json src/index.ts`. The site keeps its own `typescript@6`, because TypeDoc needs the TypeScript JS compiler API and the package builds with TypeScript 7, which has none. |
| Base path | From `BLITS_SITE_BASE`: `/` locally, `/blits/` on GitHub Pages. Every internal link goes through Astro's `base`. |

### Commands

| Command | Does |
|---|---|
| `npm run site` | Generates the API JSON, then the Astro dev server on host `::`, port 4880 (semanticore's `serve` has 4871). |
| `npm run site:build` | Generates the API JSON, then a static build to `site/dist/`. |
| `npm run site:smoke` | Builds, serves `site/dist/` and runs the smoke test (below). |

### What goes on disk, and what bounds it

`site/.generated/` (the TypeDoc JSON) and `site/dist/` (the build) are gitignored and rewritten
whole on every build, so neither grows. Playwright's browsers live in the shared
`~/Library/Caches/ms-playwright`, which already holds several versions; the site pins one
Playwright version so it adds at most one.

## The API reference

The doc comments in `src/` are the one source. Each export in `src/types.ts` and the modules
`index.ts` re-exports gets a TypeDoc `@category` tag naming its vocabulary word (`channel`, `patch`,
`voice`, `mix`, `signal`, `time`, `blending`, `engine`), which is what groups the reference by word
rather than by TypeScript kind. A missing tag fails the build, so nothing lands in the reference
unfiled.

An Astro content loader reads `api.json` into one collection. Each word's page ends with that word's
entries; `/reference/` lists every entry, for someone who arrived looking for a signature. Every
entry links to its word's explainer, and every explainer links to its entries. A gap in a doc
comment shows as a gap on the site, which keeps the pressure on `src/`.

## Explainers

Every explainer is built from the same three parts, in `site/src/explainers/kit/`:

| Part | What it is |
|---|---|
| **Stage** | Subjects drawn as plain shapes (dots, bars, swatches) on a canvas, posed by a real `mix`. |
| **Ledger** | One row per voice beside the stage: its weight and what it contributes, then the folded result. Tabular numbers, decimal points aligned, with the column that changes set last in its row. |
| **Transport** | Play, pause and a scrubber, which own the clock and call `sync`. No explainer reads a wall clock, so a run is deterministic: scrubbing backwards rebuilds the mix and replays from 0 to the scrubbed time, since the mix cannot read back. Each explainer's own knobs sit in a labkit `ControlPanel`. |

The pages, in the schema's order:

| Page | The explainer |
|---|---|
| Home | Five swatches under three voices, each switchable, with the ten words labeled on the live picture. |
| Channel and kit | Two voices on one field. Switch the channel between `sum`, `mul`, `max` and `last` and the same inputs fold four ways. |
| Patch | A phase scrubber over both forms with the curve drawn, and an easing picker: CSS's names, a draggable bezier, and steps. |
| Voice | A row of dots under one voice: rate, loop, stagger and fade, with the fade envelope drawn under the row. |
| Mix | Many subjects under several voices, with stacked bars per subject from each influence to the pose. |
| Signal | A `level` slider feeding a `slew` and a `gate`, with a trace of each. |
| Time | A subject left unprobed that catches up by its gap, and a "hide the tab" button with `rebase` on or off. |
| Blending | Four small demos: fade, retarget with `from: 'current'`, blend between alternatives, and handover at rest. |
| Locus | Two half-weight `mul` voices on a gain of 0.06, piled up (reads 0.28) against folded as alternatives (reads 0.06). |
| Patch state | A spring stepped by `dt`, with `maxDt` on or off across a long gap. |
| Engine | Prose and the seam's reference. No explainer: there is one engine to show. |
| klieg | A placeholder page until klieg depends on the published package; then a sign with its three mixes exposed. |

## Deploying

`.github/workflows/site.yml`, modeled on agnew's `pages.yml`: install, `npm run check`,
`npm run site:smoke`, then upload `site/dist/` and deploy to Pages with
`BLITS_SITE_BASE=/blits/`. Its only trigger is `workflow_dispatch`, so it stays off until Pages is
enabled on the repo, which is private today; adding a `push` trigger is the switch.

## Testing

`npm run site:smoke` loads every page in headless Chromium through the `playwright` package (not an
MCP server), lets each explainer run for two seconds, scrubs once backwards, and fails on any
console error or page error. It prints one line per page as it goes. The arithmetic is not retested
here: the package's own suite covers it, and the explainers call the same code.
