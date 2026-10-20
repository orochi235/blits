# blits panel — design

**Unbuilt (2026-10-19).** Nothing here exists in the code yet.

**For:** whoever builds the in-page debugger for blits. **Answers:** what the panel is, how an
app adds it, what it shows, and what it can control.

## Why

`watched()` (engine 0.12 and later, unreleased; see the mix page's "Watching a mix") lets a
debugger find every mix on a page, read what the host reads each frame, and hold a mix's clock.
Nothing uses it yet. The panel is the first thing that does. A Chrome DevTools extension comes
later and hosts the same panel, so the panel must not assume it shares a page with the app it is
showing.

## Goals

- Any app adds it with one call, whatever framework the app uses (or none). klieg and sherpa
  don't use React; magicsmoke and wod do.
- It finds every mix on the page and shows one at a time:
  - the mix's voices
  - its subjects
  - the picked subject's channels plotted over the last few seconds
- It can hold the mix: pause, set a rate, step a frame, and scrub back and forth over what
  history reaches.
- You can pick a subject from a list, or by clicking it on the page.

## Non-goals

- The Chrome extension itself.
- Editing voices (fading, cueing, reweighting). Holding the clock is the only write, as in
  `watched()`.
- Hiding the panel in production builds. The app decides whether to import it.
- Per-voice solo plots like the playground's "thin line per voice". Those come from the
  playground cueing each voice into a mix of its own, which a debugger can't do to an app's mix.
  The panel plots the mix's value, plus each voice's `weightOf`.

## Anti-goals

- **The panel changes what the app shows**, other than through an explicit hold. It reads
  through `watch` and `read`, never `probe`.
- **The app's CSS leaks into the panel, or the panel's leaks into the app.**
- **Memory grows for as long as the panel is open.** Everything the panel keeps is capped.

## Decided in conversation

### How an app adds it

```ts
import { mount } from '@msb235/blits-panel';
const unmount = mount({ history: 10_000, pick });
```

- `mount()` is the only way in; no React component is exported. It creates a host element at
  the end of `document.body`, attaches a shadow root, and renders the panel there with a React
  root of its own.
- `unmount()` removes the element and frees any hold.

### Layout

- **Collapsed:** the panel starts as a small pill in a corner. It holds the picked mix's name,
  hold/pause, step, a scrub bar, and ⤢ to expand.
- **Expanded:** ⤢ opens a floating window, draggable and resizable, that collapses back to the
  pill.
  - **Top bar:** a mix picker (a menu of `watched().entries()` by name or label), hold and
    pause, rate, step, and the scrub bar over `hold.reach`…`now`.
  - **Left column:** subjects (searchable, by `label`), then voices (name, state and weight on
    the picked subject).
  - **Right side:** one plot per channel of the picked subject, then one of every voice's
    `weightOf`.
- **My call:** the expanded view is the floating window, not the drawer. The extension will be
  docked like a drawer anyway, since DevTools is.

### Picking a subject

- **From the list:** hovering a row outlines that subject on the page wherever the panel knows
  where it is.
- **On the page:** a pick button arms the pointer. With it armed:
  - hovering outlines the subject under the pointer
  - clicking picks it
  - Escape cancels
- **DOM subjects:** an `Element` subject is found from the elements under the pointer, and
  outlined by its `getBoundingClientRect()`.
- **Other subjects:** `mount({ pick })` takes an optional `(x, y) => unknown`, a function from a
  client point to a subject. magicsmoke would write it from its raycaster. Whatever it returns is
  picked if some mix lists it among its subjects. Such a subject has no outline unless the app
  also passes `outline?: (subject) => DOMRect | undefined`.

### History

- `mount()` sets `watched().history` to `{ ms: 10_000, tape: createHistory }` by default, so
  every mix made after it can scrub back 10 s.
  - `mount({ history: false })` leaves it unset.
  - `mount({ history: n })` sets the window to `n` ms.
- The app has to call `mount()` before it makes its mixes for this to reach them.
- A mix with no history, or with no tape, shows why in the window: "made before the panel",
  "has its own history", or "no tape". Its scrub bar only pauses and steps forward.
- A mix whose history the registry added says so: "history: 10 s, added by the panel".

### The seam between the panel and the page (decided: split now)

- The panel UI never touches a mix, a hold or a subject object. It talks to a **source**: an
  interface carrying only plain, structured-clonable data.
  - **Up from the page:** the list of mixes, frames for the picked subject, subject lists with
    labels, and the hold's state.
  - **Down to the page:** commands, such as pick a mix, pick a subject, take or free the hold,
    set the rate, step, seek, arm on-page picking, and outline a subject.
- **Subjects cross the seam as ids:** a page-side table numbers each subject the first time it
  is sent, and holds the subject itself weakly.
- **Two halves:** the page-side half (call it the agent) owns `watched()`, the holds, on-page
  picking and the outline overlay. The UI half owns the layout and the plots.
- `mount()` wires the two together in one page, with a direct in-memory source. The extension
  will later put a message channel between them, and doesn't need to change either half.

### Calls made after review (mine, Mike's to overturn)

- **Engine additions to `Watched`,** while the engine is still unreleased:
  - `channels`: the kit's channel names, so the panel plots each channel by name instead of
    guessing from pose shapes
  - a voice's `name` and `tags` beside each handle
  - `read(subject, at?)`, which reads through `project(at)` and so backfills a newly picked
    subject's plot from history, as far back as history reaches

  Each is public, tested, and in the changelog.
- **Time axis:**
  - Frames are plotted against mix time.
  - Frames that arrive while paused, at the same mix time, replace one another rather than
    piling up.
  - A seek back drops the frames ahead of the new time.
  - The window is the last 10 s of mix time, capped at 1,200 frames.
- **Where a pose comes from:**
  - The pose the host probed that frame, if it probed the picked subject.
  - Otherwise, one `read(subject)` per frame for the picked subject only, marked in the plot
    as "read, not shown". That covers a subject the host read through `pull`.
- **Holds:**
  - The top bar has one hold control. Taking the hold pauses the mix (rate 0); the rate and
    step controls only work while it is held.
  - Switching to a mix on another transport frees the current hold first.
  - If something else holds the clock, the control says "held elsewhere" and stays off.
  - Unmounting frees the hold.
- **Demo:** `apps/fireworks` mounts the panel in dev. It is plain TypeScript with one mix and no
  history of its own, so it shows `mount()` in an app without React, and the history default at
  work. The playground isn't the demo: it makes a mix per voice and sets its own history.

## Constraints

- **Location:** a new package at `packages/panel`, published as `@msb235/blits-panel` from
  `panel-v*` tags. It goes through the release workflow like `packages/quarks` and
  `packages/tone`:
  - its own CHANGELOG
  - a peer range on the engine, and a devDependency pinned exactly to the engine
  - the release check, extended to the new tag
  - its first publish needs npm trusted publishing set up for the new package name, which only
    Mike can do
- **Dependencies:** `react`, `react-dom`, `@weasel-js/ui`, `@weasel-js/core` and
  `@weasel-js/history`, pinned exactly to the versions the playground uses (1.11.0 for weasel).
  Weasel is Mike's, and his packages get exact pins.
- **One plot component:** `ChannelPlot` and `hue.ts` move from `apps/playground/src/widgets`
  into the panel package. The playground's `Inspector` imports them from there, so the same
  plot is never kept in two places.
- **Theme:** weasel's `ThemeProvider` in auto mode, inside the shadow root, so the panel follows
  the system's light or dark setting rather than the app's.
- **Bounded memory:**
  - The plotted window is the last 10 s of frames (or the history window, if longer), capped at
    1,200 frames.
  - Only the picked subject's poses and the voices' weights on it are kept.
  - Changing the pick, or the mix, clears what was kept.

## Left to the builder

- The file layout inside the package, and how state flows (a small store driven by `watch`
  callbacks is the obvious fit).
- How the scrub bar maps a drag to `hold.seek`, and how often it seeks while dragging.
- How the pill and the window remember position and size across reloads (`localStorage`,
  guarded, as a per-viewer convenience).
- **Tests:**
  - the frame store's caps
  - mount and unmount leave the page as they found it
  - picking a DOM subject
  - the history default, and `history: false`
  - a playground smoke run with the panel mounted, on the fleet

## Hazards

- **The engine is unreleased.** The panel depends on `watched()`, so it ships after the next
  engine release, pinned to it.
