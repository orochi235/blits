import { decode, encode, Panel, panelStyles, type Wire, wireSource } from '@msb235/blits-panel';
import { ThemeProvider } from '@weasel-js/theme/react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { type Control, HISTORY_MS, PING_MS, panelPort } from './names.js';
import './panel.css';

// In DevTools the tab is the inspected window's; the smoke run opens this page with `?tab=`.
const tab =
  chrome.devtools?.inspectedWindow?.tabId ??
  Number(new URLSearchParams(location.search).get('tab'));

// One wire for the page's life, over whichever port is open: Chrome stops an idle worker, which
// drops the port, so a dropped port is opened again and the worker attaches anew.
const fns = new Set<(text: string) => void>();
let port: chrome.runtime.Port;
const open = () => {
  port = chrome.runtime.connect({ name: panelPort(tab) });
  port.onMessage.addListener((text: string) => {
    for (const fn of [...fns]) fn(text);
  });
  port.onDisconnect.addListener(() => setTimeout(open, 100));
};
open();
setInterval(() => {
  try {
    port.postMessage(encode({ ctl: 'ping' }));
  } catch {}
}, PING_MS);
const wire: Wire = {
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
const source = wireSource(wire);

function App() {
  const [history, setHistory] = useState<number | null>(null);
  const [down, setDown] = useState<string | null>(null);
  useEffect(
    () =>
      wire.listen((text) => {
        const m = decode<Partial<Control>>(text);
        if (m.ctl === 'attached') {
          setDown(null);
          setHistory(m.history ?? null);
          source.refresh();
        } else if (m.ctl === 'unreachable') setDown(m.why ?? 'the page could not be reached');
      }),
    [],
  );
  const toggle = () =>
    port.postMessage(encode({ ctl: 'history', ms: history === null ? HISTORY_MS : null }));
  const bar = (
    <button
      type="button"
      title={
        history === null
          ? 'reload the page, giving its mixes 10 s of history to scrub'
          : 'reload without history'
      }
      onClick={toggle}
    >
      {history === null ? 'Reload with history' : 'Stop history'}
    </button>
  );
  return (
    <ThemeProvider selection={{ mode: 'auto' }} className="bp-root dt-root">
      {down !== null && <p className="dt-down">This page can't be inspected: {down}</p>}
      <Panel docked source={source} bar={bar} />
    </ThemeProvider>
  );
}

const style = document.createElement('style');
style.textContent = panelStyles;
document.head.appendChild(style);
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
