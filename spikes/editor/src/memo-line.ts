import {
  InputRule,
  mergeAttributes,
  type Editor,
  type CommandProps,
} from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import Paragraph from '@tiptap/extension-paragraph';
import type { Node } from '@tiptap/pm/model';
import { createListLayoutPlugin } from './list-layout-plugin';
import {
  indentColumns,
  LIST_INDENT_COLUMNS,
  LIST_INPUT_PATTERN,
  nextListMarker,
  parseListLine,
} from '../../../packages/core/src/list-lines';

interface Row {
  node: Node;
  position: number;
}

/** Move a selected item and its descendants together; ordinary Tab still moves focus. */
export function shiftListIndent(
  editor: Editor,
  direction: 1 | -1,
  apply = true,
): boolean {
  if (editor.view.composing) return false;
  const { selection, doc } = editor.state;
  const rows: Row[] = [];
  doc.forEach((node, position) => rows.push({ node, position }));
  const start = selection.$from.index(0);
  let end = selection.$to.index(0);
  if (!selection.empty && selection.$to.parentOffset === 0) end--;
  const selected = rows.slice(start, end + 1);
  if (!selected.length || selected.some(({ node }) => !node.attrs.marker))
    return false;
  const firstColumns = selected.reduce(
    (minimum, { node }) => Math.min(minimum, indentColumns(node.attrs.indent)),
    Infinity,
  );
  while (
    end + 1 < rows.length &&
    rows[end + 1].node.attrs.marker &&
    indentColumns(rows[end + 1].node.attrs.indent) > firstColumns
  )
    end++;

  let targetColumns: number;
  if (direction === 1) {
    let sibling: Node | undefined;
    for (let index = start - 1; index >= 0; index--) {
      const node = rows[index].node;
      if (!node.attrs.marker) break;
      const columns = indentColumns(node.attrs.indent);
      if (columns <= firstColumns) {
        if (columns === firstColumns) sibling = node;
        break;
      }
    }
    // An orphan indented item would become a Markdown code block rather than a child list.
    if (!sibling) return apply;
    targetColumns =
      firstColumns +
      Math.max(
        LIST_INDENT_COLUMNS,
        sibling.attrs.marker.length + indentColumns(sibling.attrs.gap),
      );
  } else {
    if (!firstColumns) return apply;
    targetColumns = Math.max(0, firstColumns - LIST_INDENT_COLUMNS);
    for (let index = start - 1; index >= 0; index--) {
      const node = rows[index].node;
      if (!node.attrs.marker) break;
      const columns = indentColumns(node.attrs.indent);
      if (columns < firstColumns) {
        targetColumns = columns;
        break;
      }
    }
  }
  if (!apply) return true;
  const transaction = closeHistory(editor.state.tr);
  for (const { node, position } of rows.slice(start, end + 1)) {
    const columns = Math.max(
      0,
      indentColumns(node.attrs.indent) + targetColumns - firstColumns,
    );
    transaction.setNodeMarkup(position, undefined, {
      ...node.attrs,
      indent: ' '.repeat(columns),
    });
  }
  editor.view.dispatch(transaction);
  return true;
}

export function canShiftListIndent(editor: Editor, direction: 1 | -1): boolean {
  return shiftListIndent(editor, direction, false);
}

const paragraphAttributes = { marker: null, indent: '', gap: ' ' };

const startHistoryGroup = ({ tr }: CommandProps): boolean => {
  closeHistory(tr);
  return true;
};

function continueLine(editor: Editor): boolean {
  if (editor.view.composing) return false;
  const { $from, empty } = editor.state.selection;
  const { marker, indent, gap, eol } = $from.parent.attrs;
  if (marker && empty && !$from.parent.textContent) {
    if (indentColumns(indent)) return shiftListIndent(editor, -1);
    return editor
      .chain()
      .command(startHistoryGroup)
      .updateAttributes('paragraph', paragraphAttributes)
      .run();
  }
  return editor
    .chain()
    .command(startHistoryGroup)
    .splitBlock()
    .updateAttributes('paragraph', {
      marker: marker ? nextListMarker(marker) : null,
      indent,
      gap,
      eol,
    })
    .run();
}

export const MemoLine = Paragraph.extend({
  priority: 1000,
  addAttributes() {
    return {
      marker: {
        default: null,
        parseHTML: (element) => {
          const marker = element.getAttribute('data-memo-marker');
          return marker && parseListLine(`${marker} `)?.marker === marker
            ? marker
            : null;
        },
        renderHTML: ({ marker }) =>
          marker ? { 'data-memo-marker': marker } : {},
      },
      indent: {
        default: '',
        parseHTML: (element) => {
          const indent = element.getAttribute('data-memo-indent') ?? '';
          return /^[ \t]*$/.test(indent) ? indent : '';
        },
        renderHTML: ({ indent }) => ({ 'data-memo-indent': indent }),
      },
      gap: {
        default: ' ',
        parseHTML: (element) => {
          const gap = element.getAttribute('data-memo-gap') ?? ' ';
          return /^[ \t]+$/.test(gap) ? gap : ' ';
        },
        renderHTML: ({ gap }) => ({ 'data-memo-gap': gap }),
      },
      eol: {
        default: '\n',
        parseHTML: (element) =>
          element.getAttribute('data-memo-eol') === 'crlf' ? '\r\n' : '\n',
        renderHTML: ({ eol }) => ({
          'data-memo-eol': eol === '\r\n' ? 'crlf' : 'lf',
        }),
      },
    };
  },
  // Native IMEs may recreate DOM nodes, losing ProseMirror's node descriptors.
  // Parsing must recover both the block boundary and its original Markdown attributes.
  parseHTML() {
    return [{ tag: 'p', preserveWhitespace: 'full' as const }];
  },
  renderHTML({ node, HTMLAttributes }) {
    const { marker, indent } = node.attrs;
    const list = marker
      ? {
          class: `memo-line list-line ${marker === '-' ? 'bullet' : 'ordered'}`,
          'data-marker': marker === '-' ? '•' : marker,
          style: `--list-indent: ${indentColumns(indent)}ch; --marker-width: ${Math.max(1, marker.length)}ch`,
        }
      : { class: 'memo-line' };
    return ['p', mergeAttributes(HTMLAttributes, list), 0];
  },
  addProseMirrorPlugins() {
    return [createListLayoutPlugin()];
  },
  addInputRules() {
    return [
      new InputRule({
        find: LIST_INPUT_PATTERN,
        handler: ({ state, range, match }) => {
          const attrs = state.selection.$from.parent.attrs;
          if (attrs.marker) return null;
          const list = parseListLine(match[0])!;
          state.tr
            .delete(range.from, range.to)
            .setBlockType(range.from, range.from, this.type, {
              ...attrs,
              marker: list.marker,
              indent: list.indent,
              gap: list.gap,
            });
        },
      }),
    ];
  },
  addKeyboardShortcuts() {
    return {
      Tab: () => shiftListIndent(this.editor, 1),
      'Shift-Tab': () => shiftListIndent(this.editor, -1),
      Enter: () => continueLine(this.editor),
      'Shift-Enter': () => continueLine(this.editor),
      Backspace: () => {
        const { $from, empty } = this.editor.state.selection;
        if (
          this.editor.view.composing ||
          !empty ||
          $from.parentOffset ||
          !$from.parent.attrs.marker
        )
          return false;
        if (indentColumns($from.parent.attrs.indent))
          return shiftListIndent(this.editor, -1);
        return this.editor
          .chain()
          .command(startHistoryGroup)
          .updateAttributes('paragraph', paragraphAttributes)
          .run();
      },
    };
  },
});
