// @vitest-environment happy-dom
import { kit, mix, sum, watched } from '@msb235/blits';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../src/mount.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const K = kit<{ x: number }>({ x: sum() });

afterEach(() => {
  watched().history = undefined;
  document.body.innerHTML = '';
});

describe('mount', () => {
  it('puts the pill in a shadow root, and unmounting leaves the page as it was', async () => {
    const before = document.body.innerHTML;
    let unmount = () => {};
    await act(async () => {
      unmount = mount();
    });
    const host = document.querySelector('[data-blits-panel]');
    expect(host?.shadowRoot?.querySelector('.bp-pill')).not.toBeNull();
    await act(async () => {
      unmount();
    });
    expect(document.body.innerHTML).toBe(before);
  });

  it('gives mixes made after it 10 s of history with a tape, and takes that back on unmount', async () => {
    let unmount = () => {};
    await act(async () => {
      unmount = mount();
    });
    const m = mix<unknown, { x: number }>(K, { name: 'mounted' });
    const entry = watched()
      .entries()
      .find((e) => e.mix === m);
    expect(entry?.history).toEqual({ ms: 10_000, tape: true, added: true });
    await act(async () => {
      unmount();
    });
    expect(watched().history).toBeUndefined();
  });

  it("leaves a history the app set, and a second panel's, standing", async () => {
    const own = { ms: 3000 };
    watched().history = own;
    let one = () => {};
    let two = () => {};
    await act(async () => {
      one = mount();
    });
    expect(watched().history).toBe(own);
    watched().history = undefined;
    await act(async () => {
      one();
      one = mount();
      two = mount();
    });
    const first = watched().history;
    expect(first?.ms).toBe(10_000);
    await act(async () => {
      two();
    });
    expect(watched().history).toBe(first);
    await act(async () => {
      one();
    });
    expect(watched().history).toBeUndefined();
  });

  it('adds no history when told not to', async () => {
    let unmount = () => {};
    await act(async () => {
      unmount = mount({ history: false });
    });
    expect(watched().history).toBeUndefined();
    await act(async () => {
      unmount();
    });
  });
});
