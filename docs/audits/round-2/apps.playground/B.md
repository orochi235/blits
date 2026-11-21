# apps.playground findings

Note: the brief names frozen commit 0d1aa23ae22834c481f05bd51a4972ebae74778d, which does not exist in this
clone (`git cat-file` fails); the tree read is HEAD 836ce269.

## The docs site's /playground/ page renders without the Oswald wait, so its diagram title bars bake in a fallback face
- where: apps/playground/src/main.tsx:9 (module top level); apps/playground/src/Playground.tsx:9 (Playground)
- scenario: `Playground` is documented as "for a page to mount: its own `index.html`, or the docs site's", and
  site/src/pages/playground.astro renders `<Playground client:only="react" />` directly. The font gate added in
  081fe231 (`document.fonts.load('400 12px Oswald').finally(render)`) lives only in main.tsx, after the site
  mount (239c06f6) had already split `Playground` out. On a cold visit to the site's /playground/, the flow
  diagram (FlowDiagram.tsx registers `Oswald` as a canvas font and bakes title-bar glyphs from a canvas) draws
  before the Oswald file is in, so title bars show the fallback face — exactly the failure main.tsx's comment
  says the wait exists to prevent. The same "wait for the face before mounting" decision is answered two ways
  on the two mount paths; it belongs inside `Playground` (or a shared mount helper) so both pages get it.
- evidence: read (both mount paths; site page has no fonts.load and no other wait). That the bake does not
  refresh on its own once the font arrives is inferred from main.tsx's comment and weasel exporting a manual
  `refreshCanvasFont`, not run.
- severity: medium

## Files read
apps/playground/src/Playground.tsx
apps/playground/src/icons.gen.ts
apps/playground/src/main.tsx

<!-- done: 1 findings, files read: 3 -->
