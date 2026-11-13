<script setup lang="ts">
import MaterialIcon from './MaterialIcon.vue';
import { computed, shallowRef, useTemplateRef } from 'vue';
const { token } = defineProps<{ token: string }>();
const emit = defineEmits<{ closed: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const message = shallowRef('');
const web = computed(() => `${location.origin}/${token}`),
  mcp = computed(() => `${location.origin}/mcp/${token}`);
function open() {
  message.value = '';
  dialog.value?.showModal();
}
async function copy(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    message.value = 'コピーしました';
  } catch {
    message.value = 'URLを選択してコピーしてください';
  }
}
defineExpose({ open });
</script>
<template>
  <dialog ref="dialog" aria-labelledby="share-title" @close="emit('closed')">
    <div class="dialog-heading">
      <h2 id="share-title">共有</h2>
      <button class="quiet" aria-label="閉じる" @click="dialog?.close()">
        <MaterialIcon name="close" />
      </button>
    </div>
    <label
      >メモのURL<input
        :value="web"
        readonly
        aria-label="メモのURL"
        @focus="($event.target as HTMLInputElement).select()"
    /></label>
    <button class="wide" @click="copy(web)">メモのURLをコピー</button>
    <label class="spaced"
      >AIから編集<input
        :value="mcp"
        readonly
        aria-label="MCPのURL"
        @focus="($event.target as HTMLInputElement).select()"
    /></label>
    <button class="wide" @click="copy(mcp)">MCPのURLをコピー</button>
    <p class="hint">URLを知っている人は、このメモを閲覧・編集できます。</p>
    <p class="hint" role="status">{{ message }}</p>
  </dialog>
</template>
