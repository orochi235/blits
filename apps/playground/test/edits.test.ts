import { createEdits } from '@pg/app/edits';
import { describe, expect, it } from 'vitest';

const track = (start: number) => {
  const shown: number[] = [];
  const e = createEdits<number>(start, (x) => shown.push(x));
  return { e, shown };
};

describe('createEdits', () => {
  it('records each set as its own step', () => {
    const { e } = track(1);
    e.set(2);
    e.set(3);
    e.undo();
    expect(e.now()).toBe(2);
    e.undo();
    expect(e.now()).toBe(1);
    expect(e.canUndo()).toBe(false);
  });

  it('shows a draft without recording it, and records the set that follows as one step from before it', () => {
    const { e, shown } = track(1);
    e.draft(1.5);
    e.draft(2.5);
    expect(shown).toEqual([1.5, 2.5]);
    e.set(4);
    expect(e.now()).toBe(4);
    e.undo();
    expect(e.now()).toBe(1);
    expect(e.canUndo()).toBe(false);
    e.redo();
    expect(e.now()).toBe(4);
  });

  it('routes the sets made inside `drafting` to `draft`', () => {
    const { e } = track(1);
    e.drafting(() => e.set(2));
    e.drafting(() => e.set(3));
    expect(e.now()).toBe(3);
    e.set(3.5);
    e.undo();
    expect(e.now()).toBe(1);
  });

  it('records nothing when a drag settles where it began, and shows that value again', () => {
    const { e } = track(1);
    e.draft(2);
    e.set(1);
    expect(e.now()).toBe(1);
    expect(e.canUndo()).toBe(false);
  });

  it('undo while drafting drops the draft and goes back to before it', () => {
    const { e } = track(1);
    e.set(2);
    e.draft(5);
    e.undo();
    expect(e.now()).toBe(2);
    e.undo();
    expect(e.now()).toBe(1);
  });

  it('settle records the drafts on screen as one step, and does nothing with none', () => {
    const { e } = track(1);
    e.settle();
    expect(e.canUndo()).toBe(false);
    e.draft(2);
    e.draft(3);
    e.settle();
    expect(e.now()).toBe(3);
    e.undo();
    expect(e.now()).toBe(1);
    expect(e.canUndo()).toBe(false);
  });
});
