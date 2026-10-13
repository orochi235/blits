import { describe, expect, it } from 'vitest';
import { kit, sum } from '../src/channels.js';
import { mix } from '../src/mixer.js';
import { patch } from '../src/patch.js';
import type { Handle } from '../src/types.js';

interface Pose {
  x: number;
}
const K = kit<Pose>({ x: sum() });

interface Part {
  id: number;
}

/**
 * Cues a voice per subject, stops those at `gone` in one frame, and checks the mix's list holds
 * the rest in the order they were cued, each still playing for its subject and no stopped one.
 */
function retire(n: number, gone: readonly number[], lanes: boolean): void {
  const m = mix<Part, Pose>(K, { lanes });
  const parts = Array.from({ length: n }, (_, id) => ({ id }));
  const hs: Handle<Part>[] = parts.map((p) =>
    m.cue({
      patch: patch(1000, () => ({ x: p.id + 1 }), { writes: ['x'] }),
      subjects: [p],
      loop: true,
    }),
  );
  const cued = () => (m as unknown as { cued: { id: number }[] }).cued.map((v) => v.id);
  m.sync(0);
  for (const p of parts) expect(m.probe(p).x).toBe(p.id + 1);
  const all = cued();
  expect(all.length).toBe(n);
  for (const i of gone) (hs[i] as Handle<Part>).fade({ over: 0 });
  m.sync(16);
  expect(cued()).toEqual(all.filter((_, i) => !gone.includes(i)));
  for (const t of [16, 32]) {
    m.sync(t);
    for (const p of parts)
      expect(m.probe(p).x, `subject ${p.id}`).toBe(gone.includes(p.id) ? 0 : p.id + 1);
  }
}

describe('voices stopped in one frame leave the list, and the rest keep their order', () => {
  for (const lanes of [true, false]) {
    const way = lanes ? 'lanes on' : 'lanes off';
    it(`a few among many, ${way}`, () => {
      retire(600, [0, 3, 599], lanes);
    });
    it(`more than a few among many, the first and the last with them, ${way}`, () => {
      retire(600, [0, 1, 2, 77, 78, 300, 301, 450, 598, 599], lanes);
      retire(600, [5, 6, 100, 101, 102, 103, 250, 400, 401, 402, 590, 597], lanes);
    });
    it(`most of them, ${way}`, () => {
      retire(
        600,
        Array.from({ length: 500 }, (_, i) => i + 50),
        lanes,
      );
    });
    it(`every one, ${way}`, () => {
      retire(
        40,
        Array.from({ length: 40 }, (_, i) => i),
        lanes,
      );
    });
  }
});
