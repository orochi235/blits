import { defaults } from '../src/mixer.js';

// `BLITS_LANES=off` runs the whole suite on the general path; `npm run test:general` sets it.
if (process.env.BLITS_LANES === 'off') defaults.lanes = false;
