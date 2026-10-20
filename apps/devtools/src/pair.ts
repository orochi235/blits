import { decode, encode } from '@msb235/blits-panel';
import { type Control, HISTORY_MS, MARK, TAB_PORT } from './names.js';

/** What pairing needs from Chrome, so a test can stand in for it. */
export interface Chrome {
  inject(tab: number, file: string, main: boolean): Promise<void>;
  connect(tab: number, name: string): Port;
  /** Runs `fn(arg)` in the tab's page and answers what it returned. */
  run<A, R>(tab: number, fn: (arg: A) => R, arg: A): Promise<R>;
  reload(tab: number): Promise<void>;
  /** Calls `fn` each time the tab finishes loading; returns what stops it. */
  loaded(tab: number, fn: () => void): () => void;
}

export interface Port {
  postMessage(text: string): void;
  onMessage: { addListener(fn: (text: string) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
  disconnect(): void;
}

/**
 * Pairs a DevTools panel with its tab: puts the relay and the page's agent into the tab, carries
 * the panel protocol between them, does it again each time the tab loads, and answers the
 * panel's requests for history.
 */
export function pair(chrome: Chrome, panel: Port, tab: number): void {
  let page: Port | null = null;
  let closed = false;
  const tell = (c: Control) => panel.postMessage(encode(c));

  const attach = async () => {
    page?.disconnect();
    page = null;
    let history: number | null;
    try {
      await chrome.inject(tab, 'relay.js', false);
      await chrome.inject(tab, 'page.js', true);
      history = await chrome.run(
        tab,
        (mark: string) => {
          try {
            return Number(sessionStorage.getItem(mark)) || null;
          } catch {
            return null;
          }
        },
        MARK,
      );
    } catch (e) {
      tell({ ctl: 'unreachable', why: e instanceof Error ? e.message : String(e) });
      return;
    }
    if (closed) return;
    const p = chrome.connect(tab, TAB_PORT);
    p.onMessage.addListener((text) => panel.postMessage(text));
    p.onDisconnect.addListener(() => {
      if (page === p) page = null;
    });
    page = p;
    tell({ ctl: 'attached', history });
  };

  panel.onMessage.addListener((text) => {
    const m = decode<Partial<Control>>(text);
    if (m.ctl === 'history') {
      const ms = m.ms === null ? null : (m.ms ?? HISTORY_MS);
      void chrome
        .run(
          tab,
          ([mark, value]: [string, number | null]) => {
            if (value === null) sessionStorage.removeItem(mark);
            else sessionStorage.setItem(mark, String(value));
          },
          [MARK, ms] as [string, number | null],
        )
        .then(() => chrome.reload(tab));
      return;
    }
    page?.postMessage(text);
  });
  const stopLoaded = chrome.loaded(tab, () => void attach());
  panel.onDisconnect.addListener(() => {
    closed = true;
    stopLoaded();
    page?.disconnect();
    page = null;
  });
  void attach();
}
