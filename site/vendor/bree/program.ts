import { type Handle, type Mix, type Patch, patch, type Signal } from '@msb235/blits';
import { type Board, everyOf, type Pose, type Subject } from './board.js';
import { EFFECTS, LAYERS, type LayerSpec } from './builtins.js';
import { cueEffect, type EffectSpec, type StagedEffect, stageEffect } from './effects.js';
import { type Look, rasterize } from './font.js';
import { MODULATORS } from './modulators/index.js';
import { onGpu, ranked, stretch } from './modulators/shader.js';
import { type Placed, place, placeText, rankOf } from './orders.js';
import { type ParamValue, values } from './params.js';
import { TOGETHER } from './pieces.js';
import { tuned } from './tuning.js';

/**
 * A layer a scene plays under its message: a built-in's name with true, or a spec, which for a
 * built-in's name is laid over the built-in. `on: false` keeps a spec's settings and plays nothing.
 */
export type SceneLayer = boolean | (Partial<LayerSpec> & { readonly on?: boolean });

/**
 * One message in a program: its text and color, the effect it plays with, a hold overriding the
 * effect's, the face and style it is drawn in (default the standard face, plain), and the layers
 * that play across it, by name.
 */
export interface Scene extends Look {
  readonly text: string;
  readonly hex: number;
  readonly effect: string | EffectSpec;
  readonly hold?: number;
  /** Values for what its effect lets a scene tune, by name. */
  readonly params?: Readonly<Record<string, ParamValue>>;
  readonly layers?: Readonly<Record<string, SceneLayer>>;
}

/** A scene's layer as a spec to play, or null when it is off; throws on a name with no spec. */
export function layerOf(name: string, layer: SceneLayer): LayerSpec | null {
  if (layer === false || (typeof layer === 'object' && layer.on === false)) return null;
  const base = Object.hasOwn(LAYERS, name) ? LAYERS[name as keyof typeof LAYERS] : undefined;
  const given = typeof layer === 'object' ? layer : {};
  const mod = given.mod ?? base?.mod;
  if (!mod) throw new Error(`bree: no layer named ${name}`);
  return {
    ...base,
    ...given,
    mod,
    params: { ...base?.params, ...given.params },
  } as LayerSpec;
}

/** A scene's effect, looked up in `effects` before the built-ins. */
export function effectOf(
  scene: Scene,
  effects: Readonly<Record<string, EffectSpec>> = {},
): EffectSpec {
  if (typeof scene.effect !== 'string') return scene.effect;
  const name = scene.effect;
  if (Object.hasOwn(effects, name)) return effects[name] as EffectSpec;
  if (Object.hasOwn(EFFECTS, name)) return EFFECTS[name as keyof typeof EFFECTS];
  throw new Error(`bree: no effect named ${name}`);
}

/** A scene of a program staged to play: which scene it is, and what it plays. */
export interface StagedScene {
  /** Its index in the scenes it was staged from. */
  readonly scene: number;
  readonly staged: StagedEffect;
  readonly name: string;
  /** Its layers, each one pass as long as the scene. */
  readonly layers: readonly StagedLayer[];
}

/** A layer staged for one scene: its modulator stretched to one pass of the scene's length. */
export interface StagedLayer {
  readonly name: string;
  readonly patch: Patch<Subject, Pose>;
  readonly subjects: readonly Subject[];
  readonly weight: number;
}

/**
 * Stages each scene of a program that plays for some time, in order; one taller than the board
 * shows what fits. Throws on a scene naming no effect or face, before anything is cued. Staged for
 * a mix on the gpu engine (`gpu`), its moves and layers are shader patches where they can be.
 */
