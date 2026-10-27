import { hueColor, voiceHue } from './ui/hue.js';

const SVG = 'http://www.w3.org/2000/svg';

/** A bounded voice's circle, in the units of the positions the mix was given. */
export interface Ring {
  voice: number;
  x: number;
  y: number;
  r: number;
}

/** Where a point in the mix's positions is on screen, in client coordinates. */
export type Screen = (x: number, y: number) => { x: number; y: number };

const same: Screen = (x, y) => ({ x, y });

/** Draws each bounded voice's circle over the page, in the voice's hue. */
export class Circles {
  private svg: SVGSVGElement | null = null;

  draw(rings: readonly Ring[], screen: Screen = same): void {
    if (this.svg === null) {
      this.svg = document.createElementNS(SVG, 'svg');
      this.svg.setAttribute('data-blits-panel', 'circles');
      Object.assign(this.svg.style, {
        position: 'fixed',
        inset: '0',
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: '2147483646',
        overflow: 'visible',
      });
      document.body.appendChild(this.svg);
    }
    const svg = this.svg;
    while (svg.childNodes.length > rings.length) svg.lastChild?.remove();
    rings.forEach((ring, i) => {
      let c = svg.childNodes[i] as SVGCircleElement | undefined;
      if (c === undefined) {
        c = document.createElementNS(SVG, 'circle');
        c.setAttribute('fill', 'none');
        c.setAttribute('stroke-width', '1.5');
        c.setAttribute('stroke-dasharray', '6 4');
        svg.appendChild(c);
      }
      const at = screen(ring.x, ring.y);
      const edge = screen(ring.x + ring.r, ring.y);
      c.setAttribute('cx', String(at.x));
      c.setAttribute('cy', String(at.y));
      c.setAttribute('r', String(Math.hypot(edge.x - at.x, edge.y - at.y)));
      c.setAttribute('stroke', hueColor(voiceHue(ring.voice)));
    });
  }

  clear(): void {
    this.svg?.remove();
    this.svg = null;
  }
}
