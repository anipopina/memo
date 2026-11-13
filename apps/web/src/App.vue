<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
} from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import {
  createMemoEditor,
  loadMarkdown,
  applyRemoteMarkdown,
} from '../../../packages/editor/src/editor';
import { serializeMarkdown } from '../../../packages/core/src/markdown';
import { isNoteToken } from '../../../packages/core/src/note';
import { api, ApiError, type NoteReference } from './api';
import { useNote } from './useNote';
import NoteList from './components/NoteList.vue';
import AccountDialog from './components/AccountDialog.vue';
import ShareDialog from './components/ShareDialog.vue';
import EditorOverlays from './components/EditorOverlays.vue';
const signedIn = shallowRef(false),
  accountId = shallowRef(''),
  items = shallowRef<NoteReference[]>([]);
const sidebar = shallowRef(
  localStorage.getItem('memo.sidebar') !== 'closed' && innerWidth >= 800,
);
const busy = shallowRef(false),
  message = shallowRef('');
const link = shallowRef<{ href: string; anchor: HTMLElement } | null>(null);
const accountDialog =
  useTemplateRef<InstanceType<typeof AccountDialog>>('accountDialog');
const shareDialog =
  useTemplateRef<InstanceType<typeof ShareDialog>>('shareDialog');
const note = useNote((text, reset) => {
  if (reset) loadMarkdown(editor, text);
  else applyRemoteMarkdown(editor, text);
  link.value = null;
});
const editor = createMemoEditor({
  content: '',
  onChange: (instance) => {
    if (!note.state.composing) note.edit(serializeMarkdown(instance.getJSON()));
  },
  onLink: (href, event) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (anchor) link.value = { href, anchor };
  },
  onComposition: (value) => {
    note.state.composing = value;
    if (!value)
      requestAnimationFrame(() => {
        if (!editor.isDestroyed) note.edit(serializeMarkdown(editor.getJSON()));
      });
  },
});
const status = computed(() =>
  note.state.loading
    ? '読込中'
    : note.state.localError
      ? '端末に保管できません'
      : note.state.error || note.state.saving
        ? ''
        : note.dirty()
          ? '未保存'
          : note.state.persisted
            ? '保存済み'
            : '',
);
const saveLabel = computed(
  () => note.state.error || (note.state.saving ? '保存中' : status.value),
);
const inList = computed(() =>
  items.value.some((item) => item.token === note.state.token),
);
const visibleItems = computed(() =>
  items.value.map((item) =>
    item.token === note.state.token
      ? {
          ...item,
          title:
            note.state.content
              .split(/\r?\n/)
              .find((line) => line.trim())
              ?.trim()
              .slice(0, 100) || '無題',
        }
      : item,
  ),
);
const title = computed(
  () =>
    note.state.content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 60) || 'memo',
);
function topToken() {
  const key = signedIn.value ? `memo.last.${accountId.value}` : 'memo.current';
  let token = localStorage.getItem(key);
  if (!token || !isNoteToken(token)) {
    token =
      signedIn.value && items.value.length
        ? items.value[0].token
        : note.newToken();
    localStorage.setItem(key, token);
  }
  return token;
}
async function refreshList() {
  if (!signedIn.value) {
    items.value = [];
    return;
  }
  try {
    items.value = await api<NoteReference[]>('/list');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      signedIn.value = false;
      accountId.value = '';
      items.value = [];
    } else throw error;
  }
}
async function focusEditor() {
  await nextTick();
  editor.commands.focus('end', { scrollIntoView: false });
}
async function select(token: string, remember = true) {
  busy.value = true;
  message.value = '';
  try {
    if (await note.open(token)) {
      history.pushState({}, '', `/${token}`);
      if (remember && signedIn.value)
        localStorage.setItem(`memo.last.${accountId.value}`, token);
      if (innerWidth < 800) sidebar.value = false;
      await focusEditor();
    }
  } finally {
    busy.value = false;
  }
}
async function create() {
  if (!signedIn.value || busy.value) return;
  busy.value = true;
  try {
    const token = note.newToken();
    if (!(await note.open(token, true))) return;
    if (!(await note.flush(true))) {
      message.value = '作成できませんでした。本文はこの端末に保持しています。';
      return;
    }
    await refreshList();
    localStorage.setItem(`memo.last.${accountId.value}`, token);
    history.pushState({}, '', `/${token}`);
    if (innerWidth < 800) sidebar.value = false;
    await focusEditor();
  } catch {
    message.value = '作成できませんでした。';
  } finally {
    busy.value = false;
  }
}
async function add(url?: string) {
  try {
    let token = note.state.token;
    if (url) {
      const parsed = new URL(url);
      if (
        parsed.origin !== location.origin ||
        !/^\/[A-Za-z0-9_-]{22}$/.test(parsed.pathname) ||
        parsed.search ||
        parsed.hash
      )
        throw new Error();
      token = parsed.pathname.slice(1);
    }
    if (!isNoteToken(token)) throw new Error();
    if (token === note.state.token && !(await note.flush(true)))
      throw new Error();
    await api('/list', { token });
    await refreshList();
  } catch {
    message.value = '追加できませんでした。メモのURLと接続を確認してください。';
  }
}
async function remove(token: string) {
  try {
    await api(`/list/${token}`, undefined, 'DELETE');
    await refreshList();
  } catch {
    message.value = '一覧から外せませんでした。';
  }
}
async function share() {
  busy.value = true;
  try {
    if (!(await note.flush(true))) {
      message.value = '保存できませんでした。接続を確認してください。';
      return;
    }
    if (signedIn.value) await refreshList();
    shareDialog.value?.open();
  } catch {
    message.value = '共有の準備ができませんでした。';
  } finally {
    busy.value = false;
  }
}
async function session() {
  const value = await api<{ signedIn: boolean; account?: string }>('/session');
  signedIn.value = value.signedIn;
  accountId.value = value.account ?? '';
  await refreshList();
}
async function authenticated() {
  busy.value = true;
  message.value = '';
  try {
    await session();
    if (note.state.content.length > 0) {
      if (!(await note.flush(true))) throw new Error();
      await api('/list', { token: note.state.token });
      await refreshList();
    } else if (items.value.length) {
      await select(items.value[0].token);
    } else {
      if (!(await note.flush(true))) throw new Error();
      await api('/list', { token: note.state.token });
      await refreshList();
    }
    localStorage.setItem(`memo.last.${accountId.value}`, note.state.token);
  } catch {
    message.value =
      'ログイン後の引き継ぎを完了できませんでした。本文は保持しています。';
  } finally {
    busy.value = false;
  }
}
async function logout() {
  signedIn.value = false;
  accountId.value = '';
  items.value = [];
}
function toggleList() {
  sidebar.value = !sidebar.value;
  localStorage.setItem('memo.sidebar', sidebar.value ? 'open' : 'closed');
}
function keyboard(event: KeyboardEvent) {
  if (event.isComposing) return;
  if ((event.metaKey || event.ctrlKey) && event.key === '\\') {
    event.preventDefault();
    toggleList();
  }
  if (
    (event.metaKey || event.ctrlKey) &&
    event.altKey &&
    event.key.toLowerCase() === 'n' &&
    signedIn.value
  ) {
    event.preventDefault();
    void create();
  }
}
async function route() {
  const path = location.pathname;
  if (path === '/' || path === '') {
    await note.open(topToken(), true);
  } else if (/^\/[A-Za-z0-9_-]{22}$/.test(path) && isNoteToken(path.slice(1)))
    await note.open(path.slice(1));
  else {
    note.state.ready = false;
    note.state.error = 'メモが見つかりません';
  }
}
async function recover() {
  try {
    await navigator.clipboard.writeText(note.state.recovery);
    message.value = '調整前の本文をコピーしました。';
  } catch {
    message.value = 'コピーできませんでした。';
  }
}
const listTimer = setInterval(() => {
  if (signedIn.value && document.visibilityState === 'visible')
    void refreshList().catch(() => {});
}, 15000);
onMounted(async () => {
  window.addEventListener('keydown', keyboard);
  window.addEventListener('popstate', route);
  try {
    await session();
  } catch {
    message.value = '接続を確認してください。';
  }
  if (editor.isDestroyed) return;
  if (!signedIn.value && localStorage.getItem('memo.sidebar') === null)
    sidebar.value = false;
  await route();
  if (innerWidth >= 800 && note.state.ready) await focusEditor();
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', keyboard);
  window.removeEventListener('popstate', route);
  clearInterval(listTimer);
  editor.destroy();
});
</script>
<template>
  <div class="app" :class="{ 'list-visible': sidebar }">
    <button
      v-if="sidebar"
      class="drawer-backdrop"
      aria-label="一覧を閉じる"
      @click="sidebar = false"
    ></button>
    <NoteList
      v-if="sidebar"
      :items="visibleItems"
      :selected="note.state.token"
      :signed-in="signedIn"
      :busy="busy"
      @select="select"
      @create="create"
      @add="add"
      @remove="remove"
      @account="accountDialog?.open()"
      @close="toggleList"
    />
    <div class="writing-area">
      <header class="app-header">
        <div class="header-left">
          <button
            class="quiet list-toggle"
            aria-label="メモ一覧"
            title="メモ一覧（Ctrl/⌘＋\）"
            :aria-expanded="sidebar"
            @click="toggleList"
          >
            ☰</button
          ><span class="app-name">memo</span
          ><span class="save-state" role="status">{{ saveLabel }}</span>
        </div>
        <div class="header-right">
          <button
            v-if="signedIn && note.state.ready && !inList"
            class="quiet"
            :disabled="busy"
            @click="add()"
          >
            一覧に追加</button
          ><button
            class="quiet"
            :disabled="busy || !note.state.ready || note.state.composing"
            @click="share"
          >
            共有</button
          ><button
            class="quiet account-button"
            aria-label="アカウント"
            @click="accountDialog?.open()"
          >
            {{ signedIn ? 'アカウント' : 'ログイン' }}
          </button>
        </div>
      </header>
      <div v-if="message" class="notice" role="status">
        <span>{{ message }}</span><button
          class="quiet"
          aria-label="通知を閉じる"
          @click="message = ''"
        >
          ×
        </button>
      </div>
      <div v-if="note.state.adjusted" class="notice">
        <span>重なった編集を調整しました。</span
        ><button class="quiet" @click="recover">調整前をコピー</button
        ><button
          class="quiet"
          aria-label="調整通知を閉じる"
          @click="note.state.adjusted = false"
        >
          ×
        </button>
      </div>
      <main class="document-scroll" :aria-label="title">
        <EditorContent
          v-show="note.state.ready"
          :editor="editor"
          class="memo-document"
        />
        <div v-if="!note.state.ready" class="document-error" role="status">
          {{ note.state.loading ? '' : note.state.error
          }}<button v-if="!note.state.loading" class="quiet" @click="route">
            再読み込み
          </button>
        </div>
      </main>
      <footer v-if="!sidebar" class="app-footer">
        <a
          href="https://anipopina.com/"
          target="_blank"
          rel="noopener noreferrer"
          >anipopina.com</a
        >
      </footer>
    </div>
    <EditorOverlays
      :editor="editor"
      :composing="note.state.composing"
      :link="link"
      @close-link="link = null"
    />
    <AccountDialog
      ref="accountDialog"
      :signed-in="signedIn"
      @authenticated="authenticated"
      @closed="note.state.ready && editor.view.focus()"
      @logout="logout"
    />
    <ShareDialog
      ref="shareDialog"
      :token="note.state.token"
      @closed="note.state.ready && editor.view.focus()"
    />
  </div>
</template>
