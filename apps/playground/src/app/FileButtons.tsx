import type { Composition } from '@pg/blits/composition';
import { fileName, fromFile, toFile } from '@pg/blits/file';
import { Button } from '@weasel-js/ui';
import { useRef, useState } from 'react';

/**
 * `blob` downloaded as `name`. The URL is revoked a task later: revoked in the click's own task,
 * some browsers save an empty file or none.
 */
export function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Save the composition as a JSON file, or open one, which loads as an edit and can be undone. */
export function FileButtons({ comp, onOpen }: { comp: Composition; onOpen(c: Composition): void }) {
  const input = useRef<HTMLInputElement>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const save = () =>
    download(new Blob([toFile(comp)], { type: 'application/json' }), fileName(comp));
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
