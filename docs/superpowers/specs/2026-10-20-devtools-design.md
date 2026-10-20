# blits DevTools extension — design

**Unbuilt (2026-10-20).** Nothing here exists in the code yet.

**For:** whoever builds the Chrome extension. **Answers:** how a DevTools tab shows the blits
panel for any page running blits, with no change to the app.

## What it is

A Chrome extension (Manifest V3) that adds a "blits" tab to DevTools. The tab shows the same
`Panel` UI as `@msb235/blits-panel`'s `mount()`, but in the DevTools window instead of over the
page. It works on any page whose blits has `watched()`, without the app importing anything.

## Decided in conversation

- **The extension brings its own agent.** A content script runs `agent()` from the panel package
  in the page's own JavaScript world and finds mixes through `watched()`'s shared global
  registry, which every blits copy on the page uses.
- **`offer({ pick, outline })`,** exported from the panel package, lets an app hand its own
  `pick` and `outline` to whatever agent is on the page: `mount()`'s, or the extension's. An
  agent reads what was offered when it needs it. `mount()` options still win.
- **History when asked.** The DevTools tab has a "Reload with history" button. It marks the tab's
  `sessionStorage`, then reloads. On each page start in that tab, the page script sees the mark
  and sets `watched().history` to 10 s with a tape, before the page's mixes exist. "Stop history"
  clears the mark. Without the mark, the extension adds nothing.

## Calls made (mine, Mike's to overturn)

- **Location:** `apps/devtools`, a private workspace. It is not published to npm or the Chrome
  Web Store; publishing is Mike's call. `npm run build -w @blits/devtools` writes an unpacked
  extension to `apps/devtools/dist` for "Load unpacked".
- **Chrome only,** Manifest V3.
- **Message path:** page script (world `MAIN`) → `window.postMessage` → relay content script
  (isolated world) → a `chrome.runtime` port → service worker, which pairs each tab's relay with
  that tab's DevTools panel → panel page. Commands go back the same way. Everything crossing is
  the panel protocol's plain data.
- **The page script costs nothing until a DevTools tab connects.** At page start it only checks
  the history mark. The agent starts when the panel connects and is disposed of when it
  disconnects.
- **The panel package exports `Panel`** (the UI) and a `portSource`, which adapts a message port
  to the `Source` protocol, so the extension and any later host don't need their own copies.
- **Theme:** the DevTools tab follows the system's light or dark setting, as the in-page panel
  does.
- **Top frame only.** Blits inside an iframe isn't shown. Each frame has its own registry, and
  showing several would need a frame field throughout the protocol.
- **Alongside `mount()`:** if the app also mounts the in-page panel, both run. They share one
  registry, and whichever holds a clock second shows "held elsewhere". Nothing hides the in-page
  panel while DevTools is connected.
- **Across blits releases:** the registry key's protocol number (`watch/1`) is the contract. A
  later engine may add methods to an entry but not change existing ones without bumping that
  number. The agent checks for any method added after `watch/1` before calling it, so the
  extension works with every engine on protocol 1.
- **History is per origin:** the mark lives in `sessionStorage`, so navigating the tab to
  another origin (another port included) goes without history until "Reload with history" is
  pressed there. The button says whether the current page has history.
- **Runs on all sites,** cheaply. The script registered at `document_start` is a few lines that
  check the mark and, if it is set, put the history default on the registry. The agent bundle is
  injected only when a DevTools tab connects (`chrome.scripting.executeScript`, world `MAIN`), so
  the extension needs the `scripting` permission and access to all hosts.
- **The DevTools tab fills its window:** `Panel` gets a docked layout, with no pill and no
  dragging.
- **Messages are JSON:** Chrome's extension messaging sends JSON, so `portSource` encodes the
  protocol's `NaN` values and decodes them on the other side.
- **`offer()` is a versioned global slot,** keyed like the registry.
- **Tests:**
  - unit tests for the service worker's pairing and for `portSource`
  - a headless Chromium run on the fleet that loads the unpacked extension, opens fireworks,
    opens the panel page for that tab, and picks, holds and steps

  DevTools itself can't be driven from Playwright, so the panel page also accepts `?tab=<id>`
  for that run.
