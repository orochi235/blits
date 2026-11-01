import { defineMdastPlugin } from 'satteri';
import { hrefFor, target } from './links';

/** A link target that is an export's name, `Mix` or `Mix.seek`, rather than a path or URL. */
const NAMED = /^[A-Za-z_$][\w$]*(\.[\w$]+)?$/;

/**
 * Links each inline code span in a page's prose that names an export to that export's entry, and
 * points each link whose target is an export's name, ``[`seek`](Mix.seek)``, at that entry. A
 * named target that resolves to nothing fails the build.
 */
export function linkExports(base: string) {
  return defineMdastPlugin({
    name: 'link-exports',
    link(node, ctx) {
      if (!NAMED.test(node.url)) return;
      const hit = target(node.url);
      if (!hit) throw new Error(`a link targets \`${node.url}\`, which names no export or member`);
      ctx.setProperty(node, 'url', `${base}${hit.entry.word}/#${hit.anchor}`);
    },
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
