import { type Composition, type Level, MAX_LEVELS, MAX_TEXT } from '@pg/blits/composition';
import {
  addLevel,
  lettersOf,
  removeLevel,
  renameLevel,
  sizeDots,
  switchStage,
  tuneLevel,
  withLength,
} from '@pg/blits/edit';
import { Radio, RadioGroup } from '@weasel-js/ui';
import { type KeyboardEvent, useId, useState } from 'react';
import s from './App.module.css';

interface DraftProps {
  label: string;
  value: string | number;
  onCommit(next: string): void;
  type?: 'text' | 'number';
  className?: string;
  maxLength?: number;
  /** Visible text around the input; `label` alone names it for assistive tech. */
  caption?: string;
  unit?: string;
}

/** An input that commits on Enter or blur, so typing makes one undo step, not one per key. */
function Draft(p: DraftProps) {
  const { label, value, onCommit, type = 'text', className, maxLength, caption, unit } = p;
  // null while not editing, so a refused edit shows the value it left in place.
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft !== null && draft !== String(value)) onCommit(draft);
    setDraft(null);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commit();
    if (e.key === 'Escape') setDraft(null);
  };
  const input = (
    <input
      id={id}
      aria-label={label}
      type={type}
      className={type === 'number' ? (className ?? s.number) : className}
      value={draft ?? String(value)}
      maxLength={maxLength}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={key}
    />
  );
  if (caption === undefined) return input;
  return (
    <span className={s.row}>
      <label htmlFor={id}>{caption}</label>
      {input}
      {unit}
    </span>
  );
}

/** A number field's text as a number; blank is not 0. */
const numberOf = (text: string) => (text.trim() === '' ? Number.NaN : Number(text));

export interface CompProps {
  comp: Composition;
  onChange(next: Composition): void;
}

export function StageControls({ comp, onChange }: CompProps) {
  const { stage } = comp;
  const set = (next: Composition['stage']) => onChange({ ...comp, stage: next });
  return (
    <div className={s.row}>
      <RadioGroup
        aria-label="stage kind"
        orientation="horizontal"
        value={stage.kind}
        onChange={(k) => set(switchStage(stage, k as Composition['stage']['kind']))}
      >
        <Radio value="dots">dots</Radio>
        <Radio value="letters">letters</Radio>
      </RadioGroup>
      {stage.kind === 'dots' ? (
        <>
          <Draft
            caption="cols"
            label="columns"
            type="number"
            value={stage.cols}
            onCommit={(t) => set(sizeDots(stage, numberOf(t), stage.rows))}
          />
          <Draft
            caption="rows"
            label="rows"
            type="number"
            value={stage.rows}
            onCommit={(t) => set(sizeDots(stage, stage.cols, numberOf(t)))}
          />
        </>
      ) : (
        <Draft
          label="stage text"
          className={s.text}
          value={stage.text}
          maxLength={MAX_TEXT}
          onCommit={(t) => set(lettersOf(t))}
        />
      )}
    </div>
  );
}

/** Title and length, for the header. */
export function CompFields({ comp, onChange }: CompProps) {
  return (
    <>
      <Draft
        caption="title"
        label="title"
        value={comp.title}
        onCommit={(title) => onChange({ ...comp, title })}
      />
      <Draft
        caption="length"
        label="length in ms"
        type="number"
        value={comp.length}
        onCommit={(t) => onChange(withLength(comp, numberOf(t)))}
        unit="ms"
      />
    </>
  );
}

export function LevelsPanel({ comp, onChange }: CompProps) {
  const set = (levels: Level[]) => onChange({ ...comp, levels });
  const full = comp.levels.length >= MAX_LEVELS;
  return (
    <section className={s.panel} aria-label="levels">
      <div className={s.row}>
        <h2 className={s.heading}>levels</h2>
        <button
          type="button"
          onClick={() => set(addLevel(comp.levels))}
          disabled={full}
          title={full ? `at most ${MAX_LEVELS} levels` : undefined}
        >
          add level
        </button>
      </div>
      {comp.levels.length > 0 && (
        <div className={s.levels}>
          <span>name</span>
          <span>min</span>
          <span>value</span>
          <span>max</span>
          <span />
          {comp.levels.map((l, i) => (
            <LevelRow
              // Index keys: a rename must not remount the row mid-edit.
              // biome-ignore lint/suspicious/noArrayIndexKey: levels have no id but their name
              key={i}
              level={l}
              onRename={(name) => set(renameLevel(comp.levels, i, name))}
              onTune={(change) => set(tuneLevel(comp.levels, i, change))}
              onRemove={() => set(removeLevel(comp.levels, i))}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface LevelRowProps {
  level: Level;
  onRename(name: string): void;
  onTune(change: Partial<Pick<Level, 'min' | 'max' | 'value'>>): void;
  onRemove(): void;
}

function LevelRow({ level: l, onRename, onTune, onRemove }: LevelRowProps) {
  return (
    <>
      <Draft label={`level ${l.name} name`} value={l.name} onCommit={onRename} />
      <Draft
        label={`level ${l.name} min`}
        type="number"
        value={l.min}
        onCommit={(t) => onTune({ min: numberOf(t) })}
      />
      <Draft
        label={`level ${l.name} value`}
        type="number"
        value={l.value}
        onCommit={(t) => onTune({ value: numberOf(t) })}
      />
      <Draft
        label={`level ${l.name} max`}
        type="number"
        value={l.max}
        onCommit={(t) => onTune({ max: numberOf(t) })}
      />
      <button type="button" aria-label={`remove level ${l.name}`} onClick={onRemove}>
        ×
      </button>
    </>
  );
}
