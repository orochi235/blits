import type { Composition } from '@pg/blits/composition';
import { deskOf, litDesk } from '@pg/blits/desk';
import { flowOf } from '@pg/blits/flow';
import type { Player } from '@pg/blits/player';
import { MixerDesk } from '@pg/widgets/MixerDesk';
import { useMemo, useSyncExternalStore } from 'react';
import s from './FlowPanel.module.css';
import { useSize } from './useSize';

export interface DeskPanelProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
}

export function DeskPanel({ comp, faulted, player, selected, onVoice }: DeskPanelProps) {
  const desk = useMemo(() => deskOf(comp, flowOf(comp, faulted)), [comp, faulted]);
  const { picked, samples } = useSyncExternalStore(player.subscribe, player.getSnapshot);
  const [size, ref] = useSize();
  return (
    <section className={s.panel} aria-label="desk">
      <p className={s.crumbs}>
        {picked === null
          ? 'click a subject on the stage to light the desk'
          : `subject ${picked} · taps and meters: weightOf · each bus: its folded value`}
      </p>
      <div ref={ref} className={s.scroll}>
        {size && (
          <MixerDesk
            desk={litDesk(desk, samples.at(-1))}
            width={size.width}
            selected={selected}
            onSelect={(id) => id !== null && onVoice(id)}
          />
        )}
      </div>
    </section>
  );
}
