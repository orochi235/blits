import { compile } from '@pg/blits/compile';
import type { Composition, PatchSource } from '@pg/blits/composition';
import { COLOR_RULES } from '@pg/blits/kit';
import { load } from '@pg/blits/load';
import { Player } from '@pg/blits/player';
import { describe, expect, it } from 'vitest';
import { comp, step, subjects, voice } from './helpers';

const fnVoice = (writes: string[], at: string) =>
  comp([voice({ id: 'a', patch: { kind: 'fn', period: 1000, writes, at } as PatchSource })]);

const playerOf = (c: Composition) =>
  new Player((listed) => compile(c, subjects, { solos: true, listed }), subjects, {
    levels: c.levels,
    listed: false,
  });

describe("an fn patch's values", () => {
  it.each([
    ['a string color', ['color'], "() => ({ color: '#ff0000' })", 'color'],
    ['a number offset', ['offset'], '() => ({ offset: 5 })', 'offset'],
    ['a string glow', ['glow'], "() => ({ glow: 'x' })", 'glow'],
    [
      'a color gone wrong later',
      ['color'],
      "(p) => (p > 0.5 ? { color: 'x' } : { color: 0xff0000 })",
      'color',
    ],
  ])('count %s as a fault and rest the channel', (_, writes, at, ch) => {
    const p = playerOf(fnVoice(writes, at));
    step(p, 60);
    const faults = p.built.faults.get('a');
    expect(faults?.count).toBeGreaterThan(0);
    expect(faults?.first).toMatch(new RegExp(`^at ${ch} takes`));
    // An unwritten `replace` color pulls as NaN, so only the number channels are checked.
    for (const k of ['offset', 'glow'] as const)
      expect([...p.columns[k]].every(Number.isFinite)).toBe(true);
  });

  it('take a good value without a fault', () => {
    const p = playerOf(fnVoice(['color'], '() => ({ color: 0xff0000 })'));
    step(p, 10);
    expect(p.built.faults.get('a')?.count).toBe(0);
  });
});

describe('a color under every rule', () => {
  const ruled = (c: Composition, rule: string, type: string) =>
    ({ ...c, rules: { color: { rule, type } } }) as Composition;
  for (const type of ['color', 'ink'] as const)
    for (const rule of COLOR_RULES) {
      it(`takes an fn patch's good value under ${type} ${rule}`, () => {
        const p = playerOf(ruled(fnVoice(['color'], '() => ({ color: 0xff0000 })'), rule, type));
        step(p, 10);
        const faults = p.built.faults.get('a');
        expect(faults?.count, String(faults?.first)).toBe(0);
      });
      it(`rests a motion whose target throws under ${type} ${rule}`, () => {
        const spring = {
          kind: 'spring',
          channel: 'color',
          opts: { to: { code: '() => { throw 1 }' } },
        };
        const p = playerOf(
          ruled(comp([voice({ id: 'a', patch: spring as PatchSource })]), rule, type),
        );
        step(p, 10);
        expect(p.built.errors).toEqual([]);
      });
    }
});

describe('a keys stop', () => {
  const keyed = (delta: unknown) =>
    load(
      JSON.parse(
        JSON.stringify(
          comp([
            voice({
              id: 'a',
              patch: { kind: 'keys', period: 1000, stops: [{ at: 0, delta }] } as PatchSource,
            }),
          ]),
        ),
      ),
    );

  it.each([
    ['a string color', { color: '#ff0000' }],
    ['a number offset', { offset: 5 }],
    ['an offset of three', { offset: [1, 2, 3] }],
    ['a string glow', { glow: 'x' }],
    ['an unknown channel', { size: 1 }],
  ])('refuses %s', (_, delta) => {
    expect(keyed(delta)).toBeNull();
  });

  it('takes numbers and an offset pair', () => {
    expect(keyed({ color: 0xff0000, offset: [1, 2], glow: 0.5 })).not.toBeNull();
  });
});

describe('a Player whose mix throws on a pull', () => {
  it('keeps playing and reports it on the voice', () => {
    const c = fnVoice(['glow'], '(p) => ({ glow: p })');
    let throwing = false;
    const p = new Player(
      (listed) => {
        const b = compile(c, subjects, { solos: true, listed });
        for (const m of [b.mix, ...b.solos.values()]) {
          const pull = m.pull.bind(m);
          m.pull = (...a) => {
            if (throwing) throw new Error('boom');
            return pull(...a);
          };
        }
        return b;
      },
      subjects,
      { levels: c.levels, listed: false },
    );
    throwing = true;
    expect(() => step(p, 3)).not.toThrow();
    expect(() => p.rebuild()).not.toThrow();
    expect(p.built.errors).toContainEqual({
      voice: 'a',
      field: 'patch',
      error: 'boom',
      line: null,
    });
  });

  it('reads a throwing solo as no frame and reports it on the voice', () => {
    const c = fnVoice(['glow'], '(p) => ({ glow: p })');
    const p = playerOf(c);
    step(p, 3);
    const solo = p.built.solos.get('a');
    if (!solo) throw new Error('no solo');
    solo.pull = () => {
      throw new Error('boom');
    };
    expect(() => p.solo('a', Player.columnsFor(subjects.length))).not.toThrow();
    expect(p.built.errors).toContainEqual({
      voice: 'a',
      field: 'patch',
      error: 'boom',
      line: null,
    });
  });
});
