<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import {
  MAX_NOTE_SEARCH_QUERY_LENGTH,
  noteSearchPattern,
  type NoteSearchResponse,
} from '../../../../packages/core/src/note-search';
import { api, ApiError, type NoteReference } from '../api';
import MaterialIcon from './MaterialIcon.vue';
const { items, selected, signedIn, busy } = defineProps<{
  items: NoteReference[];
  selected: string;
  signedIn: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  select: [token: string];
  create: [];
  account: [];
  close: [];
  searchQuery: [query: string];
}>();
const query = shallowRef('');
const response = shallowRef<NoteSearchResponse>();
const pending = shallowRef(false);
const error = shallowRef('');
const input = useTemplateRef<HTMLInputElement>('queryInput');
let request: AbortController | undefined;
const rows = computed(() => {
  if (!response.value) return pending.value || error.value ? [] : items;
  const listed = new Set(items.map(({ token }) => token));
  return response.value.results.filter(({ token }) => listed.has(token));
});
const pattern = computed(() => noteSearchPattern(query.value.trim()));

function highlight(text: string) {
  const parts: { text: string; match: boolean }[] = [];
  let end = 0;
  for (const match of text.matchAll(pattern.value)) {
    if (match.index > end)
      parts.push({ text: text.slice(end, match.index), match: false });
    parts.push({ text: match[0], match: true });
    end = match.index + match[0].length;
  }
  if (end < text.length) parts.push({ text: text.slice(end), match: false });
  return parts;
}

function resetSearch() {
  request?.abort();
  request = undefined;
  response.value = undefined;
  error.value = '';
  pending.value = false;
  emit('searchQuery', '');
}
function clearSearch() {
  query.value = '';
  input.value?.focus();
}
async function search() {
  const term = query.value.trim();
  if (!term || pending.value) return;
  const controller = new AbortController();
  resetSearch();
  request = controller;
  pending.value = true;
  try {
    const result = await api<NoteSearchResponse>(
      '/list/search',
      { query: term },
      'POST',
      controller.signal,
    );
    if (request === controller) {
      response.value = result;
      emit('searchQuery', term);
    }
  } catch (cause) {
    if (request === controller)
      error.value =
        cause instanceof ApiError && cause.status === 429
          ? '検索回数が多いため、少し待ってから再検索してください。'
          : '検索できませんでした。もう一度お試しください。';
  } finally {
    if (request === controller) {
      request = undefined;
      pending.value = false;
    }
  }
}
watch(query, resetSearch, { flush: 'sync' });
watch(
  () => signedIn,
  (value) => {
    if (!value) query.value = '';
  },
);
onBeforeUnmount(resetSearch);
</script>
<template>
  <aside class="note-list" aria-label="メモリスト">
    <div class="list-heading">
      <span class="app-name">memo</span
      ><button
        class="quiet list-close"
        aria-label="リストを閉じる"
        @click="emit('close')"
      >
        <MaterialIcon name="close" />
      </button>
    </div>
    <template v-if="signedIn">
      <button
        class="new-note"
        :disabled="busy"
        title="新しいメモ（Ctrl/⌘＋Alt＋N）"
        @click="emit('create')"
      >
        <MaterialIcon name="add" /> 新しいメモ
      </button>
      <nav aria-label="自分のメモ">
        <div
          v-for="item in rows"
          :key="item.token"
          class="note-row"
          :class="{ selected: item.token === selected }"
        >
          <button
            class="note-select"
            :class="{ 'note-search-result': response }"
            :aria-current="item.token === selected ? 'page' : undefined"
            @click="emit('select', item.token)"
          >
            <template v-if="response">
              <template
                v-for="(part, index) in highlight(item.title)"
                :key="index"
                ><mark v-if="part.match">{{ part.text }}</mark
                ><template v-else>{{ part.text }}</template></template
              >
              <span
                v-if="'snippet' in item && item.snippet"
                class="note-snippet"
                ><template v-if="item.snippet.truncatedBefore">…</template>
                <template
                  v-for="(part, index) in highlight(item.snippet.text)"
                  :key="index"
                  ><mark v-if="part.match">{{ part.text }}</mark
                  ><template v-else>{{ part.text }}</template></template
                ><template v-if="item.snippet.truncatedAfter">…</template>
              </span>
            </template>
            <template v-else>{{ item.title }}</template>
          </button>
        </div>
      </nav>
      <div class="list-bottom">
        <form class="list-search" role="search" @submit.prevent="search">
          <div class="list-search-field">
            <input
              ref="queryInput"
              v-model="query"
              type="search"
              enterkeyhint="search"
              autocomplete="off"
              :maxlength="MAX_NOTE_SEARCH_QUERY_LENGTH"
              placeholder="メモを検索"
              aria-label="メモを検索"
              @keydown.enter="
                ($event.isComposing || $event.keyCode === 229) &&
                $event.preventDefault()
              "
            />
            <button
              v-if="query"
              type="button"
              class="icon-button list-search-clear"
              aria-label="検索をクリア"
              @click="clearSearch"
            >
              <MaterialIcon name="close" />
            </button>
          </div>
          <button
            type="submit"
            class="icon-button"
            aria-label="検索"
            title="検索"
            :disabled="!query.trim() || pending"
          >
            <MaterialIcon name="search" />
          </button>
        </form>
        <div role="status" class="list-search-status">
          <p v-if="pending">検索中…</p>
          <p v-else-if="error">{{ error }}</p>
          <p v-else-if="response">
            {{ rows.length ? `${rows.length}件` : '一致するメモはありません' }}
            <span v-if="response.truncatedAt">
              メモが多いため、リストの先頭{{
                response.truncatedAt
              }}件を検索しました。
            </span>
          </p>
        </div>
      </div>
    </template>
    <div v-else class="guest-list">
      <button class="wide" @click="emit('account')">ログイン</button>
      <p class="hint">メモリストを端末間で共有</p>
    </div>
    <a
      class="site-link"
      href="https://anipopina.com/"
      target="_blank"
      rel="noopener noreferrer"
      >anipopina.com</a
    >
  </aside>
</template>
