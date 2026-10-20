import { type Chrome, type Port, pair } from './pair.js';

const PANEL = /^panel:(\d+)$/;

const real: Chrome = {
  async inject(tab, file, main) {
    await chrome.scripting.executeScript({
      target: { tabId: tab, frameIds: [0] },
      files: [file],
      world: main ? 'MAIN' : 'ISOLATED',
    });
  },
  connect: (tab, name) => chrome.tabs.connect(tab, { name, frameId: 0 }) as unknown as Port,
  async run(tab, fn, arg) {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab, frameIds: [0] },
      world: 'MAIN',
      func: fn as never,
      args: [arg as never],
    });
    return result?.result as never;
  },
  async reload(tab) {
    await chrome.tabs.reload(tab);
  },
  loaded(tab, fn) {
    const on = (id: number, change: { status?: string }) => {
      if (id === tab && change.status === 'complete') fn();
    };
    chrome.tabs.onUpdated.addListener(on);
    return () => chrome.tabs.onUpdated.removeListener(on);
  },
};

chrome.runtime.onConnect.addListener((port) => {
  const m = PANEL.exec(port.name);
  if (m === null) return;
  pair(real, port as unknown as Port, Number(m[1]));
});
