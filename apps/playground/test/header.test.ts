// @vitest-environment happy-dom
import { Header } from '@pg/app/Header';
import { DEFAULT } from '@pg/blits/presets';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Header', () => {
  it('has undo and redo buttons, each disabled while there is nothing to step', async () => {
    const onUndo = vi.fn();
    const onRedo = vi.fn();
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        createElement(Header, {
          comp: DEFAULT,
          onComp: () => {},
          onPreset: () => {},
          canUndo: true,
          canRedo: false,
          onUndo,
          onRedo,
        }),
      ),
    );
    const button = (name: string) =>
      [...el.querySelectorAll('button')].find((b) => b.textContent === name);
    const undo = button('undo');
    const redo = button('redo');
    expect(undo?.disabled).toBe(false);
    expect(redo?.disabled).toBe(true);
    await act(async () => undo?.click());
    expect(onUndo).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
});
