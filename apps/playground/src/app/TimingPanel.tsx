import type { Composition } from '@pg/blits/composition';
import type { Player } from '@pg/blits/player';
import { lit, liveOf, timingOf } from '@pg/blits/timing';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { useMemo, useRef } from 'react';
import s from './FlowPanel.module.css';
import { flowKey } from './flowKey';
import { useSize } from './useSize';

export interface TimingPanelProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function TimingPanel({ comp, faulted, player, selected, onVoice }: TimingPanelProps) {
  const timing = useMemo(() => timingOf(comp, faulted), [comp, faulted]);
  const now = lit(timing, liveOf(player.built, player.host));
  const kept = useRef({ key: flowKey(now), flow: now });
  const key = flowKey(now);
  if (kept.current.key !== key) kept.current = { key, flow: now };
  const flow = kept.current.flow;
  const [size, ref] = useSize();
  const nodeOf = (id: string) =>
    comp.groups?.some((g) => g.id === id) ? `group:${id}` : `voice:${id}`;
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:') || id?.startsWith('group:'))
      onVoice(id.slice(id.indexOf(':') + 1));
  };
  return (
    <section className={s.panel} aria-label="timing">
      <p className={s.crumbs}>what waits on what · dashed outline: waiting · heavy: playing</p>
      <div ref={ref} className={s.canvas}>
        {size && (
          <FlowDiagram
            flow={flow}
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
