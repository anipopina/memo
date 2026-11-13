import { Slice } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';
import { parseMarkdown, serializeMarkdown } from '../../core/src/markdown';

/** Open paragraph edges join pasted text to the text around the selection. */
function clipboardSlice(text: string, state: EditorState): Slice {
  const parsed = parseMarkdown(text);
  const first = parsed.content![0];
  const startsLine = state.selection.$from.parentOffset === 0;
  if (!startsLine && first.attrs?.marker) {
    // A list marker pasted inside a sentence is literal text, not a new item.
    const prefix = `${first.attrs.indent}${first.attrs.marker}${first.attrs.gap}`;
    first.content = [{ type: 'text', text: prefix }, ...(first.content ?? [])];
    first.attrs = { ...first.attrs, marker: null, indent: '', gap: ' ' };
  }
  const doc = state.schema.nodeFromJSON(parsed);
  // Keep a pasted list's first marker when it starts at a line boundary.
  return new Slice(doc.content, startsLine && first.attrs?.marker ? 0 : 1, 1);
}

export function pasteClipboard(text: string, state: EditorState) {
  const slice = clipboardSlice(text, state);
  const tr = state.tr.replaceSelection(slice);
  // Joining paragraphs keeps the target attributes. New boundaries use the pasted
  // newline, while the boundary after the insertion keeps the original newline.
  if (slice.content.childCount > 1) {
    const position = state.selection.$from.depth
      ? state.selection.$from.before()
      : 0;
    const first = tr.doc.nodeAt(position)!;
    tr.setNodeMarkup(position, undefined, {
      ...first.attrs,
      eol: slice.content.firstChild!.attrs.eol,
    });
  }
  const end = tr.selection.$to;
  const endLine = state.selection.$to.parent.isTextblock
    ? state.selection.$to.parent
    : state.doc.lastChild!;
  if (end.parent.attrs.eol !== endLine.attrs.eol)
    tr.setNodeMarkup(end.before(), undefined, {
      ...end.parent.attrs,
      eol: endLine.attrs.eol,
    });
  return tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView();
}

export function serializeClipboard(slice: Slice, state: EditorState): string {
  const content = slice.content.toJSON() ?? [];
  if (
    slice.openStart &&
    state.selection.$from.parentOffset > 0 &&
    content[0]?.attrs
  ) {
    // A selection starting inside a list item does not include its marker.
    content[0] = {
      ...content[0],
      attrs: { ...content[0].attrs, marker: null },
    };
  }
  return serializeMarkdown({ type: 'doc', content });
}
