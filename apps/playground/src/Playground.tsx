import '@weasel-js/labkit/styles.css';
import { App } from '@pg/app/App';
import { IconRegistryProvider } from '@weasel-js/core';
import { localStorageAdapter, Persistence } from '@weasel-js/labkit';
import { kitIcons } from '@weasel-js/ui/kit-icons';
import { StrictMode } from 'react';

/** The whole playground, for a page to mount: its own `index.html`, or the docs site's. */
export function Playground() {
  return (
    <StrictMode>
      <IconRegistryProvider icons={kitIcons}>
        <Persistence storageKey="blits-playground" storage={localStorageAdapter}>
          <App />
        </Persistence>
      </IconRegistryProvider>
    </StrictMode>
  );
}
