/** What an app can tell any panel on the page about subjects the DOM cannot see. */
export interface Offer {
  /** The subject under a point in client coordinates. */
  pick?: (x: number, y: number) => unknown;
  /** Where a subject is on screen, in client coordinates. */
  outline?: (subject: unknown) => DOMRect | undefined;
}

const KEY = Symbol.for('@msb235/blits-panel/offer/1');
const slot = globalThis as unknown as Record<symbol, Offer | undefined>;

/**
 * Hands the app's own `pick` and `outline` to whatever panel inspects the page: one `mount()`
 * put there, or the DevTools extension's. Kept on the page's global object, so it reaches a panel
 * bundled apart from the app. A later call replaces an earlier one.
 */
export function offer(o: Offer): void {
  slot[KEY] = { ...o };
}

/** What the app offered, read each time it is needed. */
export function offered(): Offer {
  return slot[KEY] ?? {};
}
