<script setup lang="ts">
import MaterialIcon from './MaterialIcon.vue';
import { onBeforeUnmount, onMounted, shallowRef, watch, nextTick } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { getMarkRange } from '@tiptap/core';
import {
  canShiftListIndent,
  shiftListIndent,
} from '../../../../packages/editor/src/memo-line';
const { editor, composing } = defineProps<{
  editor: Editor;
  composing: boolean;
}>();
const container = shallowRef<HTMLElement | null>(null);
const position = shallowRef<{ left: number; top: number } | null>(null);
const linkAction = shallowRef<{
  left: number;
  top: number;
  href: string;
} | null>(null);
const canIndent = shallowRef(false),
  canOutdent = shallowRef(false);
function update() {
  if (editor.isDestroyed || !container.value) return;
  // Measure both in the same coordinate space, including Safari's viewport pan.
  // The scroll container then moves the overlays with the document natively.
  const origin = container.value.getBoundingClientRect();
  canIndent.value = canShiftListIndent(editor, 1);
  canOutdent.value = canShiftListIndent(editor, -1);
  const viewport = window.visualViewport;
  const bottom =
    (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 52;
  if (editor.isFocused && editor.state.selection.$from.parent.attrs.marker) {
    const rect = editor.view.coordsAtPos(editor.state.selection.head);
    position.value =
      rect.bottom > 0 && rect.top < bottom
        ? {
            left:
              Math.max(8, Math.min(innerWidth - 148, rect.right + 12)) -
              origin.left,
            top: Math.max(54, Math.min(bottom, rect.bottom + 8)) - origin.top,
          }
        : null;
  } else position.value = null;
  linkAction.value = null;
  const actionFocused = document.activeElement?.closest('.link-open');
  if (
    (editor.isFocused || actionFocused) &&
    !composing &&
    !editor.view.composing &&
    editor.state.selection.empty
  ) {
    const range = getMarkRange(
      editor.state.selection.$head,
      editor.schema.marks.link,
    );
    if (!range) return;
    const mark = editor.state.doc
      .resolve(range.from)
      .nodeAfter?.marks.find((mark) => mark.type === editor.schema.marks.link);
    const href = mark?.attrs.href as string | undefined;
    if (!href || !/^https?:\/\//i.test(href)) return;
    const start = editor.view.domAtPos(range.from, 1),
      end = editor.view.domAtPos(range.to, -1);
    const domRange = editor.view.dom.ownerDocument.createRange();
    domRange.setStart(start.node, start.offset);
    domRange.setEnd(end.node, end.offset);
    const rect = domRange.getBoundingClientRect();
    if (rect.bottom > 0 && rect.top < bottom)
      linkAction.value = {
        href,
        left:
          Math.min(innerWidth - 48, Math.max(8, rect.right - 10)) - origin.left,
        top: Math.max(48, rect.top - 36) - origin.top,
      };
  }
}
function shift(direction: 1 | -1) {
  if (composing || !canShiftListIndent(editor, direction)) return;
  editor.view.focus();
  shiftListIndent(editor, direction);
  update();
}
function onBlur({ event }: { event: FocusEvent }) {
  // Tabbing to the action must leave it mounted long enough to activate it.
  if ((event.relatedTarget as HTMLElement | null)?.closest('.link-open'))
    return;
  update();
}
onMounted(() => {
  for (const event of ['selectionUpdate', 'transaction', 'focus'] as const)
    editor.on(event, update);
  window.addEventListener('resize', update);
  document.addEventListener('scroll', update, true);
  editor.on('blur', onBlur);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
});
// Composition may finish without a selection change.
watch(
  () => composing,
  () => {
    void nextTick(update);
  },
);
onBeforeUnmount(() => {
  for (const event of ['selectionUpdate', 'transaction', 'focus'] as const)
    editor.off(event, update);
  window.removeEventListener('resize', update);
  document.removeEventListener('scroll', update, true);
  editor.off('blur', onBlur);
  window.visualViewport?.removeEventListener('resize', update);
  window.visualViewport?.removeEventListener('scroll', update);
});
</script>
<template>
  <div ref="container" class="editor-overlays">
    <div
      v-if="position && !composing"
      class="indent-popover"
      role="group"
      aria-label="リストの階層"
      :style="{ left: position.left + 'px', top: position.top + 'px' }"
      @pointerdown.prevent
      @mousedown.prevent
    >
      <button
        :disabled="!canOutdent"
        title="字上げ（Shift＋Tab）"
        aria-label="字上げ"
        @click="shift(-1)"
      >
        <MaterialIcon name="keyboardTabRtl" />
      </button>
      <button
        :disabled="!canIndent"
        title="字下げ（Tab）"
        aria-label="字下げ"
        @click="shift(1)"
      >
        <MaterialIcon name="keyboardTab" />
      </button>
    </div>
    <a
      v-if="linkAction && !composing"
      class="link-open"
      :href="linkAction.href"
      :style="{ left: linkAction.left + 'px', top: linkAction.top + 'px' }"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="リンクを別タブで開く"
      title="別タブで開く"
      @pointerdown.prevent
      @mousedown.prevent
      @blur="update"
      ><MaterialIcon name="openInNew"
    /></a>
  </div>
</template>
