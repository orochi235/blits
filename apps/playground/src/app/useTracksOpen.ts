import { useState } from 'react';

const KEY = 'blits-playground:tracks';

/** Whether the score's lanes are open, remembered per viewer, and a toggle for it. */
export function useTracksOpen(): [boolean, () => void] {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'closed';
    } catch {
      return true;
    }
  });
  const toggle = () =>
    setOpen((was) => {
      try {
        localStorage.setItem(KEY, was ? 'closed' : 'open');
      } catch {}
      return !was;
    });
  return [open, toggle];
}
