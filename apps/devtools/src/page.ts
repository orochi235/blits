// Put into the page's own world when a DevTools panel connects: runs the panel's agent there and
// speaks to the relay through window messages.
import { agent, serve, type Wire } from '@msb235/blits-panel';
import { TAG } from './names.js';

const KEY = Symbol.for('@msb235/blits-devtools/page');
const slot = globalThis as unknown as Record<symbol, (() => void) | undefined>;

interface Data {
  source?: unknown;
  down?: unknown;
  bye?: unknown;
}

function start(): void {
  slot[KEY]?.();
  const a = agent();
  const wire: Wire = {
    send: (text) => window.postMessage({ source: TAG, up: text }, '*'),
    listen(fn) {
      const on = (ev: MessageEvent<Data>) => {
        if (ev.source === window && ev.data?.source === TAG && typeof ev.data.down === 'string')
          fn(ev.data.down);
      };
      addEventListener('message', on);
      return () => removeEventListener('message', on);
    },
  };
  const stop = serve(a, wire);
  const bye = (ev: MessageEvent<Data>) => {
    if (ev.source === window && ev.data?.source === TAG && ev.data.bye === true) end();
  };
  const end = () => {
    stop();
    a.dispose();
    removeEventListener('message', bye);
    if (slot[KEY] === end) slot[KEY] = undefined;
  };
  addEventListener('message', bye);
  slot[KEY] = end;
}

start();
