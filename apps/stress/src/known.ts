/**
 * Fails blits is known to have, by `Finding.key`; HANDOFF.md's "Next, in order" item 1 says what
 * each is. A run whose only fails are these exits 0 and prints them as `known`.
 */
export const KNOWN: ReadonlySet<string> = new Set([
  'cues/from-current-speed',
  'timeline/frame-rate-layout',
]);

export const isKnown = (key: string | undefined) => key !== undefined && KNOWN.has(key);
