/** A time in milliseconds, to a tenth. */
export const ms = (n: number) => n.toFixed(1);

/** A time in milliseconds for a readout that holds still: padded to 99,999.9 ms, its unit after. */
export const msWide = (n: number) =>
  Number.isFinite(n) ? `${ms(n).padStart(7)} ms` : '   none   ';
