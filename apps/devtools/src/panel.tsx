import { decode, encode, Panel, panelStyles, wireSource } from '@msb235/blits-panel';
import { ThemeProvider } from '@weasel-js/theme/react';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { link } from './link.js';
import { type Control, HISTORY_MS, PING_MS, panelPort } from './names.js';
import './panel.css';

// In DevTools the tab is the inspected window's; the smoke run opens this page with `?tab=`.
const tab =
  chrome.devtools?.inspectedWindow?.tabId ??
  Number(new URLSearchParams(location.search).get('tab'));

const wire = link(() => chrome.runtime.connect({ name: panelPort(tab) }));
setInterval(() => wire.send(encode({ ctl: 'ping' })), PING_MS);
const source = wireSource(wire);

function App() {
  const [history, setHistory] = useState<number | null>(null);
  const [down, setDown] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  useEffect(
    () =>
      wire.listen((text) => {
        const m = decode<Partial<Control>>(text);
        if (m.ctl === 'attached') {
          setDown(null);
          setRefused(null);
          setHistory(m.history ?? null);
          source.refresh();
        } else if (m.ctl === 'unreachable') setDown(m.why ?? 'the page could not be reached');
        else if (m.ctl === 'refused') setRefused(m.why ?? 'the page refused it');
      }),
    [],
  );
  const toggle = () =>
    wire.send(encode({ ctl: 'history', ms: history === null ? HISTORY_MS : null }));
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
      {down === null && refused !== null && (
        <p className="dt-down">History could not be changed: {refused}</p>
      )}
      <Panel docked source={source} bar={bar} />
    </ThemeProvider>
  );
}

const style = document.createElement('style');
style.textContent = panelStyles;
document.head.appendChild(style);
createRoot(document.getElementById('root') as HTMLElement).render(<App />);
