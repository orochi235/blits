import * as audio from 'node-web-audio-api';

// Tone looks for Web Audio on `window` as it loads, so it loads after this, and the driver after
// it. A test takes both from here, never from their own modules.
Object.assign(globalThis, { window: globalThis, ...audio });

export const Tone = await import('tone');
export const { drive } = await import('../src/index.js');
