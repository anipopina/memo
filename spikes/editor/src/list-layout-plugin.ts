import type { Node } from '@tiptap/pm/model';
import { Plugin } from '@tiptap/pm/state';
import { isHistoryTransaction } from '@tiptap/pm/history';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import {
  listLayout,
  type ListAttributes,
} from '../../../packages/core/src/list-layout';

function rowsOf(doc: Node) {
  const rows: { node: Node; position: number; attrs: ListAttributes }[] = [];
  doc.forEach((node, position) =>
    rows.push({ node, position, attrs: node.attrs as ListAttributes }),
  );
  return rows;
}

function structureOf(rows: ReturnType<typeof rowsOf>): string {
  const structure: string[] = [];
  let separated = false;
  for (const { attrs } of rows) {
    if (!attrs.marker) {
      separated = true;
      continue;
    }
    if (separated && structure.length) structure.push('/');
    structure.push(
      `${attrs.indent}:${attrs.marker === '-' ? 'bullet' : 'ordered'}`,
    );
    separated = false;
  }
  return structure.join('|');
}

function decorations(doc: Node): DecorationSet {
  const rows = rowsOf(doc);
  const layout = listLayout(rows.map(({ attrs }) => attrs));
  return DecorationSet.create(
    doc,
    rows.flatMap(({ node, position }, index) => {
      const item = layout[index];
      if (!item) return [];
      return [
        Decoration.node(position, position + node.nodeSize, {
          'data-marker': item.marker,
          'data-list-depth': String(item.depth),
          style: `--marker-width: ${Math.max(1, item.marker.length)}ch; --list-marker: ${JSON.stringify(`${item.marker} `)}`,
        }),
      ];
    }),
  );
}

/** Display counters do not rewrite loaded Markdown; structural edits renumber their list. */
export function createListLayoutPlugin(): Plugin<DecorationSet> {
  const plugin: Plugin<DecorationSet> = new Plugin<DecorationSet>({
    state: {
      init: (_config, state) => decorations(state.doc),
      apply: (transaction, previous, _old, state) =>
        transaction.docChanged ? decorations(state.doc) : previous,
    },
    props: { decorations: (state) => plugin.getState(state) },
    appendTransaction: (transactions, oldState, state) => {
      // Remote synchronization is already versioned and must retain its exact Markdown.
      if (
        !transactions.some(
          (transaction) =>
            transaction.docChanged &&
            transaction.getMeta('addToHistory') !== false,
        )
      )
        return null;
      if (transactions.some(isHistoryTransaction)) return null;
      const rows = rowsOf(state.doc);
      const oldRows = rowsOf(oldState.doc);
      if (structureOf(rows) === structureOf(oldRows)) return null;
      const layout = listLayout(rows.map(({ attrs }) => attrs));
      const transaction = state.tr;
      // Include both sides when removing a marker splits one contiguous list into two.
      let index = Math.max(0, state.selection.$from.index(0) - 1);
      const last = Math.min(rows.length - 1, state.selection.$to.index(0) + 1);
      while (index <= last) {
        if (!rows[index].attrs.marker) {
          index++;
          continue;
        }
        let start = index;
        while (start > 0 && rows[start - 1].attrs.marker) start--;
        let end = index;
        while (end + 1 < rows.length && rows[end + 1].attrs.marker) end++;
        for (let row = start; row <= end; row++) {
          const { node, position, attrs } = rows[row];
          if (attrs.marker !== '-' && attrs.marker !== layout[row]!.marker) {
            transaction.setNodeMarkup(position, undefined, {
              ...node.attrs,
              marker: layout[row]!.marker,
            });
          }
        }
        index = end + 1;
      }
      return transaction.docChanged ? transaction : null;
    },
  });
  return plugin;
}
