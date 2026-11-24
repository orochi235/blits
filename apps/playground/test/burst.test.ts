// @vitest-environment happy-dom
import { burstOf } from '@pg/app/drafting';
import { createEdits } from '@pg/app/edits';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
});

const setup = () => {
  const e = createEdits<number>(0, () => {});
  const step = burstOf(e, (n: number) => e.set(n));
  return { e, step };
};

describe('burstOf', () => {
  it('records a held spinner as one step when the key comes up', () => {
    const { e, step } = setup();
    step(1);
    step(2);
    step(3);
    expect(e.now()).toBe(3);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowUp' }));
    step(4);
    window.dispatchEvent(new PointerEvent('pointerup'));
    e.undo();
    expect(e.now()).toBe(3);
    e.undo();
    expect(e.now()).toBe(0);
    expect(e.canUndo()).toBe(false);
  });

  it('settles a commit made on blur in the same focusout', () => {
    const { e, step } = setup();
    const field = document.createElement('input');
    document.body.append(field);
    field.addEventListener('focusout', () => step(5), { once: true });
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    step(6);
    field.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    field.remove();
    e.undo();
    expect(e.now()).toBe(5);
  });

  it('settles a burst nothing ends once it rests', () => {
    vi.useFakeTimers();
    const { e, step } = setup();
    step(1);
    step(2);
    vi.advanceTimersByTime(5000);
    step(3);
    vi.advanceTimersByTime(5000);
    e.undo();
    expect(e.now()).toBe(2);
    e.undo();
    expect(e.now()).toBe(0);
  });
});
