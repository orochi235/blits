import type { StageSpec } from './composition';

export interface Subject {
  index: number;
  row: number;
  col: number;
  x: number;
  y: number;
  char: string;
}

const unit = (i: number, n: number) => (n > 1 ? i / (n - 1) : 0);

export function subjectsOf(stage: StageSpec): Subject[] {
  if (stage.kind === 'letters') {
    const chars = [...stage.text];
    return chars.map((char, i) => ({
      index: i,
      row: 0,
      col: i,
      x: unit(i, chars.length),
      y: 0,
      char,
    }));
  }
  const out: Subject[] = [];
  for (let row = 0; row < stage.rows; row++)
    for (let col = 0; col < stage.cols; col++)
      out.push({
        index: out.length,
        row,
        col,
        x: unit(col, stage.cols),
        y: unit(row, stage.rows),
        char: '',
      });
  return out;
}
