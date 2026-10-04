import {
  type Composition,
  MAX_COLS,
  MAX_LENGTH,
  MAX_LEVELS,
  MAX_ROWS,
  MAX_TEXT,
  MAX_VOICES,
} from '@pg/blits/composition';
import { fromHash, load, toHash } from '@pg/blits/load';
import { DEFAULT } from '@pg/blits/presets';
import { describe, expect, it } from 'vitest';

const copy = (): Composition => JSON.parse(JSON.stringify(DEFAULT));
const voice = () => copy().voices[0] as unknown as Record<string, unknown>;
const withVoice = (patch: Record<string, unknown>) => ({
  ...copy(),
  voices: [{ ...voice(), ...patch }],
});

describe('load', () => {
  it('accepts a good composition', () => {
    expect(load(copy())).toEqual(DEFAULT);
  });

  it('accepts every patch kind and the optional voice fields', () => {
    const kinds = [
      { kind: 'fn', period: 0, writes: ['glow'], at: '(p) => ({ glow: p })', state: '(s) => 0' },
      { kind: 'spring', channel: 'offset', opts: { to: [0, 4], stiffness: 120 } },
      { kind: 'glide', channel: 'turn', opts: { from: { code: '(s) => s.col' } } },
      { kind: 'tween', channel: 'scale', opts: { from: 1, to: 2, ms: 300 }, ease: 'ease-out' },
    ];
    for (const patch of kinds) expect(load(withVoice({ patch }))).not.toBeNull();
    const extras = {
      target: { code: '(s) => true' },
      hold: 'after',
      locus: 'a',
      from: 'current',
      weight: 0.5,
      loop: 3,
      fade: { in: 1, out: 2, ease: { bezier: [0, 0, 1, 1] } },
      anchor: { start: { after: 'wave', by: 100 } },
    };
    expect(load(withVoice(extras))).not.toBeNull();
    expect(load({ ...copy(), stage: { kind: 'letters', text: 'hi' } })).not.toBeNull();
  });

  it('refuses a wrong version, a missing field, or junk', () => {
    expect(load({ ...DEFAULT, version: 2 })).toBeNull();
    const { voices: _, ...noVoices } = DEFAULT;
    expect(load(noVoices)).toBeNull();
    expect(load({ ...DEFAULT, voices: [{ id: 'x' }] })).toBeNull();
    expect(load('nope')).toBeNull();
    expect(load(null)).toBeNull();
    expect(load([])).toBeNull();
  });

  it('refuses a bad stage, level or voice field', () => {
    const bad: unknown[] = [
      { ...copy(), stage: { kind: 'dots', cols: 12 } },
      { ...copy(), stage: { kind: 'dots', cols: 0, rows: 3 } },
      { ...copy(), stage: { kind: 'grid', cols: 2, rows: 2 } },
      { ...copy(), stage: { kind: 'letters' } },
      { ...copy(), length: -1 },
      { ...copy(), levels: [{ name: 'lift', value: 1 }] },
      { ...copy(), voices: [voice(), voice()] },
      withVoice({ hue: '210' }),
      withVoice({ loop: 'yes' }),
      withVoice({ weight: 'level("lift")' }),
      withVoice({ weight: {} }),
      withVoice({ stagger: '(s) => 1' }),
      withVoice({ fade: undefined }),
      withVoice({ fade: { in: '400' } }),
      withVoice({ fade: { ease: 'bounce' } }),
      withVoice({ hold: 'always' }),
      withVoice({ from: 'start' }),
      withVoice({ locus: 3 }),
      withVoice({ anchor: 'wave' }),
      withVoice({ patch: { kind: 'keys', period: 1200 } }),
      withVoice({ patch: { kind: 'keys', period: 1200, stops: [{ at: 0 }] } }),
      withVoice({ patch: { kind: 'keys', period: 1200, stops: [], ease: 'wobbly' } }),
      withVoice({ patch: { kind: 'fn', period: 0, writes: ['size'], at: '() => ({})' } }),
      withVoice({ patch: { kind: 'fn', period: 0, writes: [] } }),
      withVoice({ patch: { kind: 'spring', channel: 'size', opts: {} } }),
      withVoice({ patch: { kind: 'spring', channel: 'turn', opts: { to: 'far' } } }),
      withVoice({ patch: { kind: 'shake', period: 1 } }),
    ];
    for (const c of bad) expect(load(c), JSON.stringify(c).slice(0, 200)).toBeNull();
  });
});

