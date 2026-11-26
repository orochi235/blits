import { curve } from './easing.js';
import type {
  Anchor,
  ArcCue,
  ArcVoice,
  Ease,
  Handle,
  Kind,
  KindCue,
  KindVoice,
  Mix,
  OwnerSpec,
  Patch,
  Piece,
  Placement,
  Show,
  ShowHandle,
  VoiceSpec,
} from './types.js';

export type {
  ArcCue,
  Cue,
  CueBase,
  Ease,
  Fade,
  Json,
  Kind,
  KindCue,
  KindInput,
  KindVoice,
  Piece,
  Show,
  ShowHandle,
} from './types.js';

type Kinds<I, O, H> = { readonly [kind: string]: Kind<I, O, H> };
// biome-ignore lint/suspicious/noExplicitAny: a patch naming no host fits a mix naming one
type AnyPatch<I, O, H> = Patch<I, O, any, H>;

/** `anchor` moved later by `ms`. Every form takes it: `before` counts back from its target's start. */
function shifted(anchor: Anchor, ms: number): Anchor {
  if ('all' in anchor) return { all: anchor.all.map((a) => shifted(a, ms)) };
  if ('any' in anchor) return { any: anchor.any.map((a) => shifted(a, ms)) };
  if ('of' in anchor) return { ...anchor, by: (anchor.by ?? 0) + ms };
  if ('after' in anchor) return { after: anchor.after, by: (anchor.by ?? 0) + ms };
  if ('with' in anchor) return { with: anchor.with, by: (anchor.by ?? 0) + ms };
  return { with: anchor.before, by: ms - (anchor.by ?? 0) };
}

/** `patch` with its phase run through `ease`. Refused where the patch's shape is read as data. */
function eased<I, O, H>(patch: AnyPatch<I, O, H>, ease: Ease | undefined): AnyPatch<I, O, H> {
  if (ease === undefined) return patch;
  if (patch.form !== 'fn' || patch.wave !== undefined)
    throw new Error(
      `blits: a cue's ease warps the phase of a patch() patch, and this is a ${patch.wave ? 'wave' : patch.form} patch, whose shape is read as data`,
    );
  const c = curve(ease);
  const at = patch.at;
  return { ...patch, at: (phase, subject, setting) => at.call(patch, c(phase), subject, setting) };
}

const isPatch = <I, O, H>(x: object): x is AnyPatch<I, O, H> => 'form' in x && 'at' in x;

/** What a kind makes for `cue`, as voices with `ease` on each patch. */
function voicesOf<I, O, H>(
  kinds: Kinds<I, O, H>,
  cue: KindCue | Piece,
  length: number | undefined,
  where: string,
): KindVoice<I, O, H>[] {
  const kind = kinds[cue.kind];
  if (kind === undefined)
    throw new Error(`blits: ${where} plays kind "${cue.kind}", which kinds lacks`);
  if (length !== undefined && !(length >= 0 && Number.isFinite(length)))
    throw new RangeError(`blits: ${where} lasts 0 ms or more, not ${length}`);
  const made = kind(cue.params ?? {}, { length, cue });
  const list: readonly KindVoice<I, O, H>[] = isPatch<I, O, H>(made)
    ? [{ patch: made }]
    : Array.isArray(made)
      ? made
      : [made as KindVoice<I, O, H>];
  if (list.length === 0) throw new Error(`blits: ${where}'s kind "${cue.kind}" made no voice`);
  return list.map((v) => ({ ...v, patch: eased(v.patch, cue.ease) }));
}

const listOf = <T>(x: T | readonly T[] | undefined): readonly T[] | undefined =>
  x === undefined ? undefined : Array.isArray(x) ? x : [x as T];

const ARC_ONLY = ['enter', 'active', 'exit', 'hold', 'blend'] as const;
const KIND_ONLY = ['params', 'length', 'end', 'ease', 'freeze'] as const;

