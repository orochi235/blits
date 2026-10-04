import { gate, lag, peak, type Signal, slew } from '@msb235/blits';
import type { Expr } from './composition';
import type { Subject } from './stage';

export interface Faults {
  count: number;
  first: string | null;
}

export interface Scope {
  level(name: string): Signal<Subject>;
}

export type Compiled<F> = { fn: F; faults: Faults } | { error: string; line: number | null };

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The line `new Function` reports, less the three it adds above the author's code. */
function lineOf(err: unknown): number | null {
  const at = err instanceof Error ? /<anonymous>:(\d+):\d+/.exec(err.stack ?? '') : null;
  return at ? Math.max(1, Number(at[1]) - 3) : null;
}

export function compileExpr<F extends (...args: never[]) => unknown>(
  expr: Expr,
  scope: Scope,
  fallback: ReturnType<F>,
): Compiled<F> {
  let made: unknown;
  try {
    made = new Function(
      'slew',
      'lag',
      'peak',
      'gate',
      'level',
      `"use strict";\nreturn (${expr.code}\n);`,
    )(slew, lag, peak, gate, (name: string) => scope.level(name));
  } catch (err) {
    return { error: message(err), line: lineOf(err) };
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
