import { parsed } from '@pg/app/PatchPanel';
import { describe, expect, it } from 'vitest';

describe("a motion option's text", () => {
  it('keeps a finite number or list as a literal', () => {
    expect(parsed('120')).toBe(120);
    expect(parsed('[0, -40]')).toEqual([0, -40]);
    expect(parsed(' ')).toBeUndefined();
  });

  it('keeps a number JSON cannot hold as an expression, so it saves as typed', () => {
    expect(parsed('1e999')).toEqual({ code: '1e999' });
    expect(parsed('[0, 1e400]')).toEqual({ code: '[0, 1e400]' });
    expect(JSON.parse(JSON.stringify(parsed('1e999')))).toEqual({ code: '1e999' });
  });
});
