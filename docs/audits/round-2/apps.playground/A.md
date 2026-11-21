## The site's /playground page mounts `Playground` without Oswald's @font-face or the font wait, so diagram title bars bake in a fallback face
- where: apps/playground/src/Playground.tsx:9 (Playground); setup lives only in apps/playground/src/main.tsx:1,10-12
- scenario: `Playground`'s doc says it is for "its own index.html, or the docs site's", and site/src/pages/playground.astro mounts it with `client:only="react"`. The two things the diagrams need, `import '@weasel-js/theme/faces.css'` (which declares Oswald) and `document.fonts.load('400 12px Oswald')` before rendering, sit in main.tsx, which the site never runs. Nothing under site/ imports faces.css or Oswald. FlowDiagram bakes its title bars from a canvas in Oswald (widgets/FlowDiagram/style.ts:33, FlowDiagram.tsx:19), so on the site they come out in a fallback face, or blank, since the family is never loaded. In the standalone app they render correctly. The font import and wait belong in the shared `Playground` (or in a mount helper both entries call).
- evidence: read (the site page, main.tsx and FlowDiagram source; the rendered result is inferred, not run)
- severity: medium

## Files read
apps/playground/src/Playground.tsx
apps/playground/src/icons.gen.ts
apps/playground/src/main.tsx

<!-- done: 1 findings, files read: 3 -->
