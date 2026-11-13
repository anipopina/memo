<script setup lang="ts">
import { shallowRef } from 'vue';
import type { NoteReference } from '../api';
const { items, selected, signedIn, busy } = defineProps<{
  items: NoteReference[];
  selected: string;
  signedIn: boolean;
  busy: boolean;
}>();
const emit = defineEmits<{
  select: [token: string];
  create: [];
  add: [url: string];
  remove: [token: string];
  account: [];
  close: [];
}>();
const adding = shallowRef(false),
  url = shallowRef('');
function add() {
  if (!url.value.trim()) return;
  emit('add', url.value.trim());
  url.value = '';
  adding.value = false;
}
</script>
<template>
  <aside class="note-list" aria-label="メモ一覧">
    <div class="list-heading">
      <span>メモ</span
      ><button
        class="quiet list-close"
        aria-label="一覧を閉じる"
        @click="emit('close')"
      >
        ×
      </button>
    </div>
    <template v-if="signedIn">
      <button
        class="new-note"
        :disabled="busy"
        title="新しいメモ（Ctrl/⌘＋Alt＋N）"
        @click="emit('create')"
      >
        <span>＋</span> 新しいメモ
      </button>
      <nav aria-label="自分のメモ">
        <div
          v-for="item in items"
          :key="item.token"
          class="note-row"
          :class="{ selected: item.token === selected }"
        >
          <button
            class="note-select"
            :aria-current="item.token === selected ? 'page' : undefined"
            @click="emit('select', item.token)"
          >
            {{ item.title }}
          </button>
          <button
            class="remove-note quiet"
            aria-label="一覧から外す"
            :title="`${item.title}を一覧から外す`"
            @click="emit('remove', item.token)"
          >
            ×
          </button>
        </div>
      </nav>
      <div class="list-bottom">
        <form v-if="adding" @submit.prevent="add">
          <label
            >既存メモのURL<input
              v-model="url"
              type="url"
              required
              placeholder="https://…"
              aria-label="追加するメモのURL" /></label
          ><button type="submit" class="wide">一覧に追加</button>
        </form>
        <button v-else class="quiet add-existing" @click="adding = true">
          URLから追加
        </button>
      </div>
    </template>
    <div v-else class="guest-list">
      <button class="wide" @click="emit('account')">ログイン</button>
      <p class="hint">メモ一覧を端末間で共有</p>
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
