import { bothOf } from '@pg/blits/both';
import type { Composition } from '@pg/blits/composition';
import { flowOf } from '@pg/blits/flow';
import type { Player } from '@pg/blits/player';
import { lit, liveOf, timingOf } from '@pg/blits/timing';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { useMemo, useRef } from 'react';
import s from './FlowPanel.module.css';
import { flowKey } from './flowKey';
import { useSize } from './useSize';

export interface BothPanelProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function BothPanel({ comp, faulted, player, selected, onVoice }: BothPanelProps) {
  const flow = useMemo(() => flowOf(comp, faulted), [comp, faulted]);
  const timing = useMemo(() => timingOf(comp, faulted), [comp, faulted]);
  const now = bothOf(flow, lit(timing, liveOf(player.built, player.host)));
  const kept = useRef({ key: flowKey(now), flow: now });
  const key = flowKey(now);
  if (kept.current.key !== key) kept.current = { key, flow: now };
  const shown = kept.current.flow;
  const [size, ref] = useSize();
  const nodeOf = (id: string) =>
    comp.groups?.some((g) => g.id === id) ? `group:${id}` : `voice:${id}`;
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:') || id?.startsWith('group:'))
      onVoice(id.slice(id.indexOf(':') + 1));
  };
  return (
    <section className={s.panel} aria-label="both">
      <p className={s.crumbs}>blue edge: signal flow · amber edge: what waits on what</p>
      <div ref={ref} className={s.canvas}>
        {size && (
          <FlowDiagram
            flow={shown}
            width={size.width}
            height={size.height}
            selected={selected ? nodeOf(selected) : null}
            onSelect={pick}
          />
        )}
      </div>
    </section>
  );
}
