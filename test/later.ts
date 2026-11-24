/**
 * Runs `fn`, holding back what `throwLater` queues meanwhile, and answers the errors those throw
 * once `fn` returns.
 */
export function thrownLater(fn: () => void): unknown[] {
  const g = globalThis as unknown as { queueMicrotask: (cb: () => void) => void };
  const real = g.queueMicrotask;
  const queued: (() => void)[] = [];
  g.queueMicrotask = (cb) => {
    queued.push(cb);
  };
  try {
    fn();
  } finally {
    g.queueMicrotask = real;
  }
  const errors: unknown[] = [];
  for (const cb of queued)
    try {
      cb();
    } catch (err) {
      errors.push(err);
    }
  return errors;
}

/** The messages of `errors`. */
export const messages = (errors: unknown[]): string[] => errors.map((e) => (e as Error).message);
