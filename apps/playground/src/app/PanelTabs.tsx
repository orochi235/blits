import { Tab, TabList, TabPanel, Tabs } from '@weasel-js/ui';
import type { ReactNode } from 'react';
import s from './PanelTabs.module.css';

export type PanelTab = 'plots' | 'voice' | 'events';

export interface PanelTabsProps {
  tab: PanelTab;
  onTab: (t: PanelTab) => void;
  plots: ReactNode;
  voice: ReactNode;
  events: ReactNode;
}

/** The right column: the inspector's plots, the selection's panels, and the score's events. */
export function PanelTabs({ tab, onTab, plots, voice, events }: PanelTabsProps) {
  return (
    <Tabs className={s.tabs} selectedKey={tab} onSelectionChange={(k) => onTab(k as PanelTab)}>
      <TabList aria-label="panels">
        <Tab id="plots">Plots</Tab>
        <Tab id="voice">Voice</Tab>
        <Tab id="events">Events</Tab>
      </TabList>
      <TabPanel id="plots" className={s.panel}>
        {plots}
      </TabPanel>
      <TabPanel id="voice" className={s.panel}>
        {voice}
      </TabPanel>
      <TabPanel id="events" className={s.panel}>
        {events}
      </TabPanel>
    </Tabs>
  );
}
