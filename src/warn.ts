declare const process: { env: Record<string, string | undefined> };
declare const console: { warn(message: string): void };

/** Whether this is a production build: a bundler's `NODE_ENV`, or Node's; false where neither is. */
function production(): boolean {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

const warned = new WeakSet<object>();

/** Warns outside production, once for each `about`. */
export function warnOnce(about: object, message: string): void {
  if (warned.has(about) || production()) return;
  warned.add(about);
  console.warn(`blits: ${message}`);
}
