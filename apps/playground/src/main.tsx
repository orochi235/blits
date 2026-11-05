import { Playground } from '@pg/Playground';
import { createRoot } from 'react-dom/client';

// blits' debug panel, over every mix the playground names, as on the site.
if (new URLSearchParams(location.search).has('panel'))
  void import('@msb235/blits-panel').then(({ mount }) => mount());

createRoot(document.getElementById('root') as HTMLElement).render(<Playground />);
