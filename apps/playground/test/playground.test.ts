// @vitest-environment happy-dom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@pg/app/App', () => ({ App: () => createElement('p', { id: 'app' }, 'app') }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('Playground', () => {
  it('holds the app back until Oswald is in, on any page that mounts it', async () => {
    let arrive = () => {};
    const load = vi.fn(() => new Promise<FontFace[]>((r) => (arrive = () => r([]))));
    Object.defineProperty(document, 'fonts', { configurable: true, value: { load } });
    const { Playground } = await import('@pg/Playground');
    const el = document.createElement('div');
    document.body.append(el);
    const root = createRoot(el);
    await act(async () => root.render(createElement(Playground)));
    expect(load).toHaveBeenCalledWith('400 12px Oswald');
    expect(el.querySelector('#app')).toBeNull();
    await act(async () => arrive());
    expect(el.querySelector('#app')).not.toBeNull();
    await act(async () => root.unmount());
  });
});
