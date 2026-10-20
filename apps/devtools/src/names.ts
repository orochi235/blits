/** Where a tab keeps that its mixes should get history, in the page's `sessionStorage`. */
export const MARK = 'blits-devtools:history';
/** How much history "Reload with history" asks for, ms. */
export const HISTORY_MS = 10_000;
/** Tags the page's and the relay's `window` messages, so others' messages pass by. */
export const TAG = 'blits-devtools';
/** The port name a DevTools panel connects with, and the one the worker opens to a tab. */
export const panelPort = (tab: number) => `panel:${tab}`;
export const TAB_PORT = 'blits';
/** The `Symbol.for` key the page's agent leaves its stop function under. */
export const PAGE_KEY = '@msb235/blits-devtools/page';
/** How often the panel speaks to the worker, ms: an idle worker is stopped after 30 s. */
export const PING_MS = 20_000;

/** What the worker and the panel page say to each other besides the panel protocol. */
export type Control =
  | { ctl: 'attached'; history: number | null }
  | { ctl: 'unreachable'; why: string }
  | { ctl: 'history'; ms: number | null }
  | { ctl: 'ping' };
