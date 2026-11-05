/** A number a setting is tuned by, with the range a control should offer and its default. */
export interface NumberParam {
  readonly label: string;
  /** What the setting does, in plain words, for a control's tooltip. */
  readonly about: string;
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly value: number;
  readonly unit?: string;
  /** What a control multiplies the value by to show it, such as 100 for a share shown in percent. */
  readonly scale?: number;
}

/** A setting that is one of a fixed set of words. */
export interface ChoiceParam {
  readonly label: string;
  readonly about: string;
  readonly choices: readonly string[];
  readonly value: string;
}

/** A setting that is a list of colors, as 0xRRGGBB numbers. */
export interface ColorsParam {
  readonly label: string;
  readonly about: string;
  readonly colors: readonly number[];
}

export type Param = NumberParam | ChoiceParam | ColorsParam;
export type Params = Readonly<Record<string, Param>>;
export type ParamValue = number | string | readonly number[];

/** What a setting of each kind holds. */
export type ValueOf<P extends Param> = P extends NumberParam
  ? number
  : P extends ChoiceParam
    ? string
    : readonly number[];

export type Values<P extends Params> = { readonly [K in keyof P]: ValueOf<P[K]> };

/** A length of time as given through the API, ms: negative counts as 0, and NaN as unset. */
export const duration = (ms: number | undefined): number | undefined =>
  ms === undefined || Number.isNaN(ms) ? undefined : Math.max(0, ms);

/** What a setting takes when nothing sets it. */
export const defaultOf = (param: Param): ParamValue =>
  'colors' in param ? param.colors : param.value;

/** Whether `v` is a value of `p`'s kind, one of its choices for a choice. */
export const fits = (p: Param, v: unknown): v is ParamValue =>
  'colors' in p
    ? Array.isArray(v) && v.length > 0 && v.every((c) => Number.isFinite(c))
    : 'choices' in p
      ? typeof v === 'string' && p.choices.includes(v)
      : typeof v === 'number' && Number.isFinite(v);

/** `v` held to `p`: a number clamped to its range, anything else as it is. */
export const held = (p: Param, v: ParamValue): ParamValue =>
  'min' in p && typeof v === 'number' ? Math.min(p.max, Math.max(p.min, v)) : v;

/**
 * A thing's defaults with `given` laid over them, each number clamped to its setting's range. A
 * value of the wrong kind, NaN among them, gives way to the default.
 */
export function values<P extends Params>(
  of: { readonly params: P },
  given: Partial<Values<P>> = {},
): Values<P> {
  const out: Record<string, ParamValue> = {};
  for (const [key, param] of Object.entries(of.params)) {
    const v = (given as Record<string, unknown>)[key];
    out[key] = held(param, fits(param, v) ? v : defaultOf(param));
  }
  return out as Values<P>;
}
