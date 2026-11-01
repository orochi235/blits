import {
  color,
  type Handle,
  hue,
  kit,
  mix,
  oklab,
  patch,
  saturation,
  toHex,
  transport,
} from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { loop } from '../loop';

/** One color token of one element: the custom property it sets, and the color it was designed in. */
interface Token {
  el: HTMLElement;
  prop: '--bg' | '--fg' | '--line';
  base: number;
}
interface Theme {
  brand?: number[];
  mute?: number[];
}

// The brand takes every token's hue and leaves its lightness and chroma, so a gray stays gray and
// contrast holds; the mute then takes the chroma away.
const THEME = kit<Theme>({ brand: color(hue()), mute: color(saturation()) });

const full = (rgb: number) => oklab(rgb);

const BRANDS = [
  { name: 'Indigo', rgb: 0x3b5bdb },
  { name: 'Teal', rgb: 0x0c8f80 },
  { name: 'Coral', rgb: 0xe0533d },
  { name: 'Plum', rgb: 0x9c36b5 },
];

const brand = (rgb: number) =>
  patch<Token, Theme>(0, () => ({ brand: full(rgb) }), { writes: ['brand'] });

/** Round the hue circle once over `ms`, at the chroma of indigo. */
const CYCLE = 8000;
const cycle = patch<Token, Theme>(
  CYCLE,
  (phase) => {
    const h = 2 * Math.PI * phase;
    return { brand: [0.5, 0.15 * Math.cos(h), 0.15 * Math.sin(h), 1] };
  },
  { writes: ['brand'] },
);

const mute = patch<Token, Theme>(0, () => ({ mute: [0.5, 0, 0, 1] }), { writes: ['mute'] });

/** The mock's markup: each element's class, its text, and its tokens as designed, in indigo. */
const PARTS: [string, string, Partial<Record<Token['prop'], number>>][] = [
  ['mock-bar', 'Dashboard', { '--bg': 0x3b5bdb, '--fg': 0xffffff }],
  ['mock-title', 'Weekly report', { '--fg': 0x1c2236 }],
  [
    'mock-text',
    'Signups rose 12% on the week, led by the new onboarding flow.',
    { '--fg': 0x596079 },
  ],
  ['mock-chip', 'Draft', { '--bg': 0xdbe4ff, '--fg': 0x2b44a8 }],
  ['mock-chip', 'Q4', { '--bg': 0xe9ecef, '--fg': 0x495057 }],
  ['mock-primary', 'Publish', { '--bg': 0x3b5bdb, '--fg': 0xffffff }],
  ['mock-secondary', 'Preview', { '--bg': 0xedf2ff, '--fg': 0x2b44a8, '--line': 0x91a7ff }],
  ['mock-link', 'View history', { '--fg': 0x3b5bdb }],
];

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

export default function run(root: HTMLElement): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'rig';
  const mock = document.createElement('div');
  mock.className = 'mock';
  const body = document.createElement('div');
  body.className = 'mock-body';
  const chips = document.createElement('div');
  chips.className = 'mock-row';
  const actions = document.createElement('div');
  actions.className = 'mock-row';
  const tokens: Token[] = [];
  let primary: HTMLElement | undefined;
  for (const [cls, text, props] of PARTS) {
    const el = document.createElement(
      cls === 'mock-title' ? 'h4' : cls === 'mock-text' ? 'p' : 'span',
    );
    el.className = cls;
    el.textContent = text;
    if (cls === 'mock-bar') mock.append(el);
    else if (cls === 'mock-chip') chips.append(el);
    else if (cls === 'mock-primary' || cls === 'mock-secondary') actions.append(el);
    else body.append(el);
    if (cls === 'mock-primary') primary = el;
    for (const [prop, base] of Object.entries(props))
      tokens.push({ el, prop: prop as Token['prop'], base: base as number });
  }
  body.insertBefore(chips, body.querySelector('.mock-link'));
  body.insertBefore(actions, body.querySelector('.mock-link'));
  mock.append(body);

  const row = document.createElement('div');
  row.className = 'rig-row';
  const button = (text: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    row.append(b);
    return b;
  };
  const brandButtons = BRANDS.map((b) => button(b.name));
  const cycleButton = button('Cycle');
  const muteButton = button('Disabled');
  const readout = document.createElement('p');
  readout.className = 'rig-read';
  wrap.append(mock, row, readout);
  root.append(wrap);

  const show = transport({ history: { ms: 2 * CYCLE, tape: createHistory } });
  const m = mix<Token, Theme>(THEME, { name: 'retheme', transport: show });

  // Brands share a role, so changing brand crossfades one hue into the next.
  const fade = { in: 700, out: 700 };
  let current: Handle | undefined;
  const pick = (i: number) => {
    current?.fade();
    const b = BRANDS[i];
    current = m.cue({
      patch: b === undefined ? cycle : brand(b.rgb),
      subjects: tokens,
      role: 'brand',
      loop: b === undefined,
      fade,
    });
    brandButtons.forEach((el, j) => {
      el.ariaPressed = String(j === i);
    });
    cycleButton.ariaPressed = String(b === undefined);
  };
  brandButtons.forEach((el, i) => el.addEventListener('click', () => pick(i)));
  cycleButton.addEventListener('click', () => pick(-1));

  let muted: Handle | undefined;
  muteButton.ariaPressed = 'false';
  muteButton.addEventListener('click', () => {
    if (muted === undefined)
      muted = m.cue({ patch: mute, subjects: tokens, fade: { in: 500, out: 500 } });
    else {
      muted.fade();
      muted = undefined;
    }
    muteButton.ariaPressed = String(muted !== undefined);
  });
  pick(-1);

  const NONE = [0, 0, 0, 0];
  const pose: Theme = {};
  let drawn = -1;
  const stop = loop(show, (now) => {
    show.sync(now);
    if (show.seq === drawn) return;
    drawn = show.seq;
    let fill = 0;
    for (const t of tokens) {
      m.probe(t, pose);
      const out = toHex(pose.mute ?? NONE, toHex(pose.brand ?? NONE, t.base));
      t.el.style.setProperty(t.prop, hex(out));
      if (t.el === primary && t.prop === '--bg') fill = out;
    }
    const L = oklab(fill)[0] ?? 0;
    readout.textContent = `Publish ${hex(fill)}   lightness ${L.toFixed(3)}, as designed ${(oklab(0x3b5bdb)[0] ?? 0).toFixed(3)}`;
  });

  return () => {
    stop();
    m.close();
  };
}
