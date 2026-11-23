import { coursesOf } from '@pg/blits/course';
import { flowOf } from '@pg/blits/flow';
import { outlineOf } from '@pg/blits/outline';
import { expect, it, vi } from 'vitest';
import { comp, subjects, voice } from './helpers';

const calls = vi.hoisted(() => [] as unknown[]);

vi.mock('@pg/blits/compile', async (original) => {
  const real = await original<typeof import('@pg/blits/compile')>();
  return {
    ...real,
    compile: (...a: Parameters<typeof real.compile>) => {
      calls.push(a[2]);
      return real.compile(...a);
    },
  };
});

// Registry events can't tell: a mix registers as it is made, and `listed: false` closes it at once.
it('compiles unlisted for courses, the outline and the flow', () => {
  const c = comp(
    ['a', 'b'].map((id) =>
      voice({
        id,
        patch: {
          kind: 'keys',
          period: 1000,
          stops: [
            { at: 0, delta: { glow: 0 } },
            { at: 1, delta: { glow: 1 } },
          ],
        },
      }),
    ),
  );
  coursesOf(c, subjects);
  expect(calls.splice(0)).toEqual([{ solos: true, listed: false }]);
  outlineOf(c);
  expect(calls.splice(0)).toEqual([{ listed: false }]);
  flowOf(c);
  expect(calls.length).toBeGreaterThan(0);
  expect(calls.every((o) => (o as { listed?: boolean }).listed === false)).toBe(true);
});