export function stageProgram(
  b: Board,
  scenes: readonly Scene[],
  effects?: Readonly<Record<string, EffectSpec>>,
  gpu = false,
): StagedScene[] {
  return scenes.flatMap((scene, i) => {
    const effect = effectOf(scene, effects);
    const at = placeText(b, scene.text, scene);
    const s = stageEffect(tuned(effect, scene.params), at, scene.hex, scene.hold, gpu);
    if (s.ms <= 0) return [];
    const layers = Object.entries(scene.layers ?? {}).flatMap(([name, layer]) => {
      const spec = layerOf(name, layer);
      return spec ? [stageLayer(b, name, spec, s.ms, at, gpu)] : [];
    });
    return [{ scene: i, staged: s, name: `${effect.name} ${scene.text}`, layers }];
  });
}

/**
 * Cues staged scenes under a program owner of its own, each on an owner of its own where the one
 * before it ends, and returns the program owner, done after the last scene.
 */
export function cueProgram(m: Mix<Subject, Pose>, staged: readonly StagedScene[]): Handle<Subject> {
  const program = m.owns({ name: 'program' });
  let start = 0;
  for (const { staged: s, name, layers } of staged) {
    const owner = m.owns({ owner: program, start, name });
    cueEffect(m, owner, s, name);
    for (const l of layers)
      m.cue({ owner, name: l.name, patch: l.patch, subjects: l.subjects, weight: l.weight });
    start += s.ms;
  }
  // An owner holding nothing would stay until faded.
  if (start === 0) program.fade({ over: 0 });
  return program;
}

/**
 * Cues one pass of a program under an owner of its own, each scene that fits the board on an owner
 * of its own where the one before it ends, and returns the program owner, done after the last scene.
 */
export function play(
  m: Mix<Subject, Pose>,
  b: Board,
  scenes: readonly Scene[],
  effects?: Readonly<Record<string, EffectSpec>>,
): Handle<Subject> {
  return cueProgram(m, stageProgram(b, scenes, effects, onGpu(m)));
}

/**
 * A layer's modulator on the board, one cycle a pass, and the subjects it plays on. A scene's layer
 * is placed against its message, so a spread by letter follows the letters; a sign's has none. For
 * the gpu engine (`gpu`) it is a shader patch on every subject where the modulator has one, which
 * elsewhere would only add work.
 */
function layerPatch(
  b: Board,
  layer: LayerSpec,
  at: Placed,
  gpu: boolean,
): { patch: Patch<Subject, Pose>; subjects: readonly Subject[] } {
  const mod = MODULATORS[layer.mod];
  const p = values(mod, layer.params as never);
  const order = layer.spread ?? TOGETHER;
  const shaded = gpu ? mod.shader?.(at, p, ranked(order, b)) : null;
  if (shaded) return { patch: shaded, subjects: everyOf(b) };
  return {
    patch: mod.patch(at, p, rankOf(order, at)),
    subjects: mod.on === 'cells' ? b.cells : b.dots,
  };
}

/** A layer for one scene: its cycles laid end to end through one pass `ms` long, against `at`. */
function stageLayer(
  b: Board,
  name: string,
  layer: LayerSpec,
  ms: number,
  at: Placed,
  gpu: boolean,
): StagedLayer {
  const { patch: cycle, subjects } = layerPatch(b, layer, at, gpu);
  const weight = layer.weight ?? 1;
  const shaded = stretch(cycle, ms);
  if (shaded) return { name, patch: shaded, subjects, weight };
  const cycles = ms / Math.max(1, cycle.duration);
  if (cycle.form !== 'fn') throw new Error(`bree: layer ${name} is not a plain patch`);
  const stretched = patch<Subject, Pose>(
    ms,
    (phase, subject, setting) => cycle.at((phase * cycles) % 1, subject, setting),
    { writes: cycle.writes, ...(cycle.kit && { kit: cycle.kit }) },
  );
  return { name, patch: stretched, subjects, weight };
}

/** Cues a layer's modulator looping on its subjects for good, weighted by `weight`. */
export function cueLayer(
  m: Mix<Subject, Pose>,
  b: Board,
  layer: LayerSpec,
  weight: number | Signal<Subject>,
): Handle<Subject> {
  const { patch: cycle, subjects } = layerPatch(b, layer, place(b, rasterize('')), onGpu(m));
  return m.cue({ name: layer.mod, patch: cycle, subjects, loop: true, weight });
}
