// Robert Penner's easing curves as functions, with the usual constants: the source the named
// curves in src/penner.ts are fit to, and what test/penner.test.ts checks them against.

const C1 = 1.70158;
const C2 = C1 * 1.525;
const C4 = (2 * Math.PI) / 3;
const C5 = (2 * Math.PI) / 4.5;

const outBounce = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};
const inBack = (t) => t * t * (C1 * (t - 1) + t);

export const penner = {
  easeInQuad: (t) => t * t,
  easeOutQuad: (t) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t)),
  easeInCubic: (t) => t * t * t,
  easeOutCubic: (t) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeInQuart: (t) => t ** 4,
  easeOutQuart: (t) => 1 - (1 - t) ** 4,
  easeInOutQuart: (t) => (t < 0.5 ? 8 * t ** 4 : 1 - (-2 * t + 2) ** 4 / 2),
  easeInQuint: (t) => t ** 5,
  easeOutQuint: (t) => 1 - (1 - t) ** 5,
  easeInOutQuint: (t) => (t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2),
  easeInSine: (t) => (t === 1 ? 1 : 1 - Math.cos((t * Math.PI) / 2)),
  easeOutSine: (t) => Math.sin((t * Math.PI) / 2),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2,
  easeInExpo: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  easeOutExpo: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  easeInOutExpo: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2,
  easeInCirc: (t) => 1 - Math.sqrt(1 - t * t),
  easeOutCirc: (t) => Math.sqrt(1 - (t - 1) ** 2),
  easeInOutCirc: (t) =>
    t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2,
  easeInBack: inBack,
  easeOutBack: (t) => 1 - inBack(1 - t),
  easeInOutBack: (t) =>
    t < 0.5
      ? ((2 * t) ** 2 * ((C2 + 1) * 2 * t - C2)) / 2
      : ((2 * t - 2) ** 2 * ((C2 + 1) * (2 * t - 2) + C2) + 2) / 2,
  easeInElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * C4),
  easeOutElastic: (t) =>
    t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * C4) + 1,
  easeInOutElastic: (t) =>
    t === 0
      ? 0
      : t === 1
        ? 1
        : t < 0.5
          ? -(2 ** (20 * t - 10) * Math.sin((20 * t - 11.125) * C5)) / 2
          : (2 ** (-20 * t + 10) * Math.sin((20 * t - 11.125) * C5)) / 2 + 1,
  easeInBounce: (t) => 1 - outBounce(1 - t),
  easeOutBounce: outBounce,
  easeInOutBounce: (t) =>
    t < 0.5 ? (1 - outBounce(1 - 2 * t)) / 2 : (1 + outBounce(2 * t - 1)) / 2,
};
