import { defineMdastPlugin } from 'satteri';
import { hrefFor } from './links';

/** Links each inline code span in a page's prose that names an export to that export's entry. */
export function linkExports(base: string) {
  return defineMdastPlugin({
    name: 'link-exports',
    inlineCode(node, ctx) {
      let up: ReturnType<typeof ctx.parent> | undefined = ctx.parent(node);
      while (up && up.type !== 'root') {
        if (up.type === 'link' || up.type === 'heading') return;
        up = ctx.parent(up);
      }
      const url = hrefFor(node.value, '', base);
      if (url) ctx.wrapNode(node, { type: 'link', url, children: [] });
    },
  });
}
