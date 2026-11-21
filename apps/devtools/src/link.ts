import type { Wire } from '@msb235/blits-panel';

/** The part of a `chrome.runtime.Port` the panel page uses. */
export interface LinkPort {
  postMessage(text: string): void;
  onMessage: { addListener(fn: (text: string) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

/**
 * One wire for the panel page's life, over whichever port is open: Chrome stops an idle worker,
 * which drops the port, so a dropped port is opened again after `retry` ms. A send while it is
 * down is lost rather than thrown.
 */
export function link(connect: () => LinkPort, retry = 100): Wire {
  const fns = new Set<(text: string) => void>();
  let port: LinkPort;
  const open = () => {
    port = connect();
    port.onMessage.addListener((text) => {
      for (const fn of [...fns]) fn(text);
    });
    port.onDisconnect.addListener(() => setTimeout(open, retry));
  };
  open();
  return {
    send(text) {
      try {
        port.postMessage(text);
      } catch {}
    },
    listen(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
  };
}
