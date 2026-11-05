import type { SpanHandle } from '@msb235/blits';
import { setBlend, syncBlend } from '@pg/blits/blend';
import type { Composition, Group, Voice } from '@pg/blits/composition';
import { MAX_GROUPS, MAX_VOICES } from '@pg/blits/composition';
import { groupsFull } from '@pg/blits/edit';
import { joinGroup } from '@pg/blits/groupEdits';
import { underSpan } from '@pg/blits/groups';
import { kitOf } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import type { Subject } from '@pg/blits/stage';
import { Button, Input, MenuButton, type MenuButtonItem } from '@weasel-js/ui';
import type { RefObject } from 'react';
import s from './App.module.css';
import { LevelsPanel } from './CompositionControls';
import { FileButtons } from './FileButtons';
import { GroupPanel } from './GroupPanel';
import { LivePanel } from './LivePanel';
import { MixPanel } from './MixPanel';
import { PatchPanel } from './PatchPanel';
import { RulesPanel } from './RulesPanel';
import { VoicePanel } from './VoicePanel';

const GROUP_KINDS: MenuButtonItem<Group['kind']>[] = [
  { value: 'owner', label: 'owner' },
  { value: 'span', label: 'span' },
];

export interface VoiceColumnProps {
  comp: Composition;
  onComp: (c: Composition) => void;
  voice: Voice | undefined;
  /** The selected group, shown in place of a voice. */
  group: Group | undefined;
  player: Player;
  /** The subject picked on the stage, if any. */
  subject: Subject | undefined;
  live: boolean;
  shared: { copied: boolean; url: string } | null;
  linkRef: RefObject<HTMLInputElement | null>;
  onAddVoice: () => void;
  onAddGroup: (kind: Group['kind']) => void;
  onDeleteVoice: (id: string) => void;
  onVoice: (v: Voice) => void;
  onGroup: (g: Group) => void;
  onDeleteGroup: (id: string) => void;
  onShare: () => void;
  onCloseShare: () => void;
  onActed: () => void;
}

export function VoiceColumn(p: VoiceColumnProps) {
  const { voice, group } = p;
  const selected = voice ?? group;
  const voicesFull = p.comp.voices.length >= MAX_VOICES;
  return (
    <div className={s.voiceColumn}>
      <div className={s.row}>
        <Button
          onClick={p.onAddVoice}
          disabled={voicesFull}
          tooltip={voicesFull ? `at most ${MAX_VOICES} voices` : undefined}
        >
          add voice
        </Button>
        <MenuButton
          label="add group"
          items={GROUP_KINDS}
          isDisabled={groupsFull(p.comp)}
          tooltip={groupsFull(p.comp) ? `at most ${MAX_GROUPS} groups` : undefined}
          onAction={p.onAddGroup}
        />
        <Button onClick={p.onShare}>share</Button>
        <FileButtons comp={p.comp} onOpen={p.onComp} />
        {p.shared?.copied && <span role="status">link copied</span>}
      </div>
      {p.shared && !p.shared.copied && (
        <div className={s.row} role="status">
          <Input
            label="copy this link"
            isReadOnly
            value={p.shared.url}
            ref={p.linkRef}
            onFocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <Button onClick={p.onCloseShare}>close</Button>
        </div>
      )}
      {voice && (
        <VoicePanel
          key={voice.id}
          voice={voice}
          comp={p.comp}
          spanned={underSpan(p.comp, voice.id)}
          onJoin={(to) => p.onComp(syncBlend(joinGroup(p.comp, voice.id, to), voice.id))}
          onBlend={(by) => voice.role !== undefined && p.onComp(setBlend(p.comp, voice.role, by))}
          errors={p.player.built.errors}
          faults={p.player.built.faults.get(voice.id)}
          onChange={p.onVoice}
          onDelete={() => p.onDeleteVoice(voice.id)}
        />
      )}
      {group && (
        <GroupPanel
          key={group.id}
          group={group}
          comp={p.comp}
          spanned={underSpan(p.comp, group.id)}
          errors={p.player.built.errors}
          faultsOf={(key) => p.player.built.faults.get(key)}
          result={
            (p.player.built.groupHandles.get(group.id) as SpanHandle<Subject> | undefined)?.result
          }
          onChange={p.onGroup}
          onJoin={(to) => p.onComp(joinGroup(p.comp, group.id, to))}
          onDelete={() => p.onDeleteGroup(group.id)}
        />
      )}
      {selected && p.live && (
        <LivePanel
          key={`${selected.id} live`}
          player={p.player}
          comp={p.comp}
          id={selected.id}
          subject={p.subject}
          onActed={p.onActed}
        />
      )}
      {voice && (
        <PatchPanel
          key={`${voice.id} patch`}
          voice={voice}
          kit={kitOf(p.comp.rules)}
          errors={p.player.built.errors}
          playhead={p.player.t}
          onChange={p.onVoice}
        />
      )}
      {/* What the whole composition shares, below what is selected, which is what a click here edits. */}
      <LevelsPanel comp={p.comp} onChange={p.onComp} />
      <MixPanel comp={p.comp} onChange={p.onComp} />
      <RulesPanel comp={p.comp} onChange={p.onComp} />
    </div>
  );
}
