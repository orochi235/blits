// Put into the page's isolated world when a DevTools panel connects: carries the page's window
// messages to the worker's port and back.
import { TAB_PORT, TAG } from './names.js';

const flag = globalThis as { blitsRelay?: true };
if (!flag.blitsRelay) {
  flag.blitsRelay = true;
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== TAB_PORT) return;
    const up = (ev: MessageEvent<{ source?: unknown; up?: unknown }>) => {
      if (ev.source === window && ev.data?.source === TAG && typeof ev.data.up === 'string')
        port.postMessage(ev.data.up);
    };
    addEventListener('message', up);
    port.onMessage.addListener((text: string) =>
      window.postMessage({ source: TAG, down: text }, '*'),
    );
    port.onDisconnect.addListener(() => {
      removeEventListener('message', up);
      window.postMessage({ source: TAG, bye: true }, '*');
    });
  });
}
