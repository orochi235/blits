# blits logo

The blits wordmark and its `b` mark, drawn as dots on a 7-row grid like an LED display.
`glyphs.js` defines the grid. Everything else is built from it.

| File | Use |
|---|---|
| `out/wordmark-green.svg` | on dark backgrounds |
| `out/wordmark-black.svg` | on light backgrounds |
| `out/wordmark-white.svg` | on color or photos |
| `out/wordmark-panel.svg`, `-glow` | the wordmark on its own dark panel |
| `out/mark-panel.svg` | app icon, avatar: the `b` on a rounded dark tile (also `-square`, `-circle`) |
| `out/mark-{green,black,white}.svg` | the `b` with no tile |
| `out/favicon.ico` | 16, 32 and 48 px |
| `out/png/` | every one of the above as PNG, at icon sizes and 1×, 2× and 4× |

The green is `#B2E81B` and the panel is `#0C0F0A`. Green on white is too faint to read;
on a light background use the black version.

## Animated

`blits-logo.js` is a custom element with no dependencies. It needs `glyphs.js` next to it.

```html
<script type="module" src="blits-logo.js"></script>
<blits-logo effect="sweep" panel glow></blits-logo>
```

| Attribute | Values |
|---|---|
| `variant` | `wordmark` (default), `mark` |
| `effect` | `boot` (default, plays once), `sweep`, `twinkle`, `pulse`, `chase`, `none` |
| `color` | any CSS color; defaults to `--blits-logo-color`, then the brand green |
| `panel` | draws the dark panel behind the dots |
| `field` | shows the unlit dots faintly |
| `glow` | a soft bloom around lit dots |

Set its size with CSS `width`. It holds still under `prefers-reduced-motion`, pauses while it is
offscreen, and `play()` restarts the effect. `demo.html` shows every option.

## Rebuilding

`node brand/build.mjs` rewrites `out/`. PNGs need `resvg` and the favicon needs `magick`.
