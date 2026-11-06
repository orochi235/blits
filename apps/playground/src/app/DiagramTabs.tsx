import type { Composition } from '@pg/blits/composition';
import type { Player } from '@pg/blits/player';
import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui';
import { useState } from 'react';
import { BothPanel } from './BothPanel';
import { DeskPanel } from './DeskPanel';
import s from './DiagramTabs.module.css';
import { FlowPanel } from './FlowPanel';
import { TimingPanel } from './TimingPanel';

type DiagramTab = 'flow' | 'timing' | 'both' | 'desk';

export interface DiagramTabsProps {
  comp: Composition;
  /** Ids of voices and groups that failed to compile. */
  faulted: ReadonlySet<string>;
  player: Player;
  /** The selected voice's or group's id. */
  selected: string | null;
  onVoice: (id: string) => void;
  onComp: (c: Composition) => void;
}

/** The composition drawn four ways, beside the stage: Flow, Timing, Both, and Desk. */
export function DiagramTabs({
  comp,
  faulted,
  player,
  selected,
  onVoice,
  onComp,
}: DiagramTabsProps) {
  const [tab, setTab] = useState<DiagramTab>('flow');
  const shared = { comp, faulted, selected, onVoice };
  return (
    <section className={s.diagrams} aria-label="diagrams">
      <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(k) => setTab(k as DiagramTab)}>
        <TabList aria-label="diagrams">
          <Tab id="flow">Flow</Tab>
          <Tab id="timing">Timing</Tab>
          <Tab id="both">Both</Tab>
          <Tab id="desk">Desk</Tab>
        </TabList>
        <TabPanel id="flow" className={s.panel}>
          <FlowPanel {...shared} player={player} />
        </TabPanel>
        <TabPanel id="timing" className={s.panel}>
          <TimingPanel {...shared} player={player} />
        </TabPanel>
        <TabPanel id="both" className={s.panel}>
          <BothPanel {...shared} player={player} onComp={onComp} />
        </TabPanel>
        <TabPanel id="desk" className={s.panel}>
          <DeskPanel {...shared} player={player} />
        </TabPanel>
      </Tabs>
    </section>
  );
}
