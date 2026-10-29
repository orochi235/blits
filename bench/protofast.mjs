// Prints whether a mix's prototype and the mix itself have fast (not dictionary-mode) properties,
// and how many own properties each holds. Run with --allow-natives-syntax.
//   node --allow-natives-syntax bench/protofast.mjs
import { kit, mix, sum } from '../dist/index.js';

const m = mix(kit({ gain: sum() }));
const proto = Object.getPrototypeOf(m);
const fast = new Function('o', 'return %HasFastProperties(o)');
console.log(
  `prototype: ${Object.getOwnPropertyNames(proto).length} own, fast ${fast(proto)}; ` +
    `mix: ${Object.getOwnPropertyNames(m).length} own, fast ${fast(m)}`,
);