function playKind<I, O, H>(
  mix: Mix<I, O, H>,
  owner: Handle<I>,
  cue: KindCue,
  show: Show,
  kinds: Kinds<I, O, H>,
  where: string,
): Handle<I>[] {
  for (const key of ARC_ONLY)
    if (cue[key as keyof KindCue] !== undefined)
      throw new Error(`blits: ${where} names a kind, so it takes no ${key}, which is an arc cue's`);
  if (cue.length !== undefined && cue.end !== undefined)
    throw new Error(`blits: ${where} takes a length or an end, not both`);
  const start = cue.start ?? 0;
  let length = cue.length;
  if (length === undefined && typeof start === 'number') {
    if (typeof cue.end === 'number') length = cue.end - start;
    else if (cue.end === undefined && show.duration !== undefined) length = show.duration - start;
  }
  const voices = voicesOf(kinds, cue, length, where);
  const anchor: Placement = { start };
  const frozen = cue.freeze === 'after' || cue.freeze === 'both';
  if (!frozen) {
    if (cue.end !== undefined) anchor.end = cue.end;
    else if (length !== undefined)
      anchor.end = typeof start === 'number' ? start + length : shifted(start, length);
  }
  return voices.map((v, i) => {
    const spec: VoiceSpec<I, O, H> = { ...v, owner, anchor };
    if (i === 0 && cue.name !== undefined) spec.name = cue.name;
    if (cue.fade !== undefined) spec.fade = cue.fade;
    if (cue.freeze !== undefined) spec.freeze = cue.freeze;
    if (cue.muted) spec.weight = 0;
    return mix.cue(spec);
  });
}

function playArc<I, O, H>(
  mix: Mix<I, O, H>,
  owner: Handle<I>,
  cue: ArcCue,
  kinds: Kinds<I, O, H>,
  where: string,
): Handle<I> {
  for (const key of KIND_ONLY)
    if (cue[key as keyof ArcCue] !== undefined)
      throw new Error(`blits: ${where} is an arc cue, so it takes no ${key}; its pieces set it`);
  const part = (name: 'enter' | 'active' | 'exit') =>
    listOf(cue[name])?.flatMap((piece, i) =>
      voicesOf(kinds, piece, piece.length, `${where}'s ${name} ${i}`).map(
        (v): ArcVoice<I, O, H> =>
          piece.length === undefined ? v : { ...v, duration: piece.length },
      ),
    );
  return mix.arc({
    owner,
    anchor: { start: cue.start ?? 0 },
    ...(cue.name !== undefined && { name: cue.name }),
    ...(cue.fade !== undefined && { fade: cue.fade }),
    ...(cue.muted && { weight: 0 }),
    ...(cue.hold !== undefined && { hold: cue.hold }),
    ...(cue.blend !== undefined && { blend: cue.blend }),
    enter: part('enter'),
    active: part('active'),
    exit: part('exit'),
  });
}

/**
 * Cues `show` on `mix` under one owner, made from `spec` and named for the show unless `spec`
 * names it. Each kind cue is its kind's voices, placed, faded and frozen as the cue says; each arc
 * cue is a `mix.arc`. A bare name in a cue's anchor means another cue of the show. Kinds are
 * called once per cue, in show order. The owner's handle stops the show (`fade()`), or drops it
 * at once (`fade({ over: 0 })`); a show with no cues is dropped as it is played.
 *
 * @category show
 */
export function play<I, O, H = unknown>(
  mix: Mix<I, O, H>,
  show: Show,
  kinds: Kinds<I, O, H>,
  spec: OwnerSpec<I, H> = {},
): ShowHandle<I> {
  const name = spec.name ?? show.name;
  const owner = mix.owns(name === undefined ? spec : { ...spec, name });
  const cues = show.cues.map((cue, i) => {
    const where = `cue ${i}${cue.name === undefined ? '' : ` ("${cue.name}")`} of show${show.name === undefined ? '' : ` "${show.name}"`}`;
    return 'kind' in cue && cue.kind !== undefined
      ? playKind(mix, owner, cue, show, kinds, where)
      : [playArc(mix, owner, cue as ArcCue, kinds, where)];
  });
  if (cues.length === 0) owner.fade({ over: 0 });
  return Object.assign(owner, { cues });
}
