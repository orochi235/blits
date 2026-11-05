import '@weasel-js/labkit/styles.css';
import { App } from '@pg/app/App';
import { IconRegistryProvider } from '@weasel-js/core';
import { kitIcons } from '@weasel-js/ui/kit-icons';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// blits' debug panel, over every mix the playground names, as on the site.
if (new URLSearchParams(location.search).has('panel'))
  void import('@msb235/blits-panel').then(({ mount }) => mount());

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <IconRegistryProvider icons={kitIcons}>
      <App />
    </IconRegistryProvider>
  </StrictMode>,
);
