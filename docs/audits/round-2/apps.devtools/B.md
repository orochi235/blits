# apps.devtools findings

Note: the tree is at 836ce269, not the named 0d1aa23 (that object is absent here); `apps/devtools` has no uncommitted changes and no commits in the last week, so the code read is the area's current state.

## A re-attach to a live document can end the new agent with the old port's `bye`
- where: apps/devtools/src/pair.ts:50 (pair/attach), apps/devtools/src/relay.ts:18-21, apps/devtools/src/page.ts:30-31 (start)
- scenario: `attach()` runs while the tab's current document still has the relay and an agent: a `status: 'complete'` update that is not a new document (same-document navigation or a bfcache restore), or a quick DevTools-panel reload, where the old pair's teardown and the new pair's inject overlap. `attach` disconnects the old page port first; the relay's `onDisconnect` posts `{ source: TAG, bye: true }` as a window-message task. `attach` then injects `page.js`, whose `start()` ends the old agent and installs a new one with its own `bye` listener. The `bye` listener accepts any `bye`, not one tied to its own port, so if the queued `bye` is dispatched after `page.js` runs (window-message tasks and `executeScript` injection have no guaranteed order), it ends the new agent. The worker then connects, tells the panel `attached`, and the relay forwards the panel's requests to a page with no agent listening: the panel shows attached but never updates and gets no `unreachable`. Should: a `bye` from a port only ends the agent that port served (e.g. a generation number carried in the relay's messages, or `start()` ignoring a `bye` already queued before it ran).
- evidence: read (message flow); the task ordering is inference, not observed
- severity: medium

## "Reload with history" throws instead of sending while the panel's port is reopening
- where: apps/devtools/src/panel.tsx:58-59 (App/toggle)
- scenario: Chrome stops the idle worker or it restarts; the port disconnects and `open()` is deferred 100 ms (line 22). A click on the button in that window calls `port.postMessage` on the disconnected port, which throws "Attempting to use a disconnected port object"; the click is lost with an uncaught error in the panel and no feedback. `wire.send` and the ping (lines 26-34) guard the same call with try/catch, so the two paths answer "what to do when the port is down" differently. Should: send through the guarded path (or queue until reopened).
- evidence: read
- severity: low

## The button's tooltip hard-codes "10 s" instead of reading `HISTORY_MS`
- where: apps/devtools/src/panel.tsx:65 (App)
- scenario: `HISTORY_MS` in names.ts:4 decides how much history the reload asks for, and pair.ts:90 defaults to it; the tooltip states the amount separately as the literal "10 s". Changing `HISTORY_MS` leaves the tooltip promising a different amount than the page gets. Should: format the tooltip from `HISTORY_MS`.
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

<!-- done: 3 findings, files read: 9 -->
