Re-attaching in the same document ending its own new agent (A+B): fixed b90f6b11

Failed attach after `page.js` leaving the agent running with no port (A): fixed 30549a96

Failed history toggle showing "This page can't be inspected" (A): fixed 06b44dcc. question: the worker now sends a new `refused` control, and the panel shows "History could not be changed: …" until the next attach. Is that wording and behavior wanted?

Toggle posting on a possibly disconnected port without a guard (A+B): fixed 6fb90c28. The reopening port moved to `src/link.ts`, and the toggle, the ping and the panel protocol all send through its guarded `send`. Its test (`test/link.test.ts`) covers the new module, so it never failed against the old code. question: a click while the port reopens is now dropped silently rather than thrown. Should it be queued until the port is back?

Tooltip hardcoding "10 s" instead of `HISTORY_MS` (A+B): fixed 0efa84cd. No test, because the line is JSX inside `panel.tsx`, which runs side effects as soon as it is imported.

Extra defects: none.

There are no CHANGELOG lines: `@blits/devtools` is private, and the root CHANGELOG belongs to the published engine.

Checks:
- `npx vitest run apps/devtools/test/agent.test.ts`: pass (1 test)
- `npx vitest run apps/devtools/test/pair.test.ts`: pass (7 tests)
- `npx vitest run apps/devtools/test/link.test.ts`: pass (1 test)
- `npm run typecheck`: pass (exit 0)
- `npx tsc -p apps/devtools/tsconfig.json --noEmit` (the root typecheck does not cover devtools): pass (exit 0)
- `npm run lint`: pass (exit 0)

tally: 5 of 5 fixed, 0 extra fixed