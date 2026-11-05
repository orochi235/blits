import { IMPORTED } from './glyphs/fonts/index.js';
import { SLIM } from './glyphs/slim.js';
import { STANDARD } from './glyphs/standard.js';
import { STROKES } from './glyphs/strokes.js';
import { tableFace } from './glyphs/table.js';

/**
 * A dot-matrix face: each character's dots, top row first, `#` lit, every row as wide as the
 * glyph. A character the face lacks is drawn as its space.
 */
export interface Face {
  readonly name: string;
  readonly about?: string;
  /** How many dots tall every glyph is, ghost rows included. */
  readonly rows: number;
  /**
   * Ghost rows: glyph rows above and below the body, the letters' own height that lines are spaced
   * by. They draw into the gap between lines or the sign's margin. Default 0.
   */
  readonly above?: number;
  readonly below?: number;
  /** How many dots wide its widest glyph is; a fixed-pitch letter takes this and a blank. */
  readonly width: number;
  glyph(ch: string): readonly string[] | undefined;
}

/** A face derived from `base`, each glyph's rows passed through `row`, its widest `width`. */
const derived = (
  base: Face,
  name: string,
  about: string,
  width: number,
  row: (r: string) => string,
): Face => {
  const cache = new Map<string, readonly string[] | undefined>();
  return {
    name,
    about,
    rows: base.rows,
    width,
    glyph(ch) {
      if (!cache.has(ch)) cache.set(ch, base.glyph(ch)?.map(row));
      return cache.get(ch);
    },
  };
};

const standard = tableFace('standard', 'The classic 5 × 7 dot-matrix letters.', STANDARD);

const lit = (r: string, x: number) => r[x] === '#';

const faces = {
  standard,
  slim: tableFace('slim', 'Narrow 3 × 7 letters, fitting more text across the sign.', SLIM),
  wide: derived(standard, 'wide', 'The standard letters with every column doubled.', 10, (r) =>
    [...r].map((c) => c + c).join(''),
  ),
  bold: derived(
    standard,
    'bold',
    'The standard letters drawn with a double stroke, each lit dot also lighting the one to its right.',
    6,
    (r) =>
      Array.from({ length: r.length + 1 }, (_, x) => (lit(r, x) || lit(r, x - 1) ? '#' : '.')).join(
        '',
      ),
  ),
  ...IMPORTED,
  strokes: STROKES,
};

export type FaceName = keyof typeof faces;

const doubled = new WeakMap<Face, Face>();

/** `face` with every column doubled, ghost rows kept: a triangle sign's text, two places to a dot. */
export function widened(face: Face): Face {
  let wide = doubled.get(face);
  if (!wide) {
    const cache = new Map<string, readonly string[] | undefined>();
    wide = {
      ...face,
      name: `${face.name} doubled`,
      width: face.width * 2,
      glyph(ch) {
        if (!cache.has(ch))
          cache.set(
            ch,
            face.glyph(ch)?.map((r) => [...r].map((c) => c + c).join('')),
          );
        return cache.get(ch);
      },
    };
    doubled.set(face, wide);
  }
  return wide;
}
/** The built-in faces, by name. */
export const FACES: Readonly<Record<FaceName, Face>> = faces;
/** Every character the built-in faces draw something for. */
export const CHARS: readonly string[] = Object.keys(STANDARD).filter((ch) => ch !== ' ');
/** Every built-in face's name. */
export const FACE_NAMES = Object.keys(faces) as readonly FaceName[];

/** A face given by name or in full; throws on a name no built-in has. */
export function faceOf(face: FaceName | Face = 'standard'): Face {
  if (typeof face !== 'string') return face;
  if (!Object.hasOwn(FACES, face)) throw new Error(`bree: no face named ${face}`);
  return FACES[face];
}
