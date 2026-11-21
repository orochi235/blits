// @vitest-environment happy-dom
import { CodePane } from '@pg/widgets/CodePane';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function mount(props: Parameters<typeof CodePane>[0]) {
  const host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
  act(() => root?.render(createElement(CodePane, props)));
  return host.querySelector('textarea') as HTMLTextAreaElement;
}
const press = (el: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    el.dispatchEvent(e);
  });
  return e.defaultPrevented;
};

describe('CodePane', () => {
  it('indents on Tab', () => {
    const el = mount({ value: 'x', onCommit: () => {}, label: 'code' });
    expect(press(el, 'Tab')).toBe(true);
  });
  it('lets Shift+Tab and Tab after Escape move focus on', () => {
    const el = mount({ value: 'x', onCommit: () => {}, label: 'code' });
    expect(press(el, 'Tab', { shiftKey: true })).toBe(false);
    press(el, 'Escape');
    expect(press(el, 'Tab')).toBe(false);
    expect(press(el, 'Tab')).toBe(true);
  });

  it('sends a draft the parent turned down once, not again on blur', () => {
    const onCommit = vi.fn();
    const el = mount({ value: 'x', onCommit, label: 'code', error: 'bad' });
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(el, 'y');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    press(el, 'Enter', { metaKey: true });
    act(() => {
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onCommit.mock.calls).toEqual([['y']]);
  });
});
