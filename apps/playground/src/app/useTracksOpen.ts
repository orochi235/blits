import { usePersistedState } from '@weasel-js/labkit';

/** Whether the score's lanes are open, remembered per viewer, and a toggle for it. */
export function useTracksOpen(): [boolean, () => void] {
  const [open, setOpen] = usePersistedState('tracksOpen', true, { scope: 'lab' });
  return [open, () => setOpen((was) => !was)];
}
