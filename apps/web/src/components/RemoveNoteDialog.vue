<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue';
import MaterialIcon from './MaterialIcon.vue';
const { remove } = defineProps<{ remove: (token: string) => Promise<void> }>();
const emit = defineEmits<{ closed: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const target = shallowRef({ token: '', title: '' });
const busy = shallowRef(false),
  error = shallowRef('');
function open(token: string, title: string) {
  target.value = { token, title };
  error.value = '';
  dialog.value?.showModal();
}
async function confirm() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    await remove(target.value.token);
    dialog.value?.close();
  } catch {
    error.value = 'リストから削除できませんでした。接続を確認してください。';
  } finally {
    busy.value = false;
  }
}
defineExpose({ open });
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="remove-note-title"
    aria-describedby="remove-note-description"
    @close="emit('closed')"
    @cancel="busy && $event.preventDefault()"
  >
    <div class="dialog-heading">
      <h2 id="remove-note-title">リストから削除</h2>
      <button
        class="quiet"
        aria-label="閉じる"
        :disabled="busy"
        @click="dialog?.close()"
      >
        <MaterialIcon name="close" />
      </button>
    </div>
    <p class="note-title">{{ target.title }}</p>
    <p id="remove-note-description" class="hint">
      このメモをリストから削除しますか？<br />メモ自体は残りますが、再び開くにはこのメモのURLが必要です。
    </p>
    <div class="dialog-actions">
      <button autofocus :disabled="busy" @click="dialog?.close()">
        キャンセル
      </button>
      <button class="danger" :disabled="busy" @click="confirm">
        <span v-if="busy" class="spinner" aria-hidden="true"></span>
        {{ busy ? '削除中…' : '削除する' }}
      </button>
    </div>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </dialog>
</template>
<style scoped>
.note-title {
  overflow-wrap: anywhere;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
}
</style>
