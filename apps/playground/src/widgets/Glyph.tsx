import { icon } from '@pg/icons.gen';
import type { QualifiedIconName } from '@weasel-js/icons';
import { Icon } from '@weasel-js/ui';

/** weasel's chrome glyph size, which labkit's chrome and ui's transport draw at. Inside a weasel `Button`,
 *  `--wzl-button-icon-size` sizes it instead. */
export const GLYPH_PX = 16;

/** A registry glyph at chrome size, decorative: whatever holds it names it. */
export function Glyph({ name, className }: { name: QualifiedIconName; className?: string }) {
  return <Icon name={icon(name)} size={GLYPH_PX} className={className} />;
}
