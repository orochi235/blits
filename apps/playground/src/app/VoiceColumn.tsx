import type { SpanHandle } from '@msb235/blits';
import type { Composition, Group, Voice } from '@pg/blits/composition';
import { MAX_GROUPS, MAX_VOICES } from '@pg/blits/composition';
import { groupsFull } from '@pg/blits/edit';
import { joinGroup } from '@pg/blits/groupEdits';
import { underSpan } from '@pg/blits/groups';
import { kitOf } from '@pg/blits/kit';
import type { Player } from '@pg/blits/player';
import type { Subject } from '@pg/blits/stage';
import type { RefObject } from 'react';
import s from './App.module.css';
import { LevelsPanel } from './CompositionControls';
import { GroupPanel } from './GroupPanel';
import { LivePanel } from './LivePanel';
import { MixPanel } from './MixPanel';
import { PatchPanel } from './PatchPanel';
import { RulesPanel } from './RulesPanel';
import { VoicePanel } from './VoicePanel';

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
  return (
    <div className={s.voiceColumn}>
      <div className={s.row}>
        <button
          type="button"
          onClick={p.onAddVoice}
          disabled={p.comp.voices.length >= MAX_VOICES}
          title={p.comp.voices.length >= MAX_VOICES ? `at most ${MAX_VOICES} voices` : undefined}
        >
          add voice
        </button>
        <select
          aria-label="add group"
          value=""
          disabled={groupsFull(p.comp)}
          title={groupsFull(p.comp) ? `at most ${MAX_GROUPS} groups` : undefined}
          onChange={(e) => p.onAddGroup(e.target.value as Group['kind'])}
        >
          <option value="" disabled>
            add group
          </option>
          <option value="owner">owner</option>
          <option value="span">span</option>
        </select>
        <button type="button" onClick={p.onShare}>
          share
        </button>
        {p.shared?.copied && <span role="status">link copied</span>}
      </div>
      {p.shared && !p.shared.copied && (
        <div className={s.row} role="status">
          <label className={s.row}>
            copy this link
            <input
              readOnly
              value={p.shared.url}
              ref={p.linkRef}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button type="button" onClick={p.onCloseShare}>
            close
          </button>
        </div>
      )}
      <LevelsPanel comp={p.comp} onChange={p.onComp} />
      <MixPanel comp={p.comp} onChange={p.onComp} />
      <RulesPanel comp={p.comp} onChange={p.onComp} />
      {voice && (
        <VoicePanel
          key={voice.id}
          voice={voice}
          comp={p.comp}
          spanned={underSpan(p.comp, voice.id)}
          onJoin={(to) => p.onComp(joinGroup(p.comp, voice.id, to))}
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
    </div>
  );
}
