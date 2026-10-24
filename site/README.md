# The blits site

The docs site: Get started, guides, and examples for someone putting blits to work; one page per word
of the vocabulary, each built around a live explainer; and the API reference generated from the doc
comments in `../src`. It is for making the words visible first,
then for consumers looking for a signature, then for someone arriving from npm. `docs/schema.html`
stays the design record; the site takes its section order loosely and writes its own prose.

```
npm run site         # from the repo root: the API JSON, then Astro's dev server on :: port 4880
npm run site:build   # the API JSON, then a static build to site/dist
npm run site:smoke   # build, then load every page headless; fails on a console error, a dead link, or no search index
```

`BLITS_SITE_URL` sets the origin canonical links and the sitemap use (`https://michaelbaker.tech` by
default). `BLITS_SITE_BASE` sets the base path (`/blits/` on Pages) and `BLITS_SITE_OUT` the output directory,
which the smoke test reads too. `site/dist` and `site/.generated` are rewritten whole on each build. The build ends by running
Pagefind over `dist`, which writes the search index to `dist/pagefind/`; the dev server has none, so
search answers only on a build.

## How a page is made

A page is MDX in `src/pages/` with `layout: ../layouts/Page.astro`. Its explainer is a React island,
`<X client:only="react" />`, from `src/explainers/`, followed by `<Source of="X.tsx" />`, which
lists that file and every file it reaches by a relative import. The page ends with
`<ApiEntries word="…" />`.

An explainer declares a `Scene` (`src/explainers/kit/scene.ts`): a kit, subjects, voices, and
optionally events at a time, a `syncing` predicate (false is a hidden tab), a `probing` predicate
(false leaves a subject unasked), `record` for a trace, and the ledger's subject and channels. The
kit owns the clock and the mix. No explainer reads a wall clock, so scrubbing backwards rebuilds the
mix and replays from 0; the kit keeps no history to read back through. The ledger itemizes the fold
by playing each voice in a solo mix beside the real one, and shows each voice's weight for the
ledger subject after fades and signals, from `handle.weightOf`.

Colors come from the CSS tokens through `readInk`, and each voice keeps its slot color (`v1`..`v5`)
on the stage, in the ledger and in any trace.

## Live code and snippets

Code on the Get started, guide, and example pages is never pasted into the MDX. It lives in files the
site typecheck covers, so a page can't show code that no longer compiles:

- `src/live/**/*.ts` exports `run(root)`, which draws into `root` and returns a function that stops
  it. `<Live client:only="react" of="…" />` runs one while it is on screen, and `<Listing
  of="live/…" />` shows it.
- `src/snippets/**` holds code that is shown and not run, through `<Listing of="snippets/…" />`.
  Lines above one reading `// ---` are declarations for the checker, left off the page.

The rail's order lives in `src/nav.ts`: `start`, `guides`, `words`, and `extra`. The prev and next
links at the foot of each page walk `reading`, which is that order with each guide after the guides
index. A guide is `src/pages/guides/<slug>.mdx`; the index lists each one's `description`.

## The reference

`npm run api` runs TypeDoc over `../src/index.ts` into `.generated/api.json`, and `src/api.ts`
prints it by word. Every export needs a `@category <word>` tag naming a page in `src/nav.ts`; the
build fails on one without. TypeDoc needs TypeScript's JS compiler API, which TypeScript 7 does not
have, so the site pins `typescript` 6 for itself while the package builds with 7.

## Deploying

`.github/workflows/site.yml` checks, smokes and deploys to GitHub Pages on every push to `main`,
and by hand. The site is live at `michaelbaker.tech/blits/`.
