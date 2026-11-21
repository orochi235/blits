import { watched } from '@msb235/blits';
import { describe, expect, it } from 'vitest';
import { createShow, cue, shell } from '../src/show.js';

describe('the fireworks show', () => {
  it('seeks back with no panel mounted, for the DevTools extension', () => {
    expect(watched().history).toBeUndefined();
    const m = createShow();
    m.sync(0);
    const s = shell(-3, 5);
    cue(m, s);
    for (let f = 16; f <= 800; f += 16) m.sync(f);
    const risen = m.probe(s).offset[1];
    m.sync(1600);
    m.seek(800);
    expect(m.now).toBe(800);
    expect(m.probe(s).offset[1]).toBeCloseTo(risen, 9);
  });
});
