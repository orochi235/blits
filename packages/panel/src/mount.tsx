import { watched } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { ThemeProvider } from '@weasel-js/theme/react';
import { createRoot } from 'react-dom/client';
import { type AgentOptions, agent } from './agent.js';
import { panelStyles } from './styles.js';
import { Panel } from './ui/Panel.js';

export interface MountOptions extends Omit<AgentOptions, 'ignore'> {
  /**
   * How far back every mix made from now on can scrub, ms, where it names no history of its own;
   * `false` adds none. Default 10 s, unless the app already set `watched().history`, which then
   * stands. A mix made before `mount` keeps what it has.
   */
  history?: number | false;
}

/**
 * Puts the panel on the page: a pill in a corner that opens into a window over every blits mix
 * on it. Call it before the app makes its mixes, so they keep the history scrubbing back needs.
 * Returns what takes it off again, freeing any clock it holds.
 */
export function mount(opts: MountOptions = {}): () => void {
  const registry = watched();
  const before = registry.history;
  // A default the app or another panel already set stands, unless this one names its own.
  const ms = opts.history ?? (before === undefined ? 10_000 : false);
  const ours = ms === false ? undefined : { ms, tape: createHistory };
  if (ours !== undefined) registry.history = ours;

  const host = document.createElement('div');
  host.setAttribute('data-blits-panel', '');
  const shadow = host.attachShadow({ mode: 'open' });
  if ('adoptedStyleSheets' in shadow && typeof CSSStyleSheet.prototype.replaceSync === 'function') {
    const sheets = [panelStyles].map((text) => {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(text);
      return sheet;
    });
    shadow.adoptedStyleSheets = sheets;
  } else
    for (const text of [panelStyles]) {
      const style = document.createElement('style');
      style.textContent = text;
      shadow.appendChild(style);
    }
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  document.body.appendChild(host);

  const page = agent({ ...opts, ignore: host });
  const root = createRoot(mountPoint);
  root.render(
    <ThemeProvider selection={{ mode: 'auto' }} className="bp-root">
      <Panel source={page} />
    </ThemeProvider>,
  );

  let gone = false;
  return () => {
    if (gone) return;
    gone = true;
    root.unmount();
    page.dispose();
    host.remove();
    if (ours !== undefined && registry.history === ours) registry.history = before;
  };
}
