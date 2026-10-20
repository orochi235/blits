import { decode, encode } from '@msb235/blits-panel';
import { describe, expect, it } from 'vitest';
import { MARK, TAB_PORT } from '../src/names.js';
import { type Chrome, type Port, pair } from '../src/pair.js';

class FakePort implements Port {
  sent: string[] = [];
  private msg: ((t: string) => void)[] = [];
  private bye: (() => void)[] = [];
  closed = false;
  postMessage(text: string) {
    this.sent.push(text);
  }
  onMessage = { addListener: (fn: (t: string) => void) => this.msg.push(fn) };
  onDisconnect = { addListener: (fn: () => void) => this.bye.push(fn) };
  disconnect() {
    this.closed = true;
  }
  /** Delivers `text` as if from the other end. */
  deliver(text: string) {
    for (const fn of this.msg) fn(text);
  }
  drop() {
    for (const fn of this.bye) fn();
  }
}

function fake() {
  const log: string[] = [];
  const pages: FakePort[] = [];
  const storage = new Map<string, string>();
  let loaded: (() => void) | null = null;
  const chrome: Chrome = {
    async inject(tab, file, main) {
      log.push(`inject ${tab} ${file} ${main ? 'main' : 'isolated'}`);
    },
    connect(tab, name) {
      log.push(`connect ${tab} ${name}`);
      const p = new FakePort();
      pages.push(p);
      return p;
    },
    async run(_tab, fn, arg) {
      const g = globalThis as { sessionStorage?: unknown };
      const was = g.sessionStorage;
      g.sessionStorage = {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => storage.set(k, v),
        removeItem: (k: string) => storage.delete(k),
      };
      try {
        return fn(arg as never);
      } finally {
        g.sessionStorage = was;
      }
    },
    async reload(tab) {
      log.push(`reload ${tab}`);
    },
    loaded(_tab, fn) {
      loaded = fn;
      return () => {
        loaded = null;
      };
    },
  };
  return { chrome, log, pages, storage, load: () => loaded?.() };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('pairing a panel with its tab', () => {
  it('puts the relay and the agent into the tab, then carries messages both ways', async () => {
    const f = fake();
    const panel = new FakePort();
    pair(f.chrome, panel, 7);
    await settle();
    expect(f.log).toEqual([
      'inject 7 relay.js isolated',
      'inject 7 page.js main',
      `connect 7 ${TAB_PORT}`,
    ]);
    expect(decode(panel.sent[0] as string)).toEqual({ ctl: 'attached', history: null });
    panel.deliver(encode({ hello: true }));
    expect(f.pages[0]?.sent).toEqual([encode({ hello: true })]);
    f.pages[0]?.deliver('from the page');
    expect(panel.sent.at(-1)).toBe('from the page');
  });

  it('marks the tab for history and reloads it, and attaches again once it has loaded', async () => {
    const f = fake();
    const panel = new FakePort();
    pair(f.chrome, panel, 3);
    await settle();
    panel.deliver(encode({ ctl: 'history', ms: 10_000 }));
    await settle();
    expect(f.storage.get(MARK)).toBe('10000');
    expect(f.log).toContain('reload 3');
    f.load();
    await settle();
    expect(f.pages[0]?.closed).toBe(true);
    expect(decode(panel.sent.at(-1) as string)).toEqual({ ctl: 'attached', history: 10_000 });
    panel.deliver(encode({ ctl: 'history', ms: null }));
    await settle();
    expect(f.storage.has(MARK)).toBe(false);
  });

  it('says so when the tab cannot be reached, and lets go when the panel closes', async () => {
    const f = fake();
    f.chrome.inject = async () => {
      throw new Error('Cannot access a chrome:// URL');
    };
    const panel = new FakePort();
    pair(f.chrome, panel, 1);
    await settle();
    expect(decode(panel.sent[0] as string)).toEqual({
      ctl: 'unreachable',
      why: 'Cannot access a chrome:// URL',
    });
    const ok = fake();
    const p2 = new FakePort();
    pair(ok.chrome, p2, 2);
    await settle();
    p2.drop();
    expect(ok.pages[0]?.closed).toBe(true);
    ok.load();
    await settle();
    expect(ok.pages).toHaveLength(1);
  });
});
