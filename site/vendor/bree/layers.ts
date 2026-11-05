import type { Handle, Mix } from '@msb235/blits';
import type { Board, Pose, Subject } from './board.js';
import { LAYERS, type LayerSpec } from './builtins.js';
import type { ParamValue } from './params.js';
import { cueLayer } from './program.js';

/** A built-in's name with on, off or a weight, or a full spec under any name. */
export type LayerOption = boolean | number | LayerSpec;

/** A sign's layers, each looping for good at a weight that turns it on and off. */
export interface Layers {
  /** Turns a layer on or off, or sets the weight it plays at; `params` re-cue it with them. */
  set(name: string, on: boolean | number, params?: Readonly<Record<string, ParamValue>>): void;
}

const weightOf = (spec: LayerSpec, on: boolean | number) =>
  on === true ? (spec.weight ?? 1) : on === false ? 0 : on;

interface Layer {
  spec: LayerSpec;
  /**
   * Cued only while its weight is above 0: the mix visits every cued voice's every subject each
   * frame, at weight 0 too.
   */
  voice: Handle<Subject> | null;
  /** The mix time its loop counts from, so turning it on finds it where it would have been. */
  from: number;
}

/** Cues each of `given` as it asks, holding every other built-in off; throws on a name it lacks. */
export function cueLayers(
  m: Mix<Subject, Pose>,
  b: Board,
  given: Partial<Record<string, LayerOption>> = {},
): Layers {
  const layers = new Map<string, Layer>();
  // A voice cued before the mix's first frame starts at its time 0.
  const clock = () => (Number.isNaN(m.now) ? 0 : m.now);
  const weigh = (layer: Layer, w: number) => {
    if (!(w > 0)) {
      layer.voice?.fade({ over: 0 });
      layer.voice = null;
    } else if (layer.voice) layer.voice.weight = w;
    else {
      layer.voice = cueLayer(m, b, layer.spec, w);
      const since = m.now - layer.from;
      if (since > 0) layer.voice.seek(since);
    }
  };
  const add = (name: string, spec: LayerSpec, on: boolean | number) => {
    const layer: Layer = { spec, voice: null, from: clock() };
    layers.set(name, layer);
    weigh(layer, weightOf(spec, on));
  };
  for (const [name, spec] of Object.entries(LAYERS)) add(name, spec, false);
  for (const [name, v] of Object.entries(given)) {
    if (v === undefined) continue;
    const known = layers.get(name);
    if (typeof v === 'object') {
      known?.voice?.fade({ over: 0 });
      add(name, v, true);
    } else if (known) weigh(known, weightOf(known.spec, v));
    else throw new Error(`bree: no layer named ${name}`);
  }
  return {
    set(name, on, params) {
      const layer = layers.get(name);
      if (!layer) throw new Error(`bree: no layer named ${name}`);
      if (params) {
        // Fresh params start the layer's loop over.
        layer.voice?.fade({ over: 0 });
        layer.voice = null;
        layer.spec = { ...layer.spec, params: { ...layer.spec.params, ...params } };
        layer.from = clock();
      }
      weigh(layer, weightOf(layer.spec, on));
    },
  };
}
