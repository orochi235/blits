import type { Doubt } from '@msb235/blits';
import { type Composition, isMotion } from '@pg/blits/composition';
import type { Player } from '@pg/blits/player';
import type { Subject } from '@pg/blits/stage';
import { ControlPanel, f, isAuto, resolveConfigSchema } from '@weasel-js/labkit';
import { useState } from 'react';
import { AimField } from './AimField';
import s from './App.module.css';
import { docOf } from './docs';
import {
  FADE,
  FADE_AUTO,
  type FadeConfig,
  fadeNodes,
  fadeOptions,
  riseOptions,
} from './FadeControls';
import m from './PatchLive.module.css';

export interface LivePanelProps {
  player: Player;
  comp: Composition;
  /** The voice's or group's id. */
  id: string;
  /** The subject picked on the stage. */
  subject: Subject | undefined;
  /** Called after each live change, so the panel and the badge redraw. */
  onActed(): void;
}

/** What the panel's own rows hold between presses; weight is the handle's, live. */
interface Held {
  fade: FadeConfig;
  seek: { ms: number; keep: boolean };
  rate: { to: number };
  ramp: { to: number; over: number };
}

/** Bars and wide rows need a row each. */
const ONE_UP = { pack: 'one-up' } as const;

const HELD: Held = {
  fade: FADE,
  seek: { ms: 0, keep: false },
  rate: { to: 1 },
  ramp: { to: 0.25, over: 500 },
};

/** `held` with the value at `path`, a dotted path into it, replaced. */
function withHeld(held: Held, path: string, value: unknown): Held {
  const [group, key] = path.split('.') as [keyof Held, string];
  return { ...held, [group]: { ...held[group], [key]: value } };
}

export function LivePanel({ player, comp, id, subject, onActed }: LivePanelProps) {
  const [held, setHeld] = useState<Held>(HELD);
  const [auto, setAuto] = useState<ReadonlySet<string>>(() => new Set(FADE_AUTO));
  const [doubt, setDoubt] = useState<Doubt | null>(null);
  const v = comp.voices.find((x) => x.id === id);
  const name = (v ?? comp.groups?.find((g) => g.id === id))?.name ?? id;
  const handle = player.handleOf(id);
  if (!handle) return <p className={s.row}>{name} is not running: fix its errors first.</p>;
  const act: Player['live'] = (at, fn) => {
    player.live(at, fn);
    onActed();
  };
  // A voice plays backward below 0; a group's rate does not go below it.
  const rate = (def: number) =>
    v ? f.number(def).step(0.05) : f.number(def).range(0, 1000).input().step(0.05);

  const rated = `rate · now ${handle.rate.toFixed(2)}`;
  const schema = resolveConfigSchema(
    f.schema({
      weight: f
        .number(1)
        .label('weight')

        .range(0, 2)
        .step(0.01)
        .describe(docOf('Handle.weight') ?? ''),
      fade: fadeNodes({
        whole: !v,
        picked: subject !== undefined,
        onFade: () => act(id, (h) => h.fade(fadeOptions(held.fade, auto, subject))),
        onRise: () => act(id, (h) => h.rise(riseOptions(held.fade, auto))),
      }),
      seek: f
        .group({
          ms: f
            .number(0)
            .label('seek to')

            .step(10)
            .suffix('ms')
            .describe(docOf('Handle.seek') ?? ''),
          keep: f.boolean(false).label('keep state'),
          go: f
            .action(() =>
              act(id, (h, _, heard) => {
                const d = h.seek(held.seek.ms, held.seek.keep ? { state: 'keep' } : {});
                if (heard) setDoubt(d);
              }),
            )
            .label('seek'),
        })
        .as('bar')
        .section('seek', ONE_UP),
      ...(doubt
        ? {
            doubt: f.label(`doubt: ${doubt}`).section('seek', ONE_UP),
          }
        : {}),
      rate: f
        .group({
          to: rate(HELD.rate.to)
            .label('rate')
            .describe(docOf('Handle.rate') ?? ''),
          set: f
            .action(() =>
              act(id, (h) => {
                h.rate = held.rate.to;
              }),
            )
            .label('set'),
        })
        .as('bar')
        .section(rated, ONE_UP),
      ramp: f
        .group({
          to: rate(HELD.ramp.to)
            .label('ramp to')
            .describe(docOf('Handle.ramp') ?? ''),
          over: f
            .number(HELD.ramp.over)
            .label('over')

            .range(0, 1e6)
            .input()
            .step(50)
            .suffix('ms'),
          go: f.action(() => act(id, (h) => h.ramp(held.ramp.to, held.ramp.over))).label('ramp'),
        })
        .as('bar')
        .section(rated, ONE_UP),
      ...(v && isMotion(v.patch)
        ? {
            aim: f
              .custom<null>('aim', null)
              .section(v.patch.kind === 'glide' ? 'push' : 'retarget', ONE_UP),
          }
        : {}),
    }),
  );

  const setConfig = (path: string, value: unknown) => {
    if (path === 'weight') {
      const w = value as number;
      // Elsewhere a voice plays silent beside another's solo, and must stay so.
      act(id, (h, _, heard) => {
        if (heard) h.weight = w;
      });
      return;
    }
    const next = new Set(auto);
    if (isAuto(value)) next.add(path);
    else next.delete(path);
    if (next.size !== auto.size) setAuto(next);
    if (!isAuto(value)) setHeld(withHeld(held, path, value));
  };

  return (
    <section className={s.panel} aria-label={`live ${name}`}>
      <ControlPanel
        title={`live · ${name} · ${handle.state}`}
        schema={schema}
        config={{ weight: handle.weight, ...held }}
        setConfig={setConfig}
        auto={auto}
        pack="auto"
        renderers={{
          aim: () =>
            v && isMotion(v.patch) ? (
              <div className={m.wide}>
                <AimField comp={comp} player={player} id={id} patch={v.patch} act={act} />
              </div>
            ) : null,
        }}
      />
    </section>
  );
}
