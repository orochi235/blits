import type { Composition } from '@pg/blits/composition';
import { flowOf, foldOf, stampWeights } from '@pg/blits/flow';
import { type ChannelName, kitOf } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import { FlowDiagram } from '@pg/widgets/FlowDiagram';
import { Glyph } from '@pg/widgets/Glyph';
import { Button } from '@weasel-js/ui';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import s from './FlowPanel.module.css';
import { flowKey } from './flowKey';
import { useSize } from './useSize';

export interface FlowPanelProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  /** Plays the composition; its picked subject's voice weights draw the channels' stamps. */
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function FlowPanel({ comp, faulted, player, selected, onVoice }: FlowPanelProps) {
  const [fold, setFold] = useState<ChannelName | null>(null);
  const built = useMemo(() => flowOf(comp, faulted), [comp, faulted]);
  const kept = useRef({ key: flowKey(built), flow: built });
  const key = flowKey(built);
  if (kept.current.key !== key) kept.current = { key, flow: built };
  const flow = kept.current.flow;
  const shown = useMemo(
    () => (fold ? foldOf(flow, fold, kitOf(comp.rules)) : flow),
    [flow, fold, comp.rules],
  );
  const { samples } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const weights = samples.at(-1)?.weights;
  const lit = weights ? stampWeights(shown, weights) : shown;
  const litKey = lit.nodes.map((n) => n.stampWeight ?? '').join(',');
  const drawn = useRef({ shown, key: litKey, flow: lit });
  if (drawn.current.shown !== shown || drawn.current.key !== litKey)
    drawn.current = { shown, key: litKey, flow: lit };
  const [size, ref] = useSize();
  const nodeOf = (id: string) =>
    comp.groups?.some((g) => g.id === id) ? `group:${id}` : `voice:${id}`;
  const pick = (id: string | null) => {
    if (id?.startsWith('voice:')) onVoice(id.slice('voice:'.length));
    else if (id?.startsWith('group:')) onVoice(id.slice('group:'.length));
    else if (id?.startsWith('ch:') && !fold) setFold(id.slice('ch:'.length) as ChannelName);
  };
  return (
    <section className={s.panel} aria-label="flow">
      <nav className={s.crumbs}>
        {fold ? (
          <>
            <Button variant="link" size="sm" onClick={() => setFold(null)}>
              Flow
            </Button>
            <Glyph name="ui:chevron" className={s.onward} />
            <span>{fold}</span>
          </>
        ) : (
          <span>Flow</span>
        )}
      </nav>
      <div ref={ref} className={s.canvas}>
        {fold && shown.nodes.length === 0 ? (
          <p className={s.empty}>nothing writes {fold}</p>
        ) : (
          size && (
            <FlowDiagram
              flow={drawn.current.flow}
              width={size.width}
              height={size.height}
              direction={fold ? 'up' : 'down'}
              selected={selected ? nodeOf(selected) : null}
              onSelect={pick}
            />
          )
        )}
      </div>
    </section>
  );
}
