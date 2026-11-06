import '@weasel-js/theme/faces.css';
import { Playground } from '@pg/Playground';
import { createRoot } from 'react-dom/client';

// blits' debug panel, over every mix the playground names, as on the site.
if (new URLSearchParams(location.search).has('panel'))
  void import('@msb235/blits-panel').then(({ mount }) => mount());

// The diagrams bake Oswald's glyphs from a canvas, which draws a fallback face until the file is in.
void document.fonts
  .load('400 12px Oswald')
  .finally(() => createRoot(document.getElementById('root') as HTMLElement).render(<Playground />));
