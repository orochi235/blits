# Findings: apps.devtools

Note: the checkout's HEAD is 836ce269, not the 0d1aa23 named in the brief; findings cite that tree.

## A re-attach in the same document can end its own new agent: the relay's `bye` is not tied to a port
- where: apps/devtools/src/relay.ts:18 (onDisconnect handler), apps/devtools/src/page.ts:30 (bye), apps/devtools/src/pair.ts:50 (attach)
- scenario: The panel opens while the tab is still loading, so the first `attach()` injects into the document that is loading. When that document reaches `status: 'complete'`, `loaded` runs a second `attach()` on the same document. It calls `page?.disconnect()` on the first port, so the relay posts `{ bye: true }` to the window, and then it injects `page.js` again. `start()` ends the old agent and installs agent B, which listens for any `bye`. If the `bye` window message is dispatched after `page.js` runs, it ends agent B, not the old agent. The `bye` comes from an IPC disconnect and the injection from a separate `executeScript` IPC, so nothing fixes their order. The worker then connects a new port and tells the panel `attached`, but no agent answers. The panel shows "attached" with an empty, dead view until the next load. A `bye` should end only the agent paired with the port that closed, for example with a per-attach token carried in both messages.
- evidence: read (the ordering is inferred, not run)
- severity: medium

## An attach that fails after `page.js` went in leaves that agent running in the page with no port
- where: apps/devtools/src/pair.ts:67 (attach, catch branch)
- scenario: `chrome.inject(tab, 'page.js', true)` succeeds, then the history-read `chrome.run` rejects (for example, the frame is navigating or the script result is lost). The catch branch reports `unreachable` and returns without calling `end()`. The `closed` path does call `end()`, so this path is the one that misses it. The agent from `page.js` stays subscribed to `watched()` and serving over window messages until the document unloads, and nothing will ever connect to it. The catch branch should call `end()` the way the `closed` branch does when the inject got that far.
- evidence: read
- severity: low

## A failed history toggle shows "This page can't be inspected" while the page is still attached
- where: apps/devtools/src/pair.ts:101 (panel onMessage, `history` branch); apps/devtools/src/panel.tsx:54
- scenario: Pressing "Reload with history" runs a `sessionStorage` write and then `chrome.tabs.reload`. If either one rejects (for example, `sessionStorage` throws on a sandboxed or opaque-origin page), the worker sends `{ ctl: 'unreachable' }`. The panel then shows the "can't be inspected" banner, yet the existing page port and agent keep working and nothing clears the banner until the next `attached`. The failure is only that history could not be set, so the banner gives the wrong reason.
- evidence: read
- severity: low

## The panel's toggle posts on a port that may be disconnected, and it is the only send without a guard
- where: apps/devtools/src/panel.tsx:59 (toggle)
- scenario: When the worker is stopped, the panel's port drops and `open()` reconnects only after 100 ms. A click on "Reload with history" or "Stop history" in that gap calls `port.postMessage` on the disconnected port, which throws "Attempting to use a disconnected port object". The click is lost, and the error goes uncaught in the React handler. `wire.send` and the ping both wrap the same call in try/catch, so this answers "post on a possibly dead port" a second, different way.
- evidence: read
- severity: low

## The button's tooltip hardcodes "10 s" instead of deriving it from HISTORY_MS
- where: apps/devtools/src/panel.tsx:65 (App)
- scenario: How much history the button asks for is decided in `names.ts` (`HISTORY_MS = 10_000`), and the tooltip answers it again as the literal "10 s". If `HISTORY_MS` changes, the tooltip states a duration the button no longer requests.
- evidence: read
- severity: low

## Files read
apps/devtools/src/devtools.ts
apps/devtools/src/names.ts
apps/devtools/src/page.ts
apps/devtools/src/pair.ts
apps/devtools/src/panel.css
apps/devtools/src/panel.tsx
apps/devtools/src/relay.ts
apps/devtools/src/start.ts
apps/devtools/src/worker.ts

<!-- done: 5 findings, files read: 9 -->
