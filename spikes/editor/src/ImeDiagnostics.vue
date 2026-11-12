<script setup lang="ts">
import { onBeforeUnmount, shallowRef } from 'vue';
import type { Editor } from '@tiptap/core';
import { createImeTrace } from './ime-trace';

const { editor } = defineProps<{ editor: Editor }>();
const trace = createImeTrace(editor);
const recording = shallowRef(false);
const report = shallowRef('');
const message = shallowRef('');
function start() {
  trace.start();
  recording.value = true;
  report.value = '';
  message.value = '';
}
function stop() {
  report.value = trace.stop();
  recording.value = false;
}
async function copy() {
  try {
    await globalThis.navigator.clipboard.writeText(report.value);
    message.value = '診断結果をコピーしました。';
  } catch {
    message.value = '結果欄を選択してコピーしてください。';
  }
}
onBeforeUnmount(() => trace.stop());
</script>

<template>
  <details>
    <summary>IME入力の診断</summary>
    <p>
      記録を開始して、空行で「日本語入力 → 確定 →
      すぐ改行」を試した後に終了してください。
    </p>
    <p>
      本文を含めず、イベントの順序・時間・行数だけをこの画面内で記録します。記録中は結果表示を更新しません。
    </p>
    <div class="section-heading">
      <button v-if="!recording" @click="start">IME記録を開始</button>
      <button v-else @click="stop">IME記録を終了</button>
      <span v-if="recording" role="status">記録中</span>
      <button v-if="report" @click="copy">IME診断結果をコピー</button>
    </div>
    <label v-if="report"
      >診断結果<textarea
        :value="report"
        aria-label="IME診断結果"
        readonly
        spellcheck="false"
      />
    </label>
    <p v-if="message" role="status">{{ message }}</p>
  </details>
</template>
