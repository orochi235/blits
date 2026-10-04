import { level } from '@msb235/blits';
import { compileExpr } from '@pg/blits/expr';
import { type Subject, subjectsOf } from '@pg/blits/stage';
import { describe, expect, it } from 'vitest';

const scope = { level: () => level<Subject>() };

describe('compileExpr', () => {
  it('compiles an arrow function of the subject', () => {
    const r = compileExpr<(s: { col: number }) => number>({ code: '(s) => s.col * 80' }, scope, 0);
    if ('error' in r) throw new Error(r.error);
    expect(r.fn({ col: 2 })).toBe(160);
  });

  it('reports a syntax error with no function', () => {
    const r = compileExpr({ code: '(s) => s.col *' }, scope, 0);
    expect('error' in r && r.error.length > 0).toBe(true);
  });

  it('reports the author line of a throw while evaluating', () => {
    const r = compileExpr({ code: '(\n(() => { throw new Error("early"); })())' }, scope, 0);
    expect(r).toEqual({ error: 'early', line: 2 });
  });

  it('reports code that is not a function', () => {
    const r = compileExpr({ code: '42' }, scope, 0);
    expect(r).toEqual({ error: 'must be a function', line: null });
  });

  it('rests a call that throws, counts it, and keeps the first message', () => {
    const r = compileExpr<(s: { col: number }) => number>(
      { code: '(s) => { if (s.col > 0) throw new Error("boom " + s.col); return 1; }' },
      scope,
      0,
    );
    if ('error' in r) throw new Error(r.error);
    expect(r.fn({ col: 0 })).toBe(1);
    expect(r.fn({ col: 1 })).toBe(0);
    expect(r.fn({ col: 2 })).toBe(0);
    expect(r.faults).toEqual({ count: 2, first: 'boom 1' });
  });

  it('keeps answering for the rest of a stage when some subjects throw', () => {
    const subjects = subjectsOf({ kind: 'dots', cols: 4, rows: 3 });
    const r = compileExpr<(s: Subject) => number>(
      { code: '(s) => (s.col < 2 ? s.col * 80 : s.col.foo.bar)' },
      scope,
      -1,
    );
    if ('error' in r) throw new Error(r.error);
    const out = subjects.map((s) => r.fn(s));
    expect(out).toEqual(subjects.map((s) => (s.col < 2 ? s.col * 80 : -1)));
    expect(r.faults.count).toBe(6);
    expect(r.faults.first).toMatch(/bar/);
  });

  it('has the signal makers and level in scope', () => {
    const r = compileExpr({ code: 'slew(level("mouse"), { riseMs: 100 })' }, scope, 0);
    if ('error' in r) throw new Error(r.error);
    expect(typeof r.fn).toBe('function');
  });

  it('keeps the input mark of a signal built from a level', () => {
    const marked = compileExpr({ code: 'lag(level("mouse"), { riseMs: 50 })' }, scope, 0);
    const plain = compileExpr({ code: '(s) => s.x' }, scope, 0);
    if ('error' in marked || 'error' in plain) throw new Error('did not compile');
    expect((marked.fn as { input?: boolean }).input).toBe(true);
    expect((plain.fn as { input?: boolean }).input).toBeUndefined();
  });
});
