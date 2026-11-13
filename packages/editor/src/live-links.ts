import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Mark, Node } from '@tiptap/pm/model';
import { find } from 'linkifyjs';

const refreshKey = new PluginKey('memoLiveLinks');
interface Range {
  from: number;
  to: number;
  href: string;
}
function currentLinks(node: Node, linkType: Mark['type']): Range[] {
  const ranges: Range[] = [];
  node.forEach((child, offset) => {
    const mark = linkType.isInSet(child.marks);
    if (!mark) return;
    const previous = ranges.at(-1);
    if (previous && previous.to === offset && previous.href === mark.attrs.href)
      previous.to = offset + child.nodeSize;
    else
      ranges.push({
        from: offset,
        to: offset + child.nodeSize,
        href: mark.attrs.href,
      });
  });
  return ranges;
}
/** Link marks are derived from visible text, including edits in the middle of an existing URL. */
export function liveLinksPlugin(): Plugin {
  let view: EditorView | undefined;
  let frame: number | undefined;
  return new Plugin({
    key: refreshKey,
    appendTransaction(transactions, _old, state) {
      if (
        view?.composing ||
        !transactions.some(
          (transaction) =>
            transaction.docChanged || transaction.getMeta(refreshKey),
        )
      )
        return null;
      const link = state.schema.marks.link;
      const transaction = state.tr;
      state.doc.descendants((node, position) => {
        if (!node.isTextblock) return;
        const expected = find(node.textContent, 'url')
          .filter((match) => /^https?:\/\//i.test(match.value))
          .map((match) => ({
            from: match.start,
            to: match.end,
            href: match.value,
          }));
        const current = currentLinks(node, link);
        if (JSON.stringify(current) === JSON.stringify(expected)) return false;
        transaction.removeMark(
          position + 1,
          position + 1 + node.content.size,
          link,
        );
        for (const range of expected)
          transaction.addMark(
            position + 1 + range.from,
            position + 1 + range.to,
            link.create({ href: range.href }),
          );
        return false;
      });
      return transaction.docChanged
        ? transaction.setMeta('addToHistory', false)
        : null;
    },
    view(editorView) {
      view = editorView;
      // Defer only native composition: changing its DOM marks mid-conversion can disrupt IMEs.
      const compositionEnd = () => {
        if (frame !== undefined) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          frame = undefined;
          if (view && !view.isDestroyed)
            view.dispatch(view.state.tr.setMeta(refreshKey, true));
        });
      };
      editorView.dom.addEventListener('compositionend', compositionEnd);
      return {
        destroy() {
          editorView.dom.removeEventListener('compositionend', compositionEnd);
          if (frame !== undefined) cancelAnimationFrame(frame);
          view = undefined;
        },
      };
    },
  });
}
