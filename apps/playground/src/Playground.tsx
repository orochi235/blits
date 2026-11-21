import '@weasel-js/theme/faces.css';
import '@weasel-js/labkit/styles.css';
import { App } from '@pg/app/App';
import { IconRegistryProvider } from '@weasel-js/icons/react';
import { localStorageAdapter, Persistence } from '@weasel-js/labkit';
import { kitIcons } from '@weasel-js/ui/kit-icons';
import { StrictMode, useEffect, useState } from 'react';

// The diagrams bake Oswald's glyphs from a canvas, which draws a fallback face until the file is in.
const FACE = '400 12px Oswald';

/** The whole playground, for a page to mount: its own `index.html`, or the docs site's. */
export function Playground() {
  const [faceIn, setFaceIn] = useState(false);
  useEffect(() => {
    let live = true;
    void document.fonts.load(FACE).finally(() => live && setFaceIn(true));
    return () => {
      live = false;
    };
  }, []);
  return (
    <StrictMode>
      <IconRegistryProvider icons={kitIcons}>
        <Persistence storageKey="blits-playground" storage={localStorageAdapter}>
          {faceIn && <App />}
        </Persistence>
      </IconRegistryProvider>
    </StrictMode>
  );
}
