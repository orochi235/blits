The site's /playground page never loaded or waited for Oswald (A+B): fixed 4a0c2dba. The `faces.css` import and the `document.fonts.load('400 12px Oswald')` wait now live in `Playground` itself, so it holds `App` back until the font settles. `main.tsx` now just mounts it, and both the standalone page and the site's page get the wait. The new test `apps/playground/test/playground.test.ts` failed before the fix and passes after. There's no CHANGELOG line because `@blits/playground` is private and the site isn't a published package.

No extra defects found.

Checks:
- `npx vitest run apps/playground/test/playground.test.ts`: before the fix, fail (`expected "vi.fn()" to be called with arguments: [ '400 12px Oswald' ]`); after, pass (`Tests  1 passed (1)`)
- `npm run typecheck`: pass (exit 0)
- `npm run lint`: pass (exit 0; one info-level suggestion in a file outside this area)

tally: 1 of 1 fixed, 0 extra fixed