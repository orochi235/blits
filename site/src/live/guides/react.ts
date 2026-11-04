import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Demo } from './react-stage';

export default function run(root: HTMLElement): () => void {
  const host = document.createElement('div');
  host.className = 'react-demo';
  const counts = document.createElement('p');
  counts.className = 'react-counts';
  const renders = document.createElement('span');
  const frames = document.createElement('span');
  counts.append('React renders ', renders, ' frames drawn ', frames);
  root.append(host, counts);

  // Both readouts are written here, outside React, so showing them renders nothing.
  let rendered = 0;
  let drawn = 0;
  renders.textContent = '0';
  frames.textContent = '0';
  const onRender = () => {
    renders.textContent = String(++rendered);
  };
  const onFrame = () => {
    frames.textContent = String(++drawn);
  };

  const app = createRoot(host);
  app.render(createElement(StrictMode, null, createElement(Demo, { root, onRender, onFrame })));
  return () => {
    // Live stops this from inside its own React commit, where a synchronous unmount is refused.
    queueMicrotask(() => app.unmount());
  };
}
