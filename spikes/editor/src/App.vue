<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import ImeDiagnostics from './ImeDiagnostics.vue';
import ListIndentControls from './ListIndentControls.vue';
import { createMemoEditor, applyRemoteMarkdown, loadMarkdown } from './editor';
import { serializeMarkdown } from '../../../packages/core/src/markdown';
import { mergeMarkdown } from '../../../packages/core/src/merge';

const fixture =
  '# 未対応の記法も保持\n\n- 買い物\n    - 牛乳\n- https://example.com/path?q=1\n\n1. 最初の手順\n    1. 子の手順\n2. 次の手順\n\n**太字**  \n[表示名](https://example.com)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = "<script>";\n```\n\n<!-- コメント -->\n';
const source = shallowRef(fixture);
const output = shallowRef(fixture);
const loadedBase = shallowRef(fixture);
const incoming = shallowRef(fixture);
const composing = shallowRef(false);
const selectedLink = shallowRef<string | null>(null);
const status = computed(() =>
  composing.value ? '日本語を変換中（保存待機）' : '検証用の出力に反映済み',
);
const base = shallowRef('りんご\n牛乳');
const local = shallowRef('りんごを買う\n牛乳');
const remote = shallowRef('りんご\n牛乳を買う');
const merged = computed(() =>
  mergeMarkdown(base.value, local.value, remote.value),
);
const editor = createMemoEditor({
  content: fixture,
  onChange: (instance) => {
    selectedLink.value = null;
    if (!composing.value) output.value = serializeMarkdown(instance.getJSON());
  },
  onLink: (href) => {
    selectedLink.value = href;
  },
  onComposition: (value) => {
    composing.value = value;
    if (!value)
      globalThis.requestAnimationFrame(() => {
        if (!editor.isDestroyed)
          output.value = serializeMarkdown(editor.getJSON());
      });
  },
});
function load() {
  loadMarkdown(editor, source.value);
  output.value = serializeMarkdown(editor.getJSON());
  selectedLink.value = null;
  loadedBase.value = source.value;
  incoming.value = source.value;
}
function receive() {
  const result = mergeMarkdown(loadedBase.value, output.value, incoming.value);
  if (applyRemoteMarkdown(editor, result.content))
    loadedBase.value = incoming.value;
}
onBeforeUnmount(() => editor.destroy());
</script>

<template>
  <main class="workspace">
    <header class="header">
      <h1>memo <span class="subtitle">エディタ先行検証</span></h1>
      <p>
        サーバー保存はしません。検証用のサンプルか、機密情報を含まない文章を使用してください。
      </p>
    </header>
    <section aria-labelledby="editor-heading">
      <div class="section-heading">
        <h2 id="editor-heading">本文</h2>
        <span role="status">{{ status }}</span>
      </div>
      <p class="editor-help">
        リストの階層は「字下げ」「字上げ」で変更できます。PCではTab／Shift＋Tabも使えます。番号付きは「1.
        」や「2. 」などで開始できます。
      </p>
      <ListIndentControls :editor="editor" :composing="composing" />
      <EditorContent :editor="editor" class="editor-surface" />
      <div v-if="selectedLink" class="link-action">
        <a :href="selectedLink" target="_blank" rel="noopener noreferrer"
          >リンクを別タブで開く</a
        >
        <button @click="selectedLink = null">閉じる</button>
      </div>
    </section>
    <ImeDiagnostics :editor="editor" />
    <details open>
      <summary>Markdownの往復を確認</summary>
      <div class="columns">
        <label
          >入力するMarkdown<textarea
            v-model="source"
            aria-label="入力するMarkdown"
            spellcheck="false"
          />
        </label>
        <label
          >出力されたMarkdown<textarea
            :value="output"
            aria-label="出力されたMarkdown"
            readonly
            spellcheck="false"
          />
        </label>
      </div>
      <div class="section-heading">
        <button @click="load">本文へ読み込む</button>
        <output data-testid="roundtrip">{{
          source === output ? '原文と一致' : '原文から変更あり'
        }}</output>
      </div>
    </details>
    <details>
      <summary>他端末の変更とカーソル維持を確認</summary>
      <label
        >他端末の本文<textarea v-model="incoming" aria-label="他端末の本文" />
      </label>
      <button :disabled="composing" @click="receive">他端末の変更を反映</button>
    </details>
    <details>
      <summary>同時編集の自動統合を確認</summary>
      <div class="columns merge-inputs">
        <label>共通の保存済み本文<textarea v-model="base" /></label>
        <label>手元の編集<textarea v-model="local" /></label>
        <label>サーバーの最新本文<textarea v-model="remote" /></label>
      </div>
      <label>統合結果<textarea :value="merged.content" readonly /></label>
      <p>
        {{
          merged.adjusted
            ? '重なった変更は手元の編集を優先しました。'
            : '両方の変更を統合しました。'
        }}
      </p>
    </details>
  </main>
</template>
