import { kit, mix, sum } from '@msb235/blits';
import { ParticleSystem } from 'three.quarks';
import { describe, expect, it } from 'vitest';
import * as quarks from '../src/index.js';

describe('the package', () => {
  it('resolves the engine from source and three.quarks from the workspace', () => {
    const m = mix<string, { n: number }>(kit({ n: sum() }));
    m.sync(0);
    expect(m.probe('a').n).toBe(0);
    expect(typeof ParticleSystem).toBe('function');
    expect(quarks).toBeTypeOf('object');
  });
});
