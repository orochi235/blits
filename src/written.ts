/** Each source made into a function once, by its parameters and body. */
const made = new Map<string, unknown>();
/** `Function` refused once: under a CSP each refusal fires a violation, so it is not asked again. */
let refused = false;

/**
 * `new Function(...params, body)`, made once a source, or undefined where `Function` is refused,
 * for a caller to fall back on a loop. Written out with each channel's name in place, a load or
 * store keeps one shape where a name that varies would go megamorphic and box every number.
 */
export function written<F>(params: readonly string[], body: string): F | undefined {
  const key = `${params.join(',')}\n${body}`;
  let make = made.get(key);
  if (make === undefined && !refused) {
    try {
      make = new Function(...params, body);
      made.set(key, make);
    } catch {
      refused = true;
    }
  }
  return make as F | undefined;
}
