import { describe, expect, it } from 'vitest';
import { penner as reference } from '../scripts/penner/reference.mjs';
import { curve, curveData } from '../src/easing.js';
import { type PennerName, penner } from '../src/penner.js';

const names = Object.keys(reference) as PennerName[];

describe("Penner's curves by name", () => {
  it('names every curve the reference has, and nothing else', () => {
    expect(Object.keys(penner).sort()).toEqual([...names].sort());
  });

  it.each(names)(
    '%s stays within its tolerance of the function, ends on 0 and 1, and packs for the GPU',
    (name) => {
      const c = curve(name);
      const f = reference[name] as (t: number) => number;
      const tol = 'bezier' in penner[name] ? 0.003 : 0.001;
      let worst = 0;
      for (let i = 0; i <= 2000; i++) {
        const u = i / 2000;
        worst = Math.max(worst, Math.abs(c(u) - f(u)));
      }
      expect(worst).toBeLessThanOrEqual(tol);
      expect(c(0)).toBeCloseTo(0, 6);
      expect(c(1)).toBeCloseTo(1, 6);
      expect(curve(name)).toBe(c);
      expect(curveData(c)).toBeDefined();
    },
  );

  it('hands its data to hosts from the package root', async () => {
    const root = await import('../src/index.js');
    expect(root.penner).toBe(penner);
    expect(root.penner.easeOutBack).toEqual(penner.easeOutBack);
  });

  it('refuses a name that is not one', () => {
    expect(() => curve('easeInNothing' as PennerName)).toThrow(/no easing named/);
  });
});
