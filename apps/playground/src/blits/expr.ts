import { gate, lag, level, peak, type Signal, slew } from '@msb235/blits';
import { parse } from 'acorn';
import type { Expr, Level } from './composition';
import type { Subject } from './stage';

export interface Faults {
  count: number;
  first: string | null;
}

export interface Scope {
  level(name: string): Signal<Subject>;
}

export type LevelSignal = Signal<Subject> & { set(v: number): void };

/** A scope reading the composition's levels; a name it lacks reads 0. */
export function scopeOf(list: readonly Level[]): Scope & { levels: Map<string, LevelSignal> } {
  const levels = new Map(list.map((l) => [l.name, level<Subject>(l.value)]));
  return { levels, level: (name) => levels.get(name) ?? level<Subject>(0) };
}

export type Compiled<F> = { fn: F; faults: Faults } | { error: string; line: number | null };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The line `new Function` reports, less the three it adds above the author's code. */
function lineOf(err: unknown): number | null {
  const at = err instanceof Error ? /<anonymous>:(\d+):\d+/.exec(err.stack ?? '') : null;
  return at ? Math.max(1, Number(at[1]) - 3) : null;
}

const PRELUDE = '"use strict";\n';
const bodyOf = (code: string) => `${PRELUDE}return (${code}\n);`;

/** The author line of a syntax error, which V8's stack does not carry; acorn's parse does. */
function syntaxLineOf(code: string): number | null {
  try {
    parse(bodyOf(code), { ecmaVersion: 'latest', allowReturnOutsideFunction: true });
    return null;
  } catch (err) {
    const loc = (err as { loc?: { line: number } }).loc;
    // An unfinished last line fails on the wrapper's closing line; that is still the author's last.
    return loc ? Math.min(Math.max(1, loc.line - 1), code.split('\n').length) : null;
  }
}

export function compileExpr<F extends (...args: never[]) => unknown>(
  expr: Expr,
  scope: Scope,
  fallback: ReturnType<F>,
): Compiled<F> {
  let made: unknown;
  try {
    made = new Function('slew', 'lag', 'peak', 'gate', 'level', bodyOf(expr.code))(
      slew,
      lag,
      peak,
      gate,
      (name: string) => scope.level(name),
    );
  } catch (err) {
    const line = err instanceof SyntaxError ? syntaxLineOf(expr.code) : lineOf(err);
    return { error: message(err), line };
  }
  if (typeof made !== 'function') return { error: 'must be a function', line: null };
  const inner = made as (...args: unknown[]) => unknown;
  const faults: Faults = { count: 0, first: null };
  const fn = ((...args: unknown[]) => {
    try {
      return inner(...args);
    } catch (err) {
      faults.count++;
      faults.first ??= message(err);
      return fallback;
    }
  }) as unknown as F;
  // A signal marked `input` must keep its mark through the wrapper, or a read back trusts it.
  if ((inner as { input?: boolean }).input) (fn as unknown as { input: boolean }).input = true;
  return { fn, faults };
}
