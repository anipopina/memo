<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, watch, nextTick } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import {
  canShiftListIndent,
  shiftListIndent,
} from '../../../../packages/editor/src/memo-line';
const { editor, composing, link } = defineProps<{
  editor: Editor;
  composing: boolean;
  link: { href: string; anchor: HTMLElement } | null;
}>();
const emit = defineEmits<{ closeLink: [] }>();
const position = shallowRef<{ left: number; top: number } | null>(null);
const linkPosition = shallowRef<{ left: number; top: number } | null>(null);
const canIndent = shallowRef(false),
  canOutdent = shallowRef(false);
function update() {
  if (editor.isDestroyed) return;
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
            left: Math.max(8, Math.min(innerWidth - 148, rect.right + 12)),
            top: Math.max(54, Math.min(bottom, rect.bottom + 8)),
          }
        : null;
  } else position.value = null;
  if (link?.anchor.isConnected) {
    const rect = link.anchor.getBoundingClientRect();
    linkPosition.value =
      rect.bottom > 0 && rect.top < bottom
        ? {
            left: Math.min(innerWidth - 48, Math.max(8, rect.right - 10)),
            top: Math.max(48, rect.top - 36),
          }
        : null;
  } else linkPosition.value = null;
}
function shift(direction: 1 | -1) {
  if (composing || !canShiftListIndent(editor, direction)) return;
  editor.view.focus();
  shiftListIndent(editor, direction);
  update();
}
function onPointer(event: PointerEvent) {
  if (
    link &&
    !(event.target as HTMLElement).closest('.link-open') &&
    !(event.target as HTMLElement).closest('a')
  )
    emit('closeLink');
}
onMounted(() => {
  for (const event of [
    'selectionUpdate',
    'transaction',
    'focus',
    'blur',
  ] as const)
    editor.on(event, update);
  window.addEventListener('resize', update);
  document.addEventListener('scroll', update, true);
  document.addEventListener('pointerdown', onPointer);
  window.visualViewport?.addEventListener('resize', update);
  window.visualViewport?.addEventListener('scroll', update);
});
// Parent updates a selected link after the editor click event.
watch(
  () => link,
  () => {
    void nextTick(update);
  },
);
onBeforeUnmount(() => {
  for (const event of [
    'selectionUpdate',
    'transaction',
    'focus',
    'blur',
  ] as const)
    editor.off(event, update);
  window.removeEventListener('resize', update);
  document.removeEventListener('scroll', update, true);
  document.removeEventListener('pointerdown', onPointer);
  window.visualViewport?.removeEventListener('resize', update);
  window.visualViewport?.removeEventListener('scroll', update);
});
</script>
<template>
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
      :disabled="!canIndent"
      title="字下げ（Tab）"
      aria-label="字下げ"
      @click="shift(1)"
    >
      字下げ
    </button>
    <button
      :disabled="!canOutdent"
      title="字上げ（Shift＋Tab）"
      aria-label="字上げ"
      @click="shift(-1)"
    >
      字上げ
    </button>
  </div>
  <a
    v-if="link && linkPosition && !composing"
    class="link-open"
    :href="link.href"
    :style="{ left: linkPosition.left + 'px', top: linkPosition.top + 'px' }"
    target="_blank"
    rel="noopener noreferrer"
    aria-label="リンクを別タブで開く"
    title="別タブで開く"
    >↗</a
  >
</template>
