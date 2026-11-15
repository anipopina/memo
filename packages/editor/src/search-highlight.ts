import { Extension, type Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { noteSearchPattern } from '../../core/src/note-search';

interface SearchHighlight {
  query: string;
  decorations: DecorationSet;
}

const searchHighlightKey = new PluginKey<SearchHighlight>(
  'memoSearchHighlight',
);

function highlight(doc: Node, query: string): SearchHighlight {
  if (!query) return { query, decorations: DecorationSet.empty };
  const pattern = noteSearchPattern(query);
  const matches: Decoration[] = [];
  // Each line contains only inline text. A match can span linked and unlinked text.
  doc.forEach((line, position) => {
    for (const match of line.textContent.matchAll(pattern)) {
      const from = position + 1 + match.index;
      matches.push(
        Decoration.inline(from, from + match[0].length, {
          nodeName: 'mark',
          class: 'memo-search-match',
        }),
      );
    }
  });
  return { query, decorations: DecorationSet.create(doc, matches) };
}

function searchHighlightPlugin(currentQuery: () => string) {
  return new Plugin<SearchHighlight>({
    key: searchHighlightKey,
    state: {
      init: (_config, state) => highlight(state.doc, currentQuery()),
      apply: (transaction, previous) => {
        const query: string | undefined =
          transaction.getMeta(searchHighlightKey);
        return transaction.docChanged || query !== undefined
          ? highlight(transaction.doc, query ?? previous.query)
          : previous;
      },
    },
    props: {
      decorations: (state) => searchHighlightKey.getState(state)?.decorations,
    },
  });
}

export function searchHighlightExtension(currentQuery: () => string) {
  return Extension.create({
    name: 'memoSearchHighlight',
    addProseMirrorPlugins: () => [searchHighlightPlugin(currentQuery)],
  });
}

export function refreshSearchHighlight(editor: Editor, query: string): void {
  if (editor.isDestroyed || editor.view.composing) return;
  const current = searchHighlightKey.getState(editor.state);
  if (!current || current.query === query) return;
  editor.view.dispatch(editor.state.tr.setMeta(searchHighlightKey, query));
}
