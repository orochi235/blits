// <blits-logo>: the blits dot-matrix logo as a self-contained, animated custom element.
//
//   <script type="module" src="blits-logo.js"></script>
//   <blits-logo effect="sweep" panel glow></blits-logo>
//
// Attributes
//   variant  wordmark (default) | mark
//   effect   boot (default, plays once) | sweep | twinkle | pulse | chase | none
//   color    any CSS color; defaults to --blits-logo-color, then the brand green
//   panel    draw the dark panel behind the dots
//   field    show the unlit dots of the grid faintly, like a real display
//   glow     soft bloom around lit dots
// Size it with CSS width; height follows. Motion stops when prefers-reduced-motion is set
// and pauses while the logo is offscreen. play() restarts the effect.

import { COLOR, DOT, compose } from './glyphs.js';

const NS = 'http://www.w3.org/2000/svg';
// Opacity of the unlit grid, and the floor a lit dot dims to.
const FIELD = 0.07;
const FLOOR = 0.12;

// Deterministic per-dot noise, so every page shows the same twinkle.
const noise = (a, b) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const EFFECTS = {
  boot: {
    once: 1.6,
    level(d, t) {
      const start = d.col * 0.035 + d.n * 0.08;
      if (t < start) return 0;
      if (t < start + 0.14) return noise(d.n, Math.floor(t * 60)) > 0.45 ? 1 : 0.15;
      return 1;
    },
  },
  sweep: {
    level(d, t, g) {
      const period = 3.2, span = g.cols + 10;
      const x = ((t % period) / period) * span - 5;
      return 0.7 + 0.3 * Math.exp(-(((d.col - x) / 1.8) ** 2));
    },
  },
  twinkle: {
    level(d, t) {
      const dip = Math.max(0, Math.sin(t * (0.6 + d.n * 1.4) + d.n * 40)) ** 24;
      return 1 - 0.8 * dip;
    },
  },
  pulse: {
    level(_d, t) {
      return 0.68 + 0.32 * Math.cos((t * 2 * Math.PI) / 2.6);
    },
  },
  chase: {
    level(d, t, g) {
      const step = 0.32, cycle = g.letters * step + 0.8;
      const since = (t - d.letter * step + cycle) % cycle;
      return 0.4 + 0.6 * Math.exp(-since * 2.8);
    },
  },
};

const STYLE = `
  :host { display: inline-block; width: 12em; line-height: 0; }
  svg { width: 100%; height: auto; display: block; overflow: visible; }
`;

class BlitsLogo extends HTMLElement {
  static observedAttributes = ['variant', 'effect', 'color', 'panel', 'field', 'glow'];

  #root = this.attachShadow({ mode: 'open' });
  #dots = [];
  #grid = null;
  #frame = 0;
  #t0 = 0;
  #visible = true;
  #io = null;
  #motion = matchMedia('(prefers-reduced-motion: reduce)');
  #onMotion = () => this.play();

  connectedCallback() {
    this.#render();
    this.#io = new IntersectionObserver(([e]) => {
      this.#visible = e.isIntersecting;
      if (this.#visible) this.#tick();
    });
    this.#io.observe(this);
    this.#motion.addEventListener('change', this.#onMotion);
    this.play();
  }

  disconnectedCallback() {
    cancelAnimationFrame(this.#frame);
    this.#io?.disconnect();
    this.#motion.removeEventListener('change', this.#onMotion);
  }

  attributeChangedCallback() {
    if (!this.isConnected) return;
    this.#render();
    this.play();
  }

  /** Restart the current effect from its first frame. */
  play() {
    this.#t0 = performance.now();
    cancelAnimationFrame(this.#frame);
    this.#tick();
  }

  get #effect() {
    if (this.#motion.matches) return null;
    return EFFECTS[this.getAttribute('effect') ?? 'boot'] ?? null;
  }

  #render() {
    const mark = this.getAttribute('variant') === 'mark';
    const g = compose(mark ? 'b' : 'blits');
    const panel = this.hasAttribute('panel');
    const pad = panel ? (mark ? 1.5 : 2) : 0.2;
    const w = g.cols + 2 * pad, h = g.rows + 2 * pad;
    const size = mark ? Math.max(w, h) : 0;
    const vw = mark ? size : w, vh = mark ? size : h;
    const ox = (vw - g.cols) / 2, oy = (vh - g.rows) / 2;
    const color = this.getAttribute('color') ?? `var(--blits-logo-color, ${COLOR.green})`;

    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'blits');
    let body = '';
    if (this.hasAttribute('glow')) {
      body += `<defs><filter id="glow" x="-20%" y="-40%" width="140%" height="180%"><feGaussianBlur stdDeviation="0.22" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
    }
    if (panel) body += `<rect width="${vw}" height="${vh}" rx="${mark ? vw * 0.22 : 0.6}" fill="${COLOR.panel}"/>`;
    if (this.hasAttribute('field')) {
      const on = new Set(g.lit.map(([c, r]) => `${c},${r}`));
      body += `<g fill="${color}" opacity="${FIELD}">`;
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        if (!on.has(`${c},${r}`)) body += `<circle cx="${ox + c + 0.5}" cy="${oy + r + 0.5}" r="${DOT}"/>`;
      }
      body += '</g>';
    }
    body += `<g fill="${color}"${this.hasAttribute('glow') ? ' filter="url(#glow)"' : ''}>`;
    for (const [c, r] of g.lit) body += `<circle cx="${ox + c + 0.5}" cy="${oy + r + 0.5}" r="${DOT}"/>`;
    body += '</g>';
    svg.innerHTML = body;

    this.#root.innerHTML = `<style>${STYLE}</style>`;
    this.#root.append(svg);
    const circles = svg.querySelectorAll(`g[fill]:last-of-type circle`);
    this.#dots = g.lit.map(([col, row, letter], k) => ({ col, row, letter, n: noise(col, row), el: circles[k] }));
    this.#grid = { cols: g.cols, rows: g.rows, letters: mark ? 1 : 5 };
  }

  #tick = () => {
    const fx = this.#effect;
    const t = (performance.now() - this.#t0) / 1000;
    const done = !fx || (fx.once && t > fx.once);
    for (const d of this.#dots) {
      const v = done ? 1 : fx.level(d, t, this.#grid);
      d.el.setAttribute('opacity', (FLOOR + (1 - FLOOR) * v).toFixed(3));
    }
    if (!done && this.#visible) this.#frame = requestAnimationFrame(this.#tick);
  };
}

if (!customElements.get('blits-logo')) customElements.define('blits-logo', BlitsLogo);
