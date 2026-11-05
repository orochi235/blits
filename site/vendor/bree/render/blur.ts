/** The blur's taps either side of center. */
export const TAPS = 16;

/** One axis's weights for a Gaussian of `sigma` texels, and the texels between taps. */
export function gaussian(sigma: number): { weights: Float32Array; spacing: number } {
  const spacing = Math.max(1, (3 * sigma) / TAPS);
  const weights = new Float32Array(TAPS + 1);
  let sum = 0;
  for (let i = 0; i <= TAPS; i++) {
    const d = i * spacing;
    weights[i] = Math.exp(-(d * d) / (2 * sigma * sigma));
    sum += (i === 0 ? 1 : 2) * (weights[i] as number);
  }
  for (let i = 0; i <= TAPS; i++) weights[i] = (weights[i] as number) / sum;
  return { weights, spacing };
}