describe('the caps', () => {
  const voices = (n: number) => Array.from({ length: n }, (_, i) => ({ ...voice(), id: `v${i}` }));
  const levels = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ name: `l${i}`, value: 0, min: 0, max: 1 }));
  const dots = (cols: number, rows: number) => ({ ...copy(), stage: { kind: 'dots', cols, rows } });
  const text = (n: number) => ({ ...copy(), stage: { kind: 'letters', text: 'é'.repeat(n) } });

  it('accepts a composition at every cap', () => {
    expect(load(dots(MAX_COLS, MAX_ROWS))).not.toBeNull();
    expect(load(text(MAX_TEXT))).not.toBeNull();
    expect(load({ ...copy(), length: MAX_LENGTH })).not.toBeNull();
    expect(load({ ...copy(), voices: voices(MAX_VOICES) })).not.toBeNull();
    expect(load({ ...copy(), levels: levels(MAX_LEVELS) })).not.toBeNull();
  });

  it('refuses one past any cap, and a length of zero', () => {
    expect(load(dots(MAX_COLS + 1, 1))).toBeNull();
    expect(load(dots(1, MAX_ROWS + 1))).toBeNull();
    expect(load(text(MAX_TEXT + 1))).toBeNull();
    expect(load({ ...copy(), length: MAX_LENGTH + 1 })).toBeNull();
    expect(load({ ...copy(), length: 0 })).toBeNull();
    expect(load({ ...copy(), voices: voices(MAX_VOICES + 1) })).toBeNull();
    expect(load({ ...copy(), levels: levels(MAX_LEVELS + 1) })).toBeNull();
  });
});

describe('the share hash', () => {
  it('round-trips a composition, characters base64 spells with + and / included', () => {
    const c = { ...copy(), title: 'wave ~~~ ??? > é 日本' };
    expect(Buffer.from(JSON.stringify(c)).toString('base64')).toMatch(/[+/]/);
    const hash = toHash(c);
    expect(hash).toMatch(/^c=[\w-]+$/);
    expect(fromHash(`#${hash}`)).toEqual(c);
  });

  it('gives null for garbage, a missing key, or an invalid composition', () => {
    expect(fromHash('#c=garbage')).toBeNull();
    expect(fromHash('')).toBeNull();
    expect(fromHash('#x=1')).toBeNull();
    expect(fromHash(`#c=${Buffer.from([0xff, 0xfe]).toString('base64url')}`)).toBeNull();
    expect(fromHash(`#${toHash({ ...copy(), version: 2 } as never)}`)).toBeNull();
  });
});

describe('load levels', () => {
  const withLevels = (levels: unknown[]) => ({ ...copy(), levels });
  const lv = (over: Record<string, unknown> = {}) => ({
    name: 'a',
    value: 0.5,
    min: 0,
    max: 1,
    ...over,
  });

  it('accepts a level whose value sits at a bound', () => {
    expect(load(withLevels([lv({ value: 1 })]))).not.toBeNull();
  });

  it.each([
    ['min at max', lv({ min: 1, max: 1, value: 1 })],
    ['min above max', lv({ min: 2, max: 1, value: 1 })],
    ['value below min', lv({ value: -1 })],
    ['value above max', lv({ value: 2 })],
    ['blank name', lv({ name: '  ' })],
  ])('refuses %s', (_, level) => {
    expect(load(withLevels([level]))).toBeNull();
  });

  it('refuses duplicate names', () => {
    expect(load(withLevels([lv(), lv()]))).toBeNull();
  });
});
