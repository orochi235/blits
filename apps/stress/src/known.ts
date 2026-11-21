/**
 * Fails blits is known to have, by `Finding.key`. A run whose only fails are these exits 0 and
 * prints them as `known`.
 */
export const KNOWN: ReadonlySet<string> = new Set<string>();

export const isKnown = (key: string | undefined) => key !== undefined && KNOWN.has(key);
