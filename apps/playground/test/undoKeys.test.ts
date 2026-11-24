// @vitest-environment happy-dom
import { keepsOwnUndo } from '@pg/app/undoKeys';
import { describe, expect, it } from 'vitest';

const el = (html: string) => {
  const box = document.createElement('div');
  box.innerHTML = html;
  return box.firstElementChild as HTMLElement;
};

describe('keepsOwnUndo', () => {
  it('leaves Mod+Z to a field that keeps text', () => {
    expect(keepsOwnUndo(el('<input>'))).toBe(true);
    expect(keepsOwnUndo(el('<input type="number">'))).toBe(true);
    expect(keepsOwnUndo(el('<textarea></textarea>'))).toBe(true);
    expect(keepsOwnUndo(el('<div contenteditable="true"><b>x</b></div>').firstElementChild)).toBe(
      true,
    );
  });

  it('takes Mod+Z from a control that keeps no undo of its own', () => {
    expect(keepsOwnUndo(el('<input type="range">'))).toBe(false);
    expect(keepsOwnUndo(el('<input type="checkbox">'))).toBe(false);
    expect(keepsOwnUndo(el('<input type="radio">'))).toBe(false);
    expect(keepsOwnUndo(el('<select><option>a</option></select>'))).toBe(false);
    expect(keepsOwnUndo(el('<button>x</button>'))).toBe(false);
    expect(keepsOwnUndo(document.body)).toBe(false);
    expect(keepsOwnUndo(null)).toBe(false);
  });
});
