# The blits site

The docs site: one page per word of the vocabulary, each built around a live explainer, and the API
reference generated from the doc comments in `../src`. It is for making the words visible first,
then for consumers looking for a signature, then for someone arriving from npm. `docs/schema.html`
stays the design record; the site takes its section order loosely and writes its own prose.

```
npm run site         # from the repo root: the API JSON, then Astro's dev server on :: port 4880
npm run site:build   # the API JSON, then a static build to site/dist
npm run site:smoke   # build, then load every page in headless Chromium; fails on any console error
```

`BLITS_SITE_BASE` sets the base path (`/blits/` on Pages) and `BLITS_SITE_OUT` the output directory,
which the smoke test reads too. `site/dist` and `site/.generated` are rewritten whole on each build.

## How a page is made

A page is MDX in `src/pages/` with `layout: ../layouts/Page.astro`. Its explainer is a React island,
`<X client:only="react" />`, from `src/explainers/`, and it ends with `<ApiEntries word="…" />`.

An explainer declares a `Scene` (`src/explainers/kit/scene.ts`): a kit, subjects, voices, and
optionally events at a time, a `syncing` predicate (false is a hidden tab), a `probing` predicate
(false leaves a subject unasked), `record` for a trace, and the ledger's subject and channels. The
kit owns the clock and the mix. No explainer reads a wall clock, so scrubbing backwards rebuilds the
mix and replays from 0; the kit keeps no history to read back through. The ledger itemizes the fold
by playing each voice in a solo mix beside the real one, and shows each voice's weight for the
ledger subject after fades and signals, from `handle.weightOf`.

Colors come from the CSS tokens through `readInk`, and each voice keeps its slot color (`v1`..`v3`)
on the stage, in the ledger and in any trace.

## The reference

`npm run api` runs TypeDoc over `../src/index.ts` into `.generated/api.json`, and `src/api.ts`
prints it by word. Every export needs a `@category <word>` tag naming a page in `src/nav.ts`; the
build fails on one without. TypeDoc needs TypeScript's JS compiler API, which TypeScript 7 does not
have, so the site pins `typescript` 6 for itself while the package builds with 7.

## Deploying

`.github/workflows/site.yml` checks, smokes and deploys to GitHub Pages on every push to `main`,
and by hand. The site is live at `michaelbaker.tech/blits/`.
