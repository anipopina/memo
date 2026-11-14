import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import {
  MAX_NOTE_BYTES,
  assertNoteSize,
} from '../../../packages/core/src/note';

export function useFileDrop(options: {
  allowed: () => boolean;
  importText: (text: string) => Promise<void>;
  report: (message: string) => void;
}) {
  const dragging = shallowRef(false);
  let depth = 0;
  let importing = false;
  let disposed = false;
  const reset = () => {
    depth = 0;
    dragging.value = false;
  };
  const isFile = (event: DragEvent) =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files');
  function enter(event: DragEvent) {
    if (!isFile(event)) return;
    event.preventDefault();
    depth++;
    dragging.value = !importing && options.allowed();
  }
  function over(event: DragEvent) {
    if (!isFile(event)) return;
    event.preventDefault();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect =
        !importing && options.allowed() ? 'copy' : 'none';
  }
  function leave(event: DragEvent) {
    if (!isFile(event)) return;
    if (--depth <= 0) reset();
  }
  async function drop(event: DragEvent) {
    if (!isFile(event)) return;
    // Consume file drops before ProseMirror can insert into the current note.
    event.preventDefault();
    event.stopPropagation();
    reset();
    if (importing || !options.allowed()) return;
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length !== 1) {
      options.report('ファイルは1つずつドロップしてください。');
      return;
    }
    const file = files[0]!;
    if (!/\.(txt|md)$/i.test(file.name)) {
      options.report('.txt または .md ファイルをドロップしてください。');
      return;
    }
    if (file.size > MAX_NOTE_BYTES) {
      options.report('ファイルが大きすぎます。');
      return;
    }
    importing = true;
    try {
      const buffer = await file.arrayBuffer();
      let text: string;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
      } catch {
        options.report('UTF-8のテキストファイルを使用してください。');
        return;
      }
      if (text.includes('\0')) {
        options.report('テキストファイルを使用してください。');
        return;
      }
      assertNoteSize(text);
      if (!disposed && options.allowed()) await options.importText(text);
    } catch {
      if (!disposed) options.report('ファイルを読み込めませんでした。');
    } finally {
      importing = false;
    }
  }
  onMounted(() => {
    window.addEventListener('dragenter', enter, true);
    window.addEventListener('dragover', over, true);
    window.addEventListener('dragleave', leave, true);
    window.addEventListener('drop', drop, true);
    window.addEventListener('blur', reset);
  });
  onBeforeUnmount(() => {
    disposed = true;
    window.removeEventListener('dragenter', enter, true);
    window.removeEventListener('dragover', over, true);
    window.removeEventListener('dragleave', leave, true);
    window.removeEventListener('drop', drop, true);
    window.removeEventListener('blur', reset);
  });
  return { dragging };
}
