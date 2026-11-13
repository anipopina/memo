import type { Editor as CoreEditor } from '@tiptap/core';
import { Editor } from '@tiptap/vue-3';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Link from '@tiptap/extension-link';
import { UndoRedo } from '@tiptap/extensions';
import { EditorState } from '@tiptap/pm/state';
import { parseMarkdown } from '../../core/src/markdown';
import { MemoLine } from './memo-line';

export function createMemoEditor(options: {
  content: string;
  onChange: (editor: CoreEditor) => void;
  onLink: (href: string, event: MouseEvent) => void;
  onComposition: (composing: boolean) => void;
}): Editor {
  const editor: Editor = new Editor({
    extensions: [
      Document,
      MemoLine,
      Text,
      UndoRedo,
      Link.configure({
        openOnClick: false,
        autolink: true,
        linkOnPaste: false,
        isAllowedUri: (url) => /^https?:\/\//i.test(url),
        shouldAutoLink: (url) => /^https?:\/\//i.test(url),
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    content: parseMarkdown(options.content),
    onUpdate: ({ editor }) => options.onChange(editor),
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-label': 'メモ本文',
        'aria-multiline': 'true',
        spellcheck: 'false',
      },
      handlePaste: (_view, event) => {
        const text = event.clipboardData?.getData('text/plain');
        if (text === undefined) return false;
        event.preventDefault();
        return editor.commands.insertContent(parseMarkdown(text).content ?? []);
      },
      handleClick: (_view, _position, event) => {
        const anchor = (event.target as HTMLElement).closest('a');
        const href = anchor?.getAttribute('href');
        if (!href || !/^https?:\/\//i.test(href)) return false;
        event.preventDefault();
        if (event.ctrlKey || event.metaKey)
          window.open(href, '_blank', 'noopener,noreferrer');
        else options.onLink(href, event);
        return true;
      },
      handleDOMEvents: {
        compositionstart: () => {
          options.onComposition(true);
          return false;
        },
        compositionend: () => {
          options.onComposition(false);
          return false;
        },
      },
    },
  });
  return editor;
}

/** Preserve selection via a mapped transaction instead of resetting editor content. */
export function applyRemoteMarkdown(editor: Editor, source: string): boolean {
  if (editor.view.composing) return false;
  const next = editor.schema.nodeFromJSON(parseMarkdown(source));
  const current = editor.state.doc;
  const start = current.content.findDiffStart(next.content);
  if (start === null) return true;
  const end = current.content.findDiffEnd(next.content)!;
  const overlap = start - Math.min(end.a, end.b);
  const endA = overlap > 0 ? end.a + overlap : end.a;
  const endB = overlap > 0 ? end.b + overlap : end.b;
  const transaction = editor.state.tr.replace(
    start,
    endA,
    next.slice(start, endB),
  );
  transaction.setMeta('addToHistory', false);
  editor.view.dispatch(transaction);
  return true;
}

/** Loading a different document must not retain the previous document in Undo. */
export function loadMarkdown(editor: Editor, source: string): void {
  editor.view.updateState(
    EditorState.create({
      schema: editor.schema,
      doc: editor.schema.nodeFromJSON(parseMarkdown(source)),
      plugins: editor.state.plugins,
    }),
  );
}
