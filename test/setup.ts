import { afterEach } from 'vitest';
import { defaults } from '../src/mixer.js';

// `BLITS_LANES=off` runs the whole suite on the general path; `npm run test:general` sets it.
if (process.env.BLITS_LANES === 'off') defaults.lanes = false;

// A WeakRef keeps its target alive until a macrotask turn, and vitest moves between tests without
// one, so every mix a file made would stay in memory to its end.
afterEach(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
