// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command, Event, Source } from '../src/protocol.js';
import { Panel } from '../src/ui/Panel.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

/** A source whose page answers later, as one across the DevTools extension's ports does. */
function slow() {
  const fns = new Set<(e: Event) => void>();
  const sent: Command[] = [];
  const source: Source = {
    subscribe(fn) {
      fns.add(fn);
      return () => fns.delete(fn);
    },
    send: (c) => sent.push(c),
  };
  const emit = (e: Event) => {
    for (const fn of [...fns]) fn(e);
  };
  return { source, sent, emit };
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

/** Sets a range's value as the browser does when it is dragged or stepped, then fires `kinds`. */
function slide(el: HTMLInputElement, value: string, kinds: string[]) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  for (const kind of kinds) el.dispatchEvent(new Event(kind, { bubbles: true }));
}

describe('the scrub bar', () => {
  it('seeks once to where it was let go, and stays there until the page answers', async () => {
    const { source, sent, emit } = slow();
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(Panel, { docked: true, source }));
    });
    await act(async () => {
      emit({
        kind: 'mixes',
        mixes: [{ id: 1, name: 'show', release: '', channels: [], history: null }],
      });
      emit({ kind: 'picked', mix: 1, subject: null });
      emit({ kind: 'hold', hold: { state: 'held', rate: 0, now: 900, reach: 100 } });
      await frame();
    });
    const scrub = host.querySelector('.bp-scrub') as HTMLInputElement;
    expect(scrub.disabled).toBe(false);
    sent.length = 0;
    // A key step on a range fires both at once, before the page can answer.
    await act(async () => {
      slide(scrub, '100', ['input', 'change']);
    });
    expect(sent).toEqual([{ kind: 'seek', to: 100 }]);
    expect(scrub.value).toBe('100');
    await act(async () => {
      emit({ kind: 'hold', hold: { state: 'held', rate: 0, now: 100, reach: 100 } });
      await frame();
    });
    expect(scrub.value).toBe('100');
    expect(host.querySelector('.bp-bar .bp-time')?.textContent).toBe('0.10s');
    await act(async () => root.unmount());
  });
});
