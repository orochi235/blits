import { scopedIcon } from '@weasel-js/icons';

/** The playground draws no glyphs of its own, so every name it writes is qualified: `icon('ui:close')`. */
export const icon = scopedIcon<never>('playground');
