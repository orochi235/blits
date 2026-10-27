# @msb235/blits-panel

A debugger window for [blits](https://github.com/orochi235/blits). It finds every mix on the page,
plots the channels of a subject you pick, and takes a mix's clock so you can pause it, step it a
frame at a time and scrub it back and forth.

```sh
npm install -D @msb235/blits-panel
```

```ts
import { mount } from '@msb235/blits-panel';

if (import.meta.env.DEV) mount();
// …then make your mixes.
```

Call `mount()` before the app makes its mixes. Mixes made after it keep 10 s of history, which
scrubbing back needs; a mix made earlier can only be paused and stepped forward. The panel says
which applies to the mix you are looking at.

The panel lives in a shadow root, so the app's styles and the panel's stay apart, and it works
whatever the app is built with. `mount()` returns a function that takes it off the page again and
gives back any clock it holds.

## What it shows

- **The pill:** the mix's name, hold (⏸), step (⏭), a scrub bar, ⤢ to open the window, and the
  mix clock.
- **The window:**
  - **Top bar:** a mix picker, the same clock controls, and a rate for a held mix.
  - **Left side:** the mix's subjects, which you can filter, and its voices with their state and
    their weight on the picked subject.
  - **Right side:** one plot per number in the picked subject's pose, then each voice's weight.
    A plot is marked "read, not shown" when the app did not read the subject that frame, so the
    panel read it.
  - **◯ circles**, beside the voices: draws each bounded voice's circle (its `within`, or its
    `around` weight's) on the page, in the voice's hue. A bounded voice is marked ◯ in the list.

Holding a mix holds every mix on the same transport. Nothing the panel does while holding goes on
the mix's tape, and freeing the hold lets the mix carry on from where the panel left it.

## Picking a subject

Pick from the list, or press **◎ pick** and click the subject on the page; Escape cancels. A
subject that is a DOM element, or contains the element you click, is found on its own. For
anything the DOM cannot see, such as a three.js object, pass the app's own lookup:

```ts
mount({
  pick: (x, y) => objectUnderPointer(x, y), // client coordinates in, a subject out
  outline: (subject) => screenBoxOf(subject), // optional: a DOMRect to outline it by
});
```

`offer({ pick, outline, screen })` hands over the same functions without mounting anything, so the
blits DevTools extension can pick in the scene too.

Subjects are named by the mix's `labelOf` option where it has one, and otherwise by their `name`
or `id`, a DOM element's tag, or their class and a number.

## Options

| Option | Default | What it does |
|---|---|---|
| `history` | `10000` | How far back mixes made after `mount()` can scrub, in ms. `false` adds no history. |
| `pick` | none | Finds the subject under a point, for subjects the DOM cannot see. |
| `outline` | none | Where a subject is on screen, so hovering it can outline it. |
| `screen` | the same numbers | Where a point in the positions given to `mix.plot` is on screen, in client coordinates, so a bounded voice's circle lands in the right place. |

## The two halves

The window never touches a mix. It talks to a `Source`: events up from the page and commands
down to it, all plain data. `agent()` is the page side and `Panel` the window. `mount()` joins
them in one page. Across a channel, `serve(agent(), wire)` runs on the page side and
`wireSource(wire)` on the panel's, where a `Wire` is anything that sends and receives strings; the
blits DevTools extension in `apps/devtools` does this.
