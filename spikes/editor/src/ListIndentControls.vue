<script setup lang="ts">
import { computed } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import { canShiftListIndent, shiftListIndent } from './memo-line';

const { editor, composing } = defineProps<{
  editor: Editor;
  composing: boolean;
}>();

// The Vue editor's state getter tracks selection and document transactions.
const canIndent = computed(() => !composing && canShiftListIndent(editor, 1));
const canOutdent = computed(() => !composing && canShiftListIndent(editor, -1));

function shift(direction: 1 | -1) {
  if (composing || !canShiftListIndent(editor, direction)) return;
  // Keep focus synchronous with the gesture so mobile keyboards can stay open.
  editor.view.focus();
  shiftListIndent(editor, direction);
}
</script>

<template>
  <div class="list-indent-controls" role="group" aria-label="リストの階層">
    <!-- Prevent pointer focus from replacing the editor's caret or text selection. -->
    <button
      type="button"
      :disabled="!canIndent"
      title="リストを1段下げる（Tab）"
      @pointerdown.prevent
      @mousedown.prevent
      @click="shift(1)"
    >
      字下げ
    </button>
    <button
      type="button"
      :disabled="!canOutdent"
      title="リストを1段戻す（Shift＋Tab）"
      @pointerdown.prevent
      @mousedown.prevent
      @click="shift(-1)"
    >
      字上げ
    </button>
  </div>
</template>

<style scoped>
.list-indent-controls {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.list-indent-controls button:disabled {
  color: var(--muted);
  background: #f4f6fa;
  cursor: default;
}
</style>
