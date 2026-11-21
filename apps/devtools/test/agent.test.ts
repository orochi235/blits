// Loaded before the fake window goes up, so the panel's UI modules see no browser.
import '@msb235/blits-panel';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PAGE_KEY, TAB_PORT } from '../src/names.js';

// The relay and the page's agent share one window in a real tab; this stands in for it and for the
// ports the worker opens to the relay.
const g = globalThis as unknown as Record<string | symbol, unknown>;
const KEY = Symbol.for(PAGE_KEY);

interface RelayPort {
  name: string;
  postMessage(text: string): void;
  onMessage: { addListener(fn: (text: string) => void): void };
  onDisconnect: { addListener(fn: () => void): void };
}

let connects: ((port: RelayPort) => void)[];
let target: EventTarget;

beforeEach(() => {
  connects = [];
  target = new EventTarget();
  g.window = g;
  g.addEventListener = target.addEventListener.bind(target);
  g.removeEventListener = target.removeEventListener.bind(target);
  g.postMessage = (data: unknown) =>
    setTimeout(() => {
      const ev = Object.assign(new Event('message'), { data, source: g });
      target.dispatchEvent(ev);
    }, 0);
  g.chrome = {
    runtime: { onConnect: { addListener: (fn: (p: RelayPort) => void) => connects.push(fn) } },
  };
});

afterEach(() => {
  (g[KEY] as (() => void) | undefined)?.();
  for (const k of [
    'window',
    'addEventListener',
    'removeEventListener',
    'postMessage',
    'chrome',
    'blitsRelay',
  ])
    delete g[k];
});

/** Opens a port to the relay, as the worker's `chrome.tabs.connect` does; `drop` closes it. */
function connect() {
  const bye: (() => void)[] = [];
  const port: RelayPort = {
    name: TAB_PORT,
    postMessage() {},
    onMessage: { addListener() {} },
    onDisconnect: { addListener: (fn) => bye.push(fn) },
  };
  for (const fn of connects) fn(port);
  return {
    drop: () => {
      for (const fn of bye) fn();
    },
  };
}

/** Injects `page.js` again, as each attach does. */
let injected = 0;
async function inject() {
  const url = new URL(`../src/page.ts?${++injected}`, import.meta.url).href;
  await import(/* @vite-ignore */ url);
  return g[KEY];
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("the page's agent", () => {
  it('outlives the bye of a port that served the agent it replaced', async () => {
    await import('../src/relay.js');
    await inject();
    const first = connect();
    await settle();
    const second = await inject();
    first.drop();
    await settle();
    expect(g[KEY]).toBe(second);
    const next = connect();
    await settle();
    next.drop();
    await settle();
    expect(g[KEY]).toBeUndefined();
  });
});
