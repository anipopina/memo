import type { Editor } from '@tiptap/core';
import type { Transaction } from '@tiptap/pm/state';

const MAX_RECORDS = 160;
const events = [
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'keydown',
  'keyup',
  'beforeinput',
  'input',
] as const;

/** Opt-in, memory-only tracing. Do not read text, event.data, or key values into the report. */
export function createImeTrace(editor: Editor) {
  let active = false;
  let started = 0;
  let records: Record<string, unknown>[] = [];
  let dropped = 0;
  let detach = () => {};

  function domSelection() {
    const dom = editor.view.dom;
    const selection = dom.ownerDocument.getSelection();
    const endpoint = (node: Node | null, offset: number) => {
      if (!node) return null;
      const inside = dom.contains(node);
      // Numeric paths and node kinds identify detached/moved carets without text or HTML.
      const path: number[] = [];
      if (inside) {
        for (let current = node; current !== dom && current.parentNode;) {
          const parent = current.parentNode;
          path.unshift(
            Array.prototype.indexOf.call(parent.childNodes, current),
          );
          current = parent;
        }
      }
      let position: number | null = null;
      if (inside) {
        try {
          position = editor.view.posAtDOM(node, offset);
        } catch {
          // A native IME may temporarily leave a node outside the mapped document.
        }
      }
      return {
        inside,
        connected: node.isConnected,
        type: node.nodeType,
        path,
        offset,
        position,
      };
    };
    return {
      focused: dom.ownerDocument.activeElement === dom,
      anchor: endpoint(
        selection?.anchorNode ?? null,
        selection?.anchorOffset ?? 0,
      ),
      focus: endpoint(
        selection?.focusNode ?? null,
        selection?.focusOffset ?? 0,
      ),
    };
  }

  function record(detail: Record<string, unknown>) {
    if (!active) return;
    const { doc, selection } = editor.state;
    const row = selection.$from.index(0);
    const nearby = [];
    for (
      let index = Math.max(0, row - 1);
      index <= Math.min(doc.childCount - 1, row + 1);
      index++
    ) {
      const line = doc.child(index);
      nearby.push({
        row: index,
        length: line.textContent.length,
        list:
          line.attrs.marker === '-'
            ? 'bullet'
            : line.attrs.marker
              ? 'ordered'
              : null,
      });
    }
    records.push({
      ms: Math.round((performance.now() - started) * 10) / 10,
      ...detail,
      composing: editor.view.composing,
      rowCount: doc.childCount,
      row,
      offset: selection.$from.parentOffset,
      selectionEmpty: selection.empty,
      nearby,
      domSelection: domSelection(),
    });
    if (records.length > MAX_RECORDS) {
      records.shift();
      dropped++;
    }
  }

  function stop() {
    active = false;
    detach();
    detach = () => {};
    // Keep each record on one line so reports remain readable without hundreds of lines.
    const header = JSON.stringify({
      format: 2,
      userAgent: navigator.userAgent,
      dropped,
    });
    return `${header.slice(0, -1)},"records":[\n${records.map((item) => JSON.stringify(item)).join(',\n')}\n]}`;
  }

  function start() {
    stop();
    active = true;
    records = [];
    dropped = 0;
    started = performance.now();
    const dom = editor.view.dom;
    const snapshot = (event: Event, phase: string) => {
      const keyboard = event instanceof KeyboardEvent ? event : null;
      const input = event instanceof InputEvent ? event : null;
      const composition = event instanceof CompositionEvent ? event : null;
      const key =
        keyboard?.key === 'Enter'
          ? 'Enter'
          : keyboard?.key === 'Process'
            ? 'Process'
            : keyboard
              ? 'other'
              : undefined;
      const keyCode =
        keyboard?.keyCode === 13 || keyboard?.keyCode === 229
          ? keyboard.keyCode
          : undefined;
      record({
        event: event.type,
        phase,
        key,
        keyCode,
        inputType: input?.inputType,
        isComposing: input?.isComposing ?? keyboard?.isComposing,
        dataLength: (input?.data ?? composition?.data)?.length,
        cancelable: event.cancelable,
        prevented: event.defaultPrevented,
      });
    };
    const capture = (event: Event) => snapshot(event, 'before');
    // Registered after ProseMirror's bubble listeners. Native dispatch can run microtasks
    // between listeners, so a microtask from capture is not an after-handler snapshot.
    const bubble = (event: Event) => snapshot(event, 'after');
    const transaction = ({ transaction }: { transaction: Transaction }) =>
      record({
        event: 'transaction',
        docChanged: transaction.docChanged,
        selectionSet: transaction.selectionSet,
        composition: transaction.getMeta('composition') !== undefined,
      });
    for (const name of events) {
      dom.addEventListener(name, capture, { capture: true, passive: true });
      dom.addEventListener(name, bubble, { passive: true });
    }
    editor.on('transaction', transaction);
    detach = () => {
      for (const name of events) {
        dom.removeEventListener(name, capture, true);
        dom.removeEventListener(name, bubble);
      }
      editor.off('transaction', transaction);
    };
    record({ event: 'trace-start' });
  }

  return { start, stop };
}
