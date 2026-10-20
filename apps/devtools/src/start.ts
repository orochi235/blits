// Runs in every page as it starts, in the page's own world. Costs a sessionStorage read unless
// the tab asked for history, and then gives every mix made after it that history.
import { watched } from '@msb235/blits';
import { createHistory } from '@weasel-js/history';
import { MARK } from './names.js';

try {
  const ms = Number(sessionStorage.getItem(MARK));
  if (ms > 0 && watched().history === undefined) watched().history = { ms, tape: createHistory };
} catch {}
