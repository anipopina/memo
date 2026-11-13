import { describe, expect, it } from 'vitest';
import { getSchema } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Link from '@tiptap/extension-link';
import { AllSelection, EditorState, TextSelection } from '@tiptap/pm/state';
import { MemoLine } from '../packages/editor/src/memo-line';
import {
  parseMarkdown,
  serializeMarkdown,
} from '../packages/core/src/markdown';
import {
  pasteClipboard,
  serializeClipboard,
} from '../packages/editor/src/clipboard';
const schema = getSchema([Document, MemoLine, Text, Link]);
function select(source: string, from: number, to = from) {
  const doc = schema.nodeFromJSON(parseMarkdown(source));
  return EditorState.create({
    schema,
    doc,
    selection: TextSelection.create(doc, from, to),
  });
}
describe('plain text clipboard', () => {
  it('replaces a document-wide selection', () => {
    const original = select('- old\ntext', 1);
    const state = original.apply(
      original.tr.setSelection(new AllSelection(original.doc)),
    );
    expect(
      serializeMarkdown(pasteClipboard('new\n\ntext', state).doc.toJSON()),
    ).toBe('new\n\ntext');
  });
  it.each([
    ['abc', 2, 2, 'X', 'aXbc'],
    ['abc', 1, 1, 'X', 'Xabc'],
    ['abc', 4, 4, 'X', 'abcX'],
    ['abcd', 2, 4, 'X\nY', 'aX\nYd'],
    ['abc', 2, 2, 'X\n\nY\n', 'aX\n\nY\nbc'],
    ['ab\ncd', 2, 6, 'X\nY', 'aX\nYd'],
    ['', 1, 1, '- a\n- b', '- a\n- b'],
    ['abc', 2, 2, '- a\n- b', 'a- a\n- bbc'],
    ['- abc', 2, 2, 'X', '- aXbc'],
    ['- ', 1, 1, 'X', '- X'],
    ['abc', 2, 2, 'X\r\nY', 'aX\r\nYbc'],
  ])('pastes %j at %i..%i', (source, from, to, text, expected) => {
    const state = select(source, from, to);
    const tr = pasteClipboard(text, state);
    expect(serializeMarkdown(tr.doc.toJSON())).toBe(expected);
  });
  it.each(['a\nb', 'a\n\nb\n', '\n\n', 'a\r\nb\nc', '- a\n    - b\n2. c'])(
    'copies exact line boundaries and markers: %j',
    (source) => {
      const state = select(
        source,
        1,
        schema.nodeFromJSON(parseMarkdown(source)).content.size - 1,
      );
      expect(serializeClipboard(state.selection.content(), state)).toBe(source);
    },
  );
  it('copies partial text without adding an unselected marker', () => {
    const state = select('- abc\n- def', 2, 8);
    expect(serializeClipboard(state.selection.content(), state)).toBe(
      'bc\n- de',
    );
    expect(serializeMarkdown(state.doc.toJSON())).toBe('- abc\n- def');
  });
});
