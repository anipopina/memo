<script setup lang="ts">
import MaterialIcon from './MaterialIcon.vue';
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
          ><button type="submit" class="wide">リストに追加</button>
        </form>
        <button v-else class="add-existing" @click="adding = true">
          <MaterialIcon name="add" /> URLでメモを追加
        </button>
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
