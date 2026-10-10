import { describe, expect, it } from 'vitest';
import { Leavings } from '../src/leavings.js';
import { record } from '../src/record.js';
import type { Left } from '../src/voice.js';

const a = { id: 'a' };
const b = { id: 'b' };
const left = (subject: unknown, at: number, seq: number, sync = false): Left<unknown> => ({
  subject,
  at,
  seq,
  sync,
  held: record(null, true, undefined),
});

describe('the records subjects left a voice with', () => {
  it('finds a subject’s first leaving after a cut, among its own', () => {
    const entries = [left(a, 10, 1), left(b, 20, 2), left(a, 30, 3), left('k', 30, 3)];
    const l = Leavings.from(entries) as Leavings<unknown>;
    expect(l.at(a, { seq: 0, strict: false })).toBe(entries[0]?.held);
    expect(l.at(a, { seq: 1, strict: false })).toBe(entries[2]?.held);
    expect(l.at(a, { seq: 3, strict: false })).toBeUndefined();
    expect(l.at(b, { seq: 1, strict: false })).toBe(entries[1]?.held);
    expect(l.at('k', { seq: 2, strict: false })).toBe(entries[3]?.held);
    expect(l.at({}, { seq: 0, strict: false })).toBeUndefined();
    expect(l.of(a)).toEqual([entries[0], entries[2]]);
  });

  it('lets go of what left before a reach, from the front, and hands each on', () => {
    const entries = Array.from({ length: 100 }, (_, i) => left(i % 2 === 0 ? a : b, i, i));
    const l = Leavings.from(entries) as Leavings<unknown>;
    const out: Left<unknown>[] = [];
    l.expire(70, (e) => out.push(e));
    expect(out).toEqual(entries.slice(0, 70));
    expect(l.all()).toEqual(entries.slice(70));
    expect(l.of(a)).toEqual(entries.slice(70).filter((e) => e.subject === a));
    expect(l.at(b, { seq: 0, strict: false })).toBe(entries[71]?.held);
    l.push(left(a, 100, 100));
    expect(l.all().length).toBe(31);
    // Before the first sync a mix's time is NaN, and nothing is kept past it.
    l.expire(Number.NaN, null);
    expect(l.all()).toEqual([]);
    expect(l.of(a)).toEqual([]);
  });

  it('is null for no entries', () => {
    expect(Leavings.from([])).toBeNull();
  });
});
