# blits DevTools extension

A "blits" tab in Chrome DevTools for any page running blits: every mix on the page, its voices
and subjects, the picked subject's channels over time, and a clock to pause, step and scrub. It
shows the same window as `@msb235/blits-panel`'s `mount()`, but the app imports nothing.

## Install

```sh
npm run build -w @blits/devtools
```

Then in Chrome, open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked**
and pick `apps/devtools/dist`. After a rebuild, press the extension's reload button there.

## Use

Open DevTools on a page running blits and choose the **blits** tab. It finds mixes made by any
blits release that has `watched()`.

- **Scrubbing back** needs history, which most apps don't keep. Press **Reload with history**:
  the tab reloads, and every mix made from then on keeps 10 s of history. That lasts until the
  tab closes or you press **Stop history**. It is per origin, so going to another site or
  another localhost port needs the button again there.
- **Picking on the page** works for DOM subjects as it is. For a three.js scene, the app can
  hand over its own lookup with `offer({ pick, outline })` from `@msb235/blits-panel`.
- Top frame only: blits inside an iframe isn't shown.
- If the app also mounts the in-page panel, both run. Whichever holds a clock second shows "held
  elsewhere".

## How it works

| Piece | Runs in | Does |
|---|---|---|
| `start.js` | every page, as it starts, in the page's world | Reads the history mark from `sessionStorage`; if set, gives the page's mixes history. |
| `page.js` | the inspected page's world, once the tab connects | Runs the panel's `agent()` and speaks over `window` messages. |
| `relay.js` | the inspected page's isolated world, once the tab connects | Carries those messages to and from the worker. |
| `worker.js` | the extension's service worker | Pairs each DevTools tab with its page, and sets and clears the history mark. |
| `panel.html` | the DevTools tab | The panel's `Panel`, docked, talking through `wireSource`. |

Nothing but `start.js` runs on a page until its DevTools tab connects.

## Testing

`node apps/devtools/scripts/smoke.mjs` loads the built extension into headless Chromium, runs
`apps/fireworks` with `?nopanel`, and drives the panel page through picking, holding, stepping,
"Reload with history" and scrubbing. It launches a browser, so run it on the fleet:

```sh
onto do -kind test -gui -- sh -c "npm run build -w @blits/devtools && node apps/devtools/scripts/smoke.mjs"
```

## Chosen while building

Calls made while building, each the owner's to overturn (2026-10-19):

- Top frame only.
- It runs alongside `mount()` rather than hiding the in-page panel.
- History is added only when **Reload with history** is pressed, per origin, through a
  `sessionStorage` mark.
- It runs on all sites, but only `start.js` loads before a DevTools tab connects.
- The registry key's protocol number (`watch/1`) is the contract across engine releases.
- It is not on the Chrome Web Store; putting it there is the owner's call.
