import type { Composition } from '@pg/blits/composition';
import { fileName, fromFile, toFile } from '@pg/blits/file';
import { Button } from '@weasel-js/ui';
import { useRef, useState } from 'react';

/** Save the composition as a JSON file, or open one, which loads as an edit and can be undone. */
export function FileButtons({ comp, onOpen }: { comp: Composition; onOpen(c: Composition): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const save = () => {
    const url = URL.createObjectURL(new Blob([toFile(comp)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName(comp);
    a.click();
    URL.revokeObjectURL(url);
  };
  const open = async (file: File | undefined) => {
    if (!file) return;
    const c = fromFile(await file.text());
    setRefused(c ? null : file.name);
    if (c) onOpen(c);
  };
  return (
    <>
      <Button onClick={save}>save</Button>
      <Button onClick={() => input.current?.click()}>open</Button>
      {/* weasel has no file picker; a hidden input is the browser's only way to one. */}
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="open a composition file"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
      {refused && <span role="status">{refused} holds no composition the playground can load</span>}
    </>
  );
}
