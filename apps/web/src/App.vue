<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import { EditorContent } from '@tiptap/vue-3';
import {
  createMemoEditor,
  loadMarkdown,
  applyRemoteMarkdown,
} from '../../../packages/editor/src/editor';
import { refreshSearchHighlight } from '../../../packages/editor/src/search-highlight';
import { serializeMarkdown } from '../../../packages/core/src/markdown';
import { isNoteToken } from '../../../packages/core/src/note';
import { api, ApiError, type NoteReference } from './api';
import { useNote } from './useNote';
import { useFileDrop } from './useFileDrop';
import MaterialIcon from './components/MaterialIcon.vue';
import NoteList from './components/NoteList.vue';
import AccountDialog from './components/AccountDialog.vue';
import ShareDialog from './components/ShareDialog.vue';
import EditorOverlays from './components/EditorOverlays.vue';
import RemoveNoteDialog from './components/RemoveNoteDialog.vue';
const signedIn = shallowRef(false),
  accountId = shallowRef(''),
  items = shallowRef<NoteReference[]>([]);
const sidebar = shallowRef(
  localStorage.getItem('memo.sidebar') !== 'closed' && innerWidth >= 800,
);
const navigating = shallowRef(false);
const starting = shallowRef(true);
let initialSession: Promise<void> | undefined;
const listState = shallowRef<'loading' | 'ready' | 'failed'>('loading');
const moving = shallowRef(false);
const moveError = shallowRef('');
const creating = shallowRef(false);
const sharing = shallowRef(false);
const adding = shallowRef(false);
const searchQuery = shallowRef('');
const busy = shallowRef(false),
  message = shallowRef('');
const accountDialog =
  useTemplateRef<InstanceType<typeof AccountDialog>>('accountDialog');
const shareDialog =
  useTemplateRef<InstanceType<typeof ShareDialog>>('shareDialog');
const removeNoteDialog =
  useTemplateRef<InstanceType<typeof RemoveNoteDialog>>('removeNoteDialog');
const note = useNote((text, reset) => {
  if (reset) loadMarkdown(editor, text);
  else applyRemoteMarkdown(editor, text);
});
const editor = createMemoEditor({
  content: '',
  searchQuery: () => searchQuery.value,
  onChange: (instance) => {
    if (!note.state.composing) note.edit(serializeMarkdown(instance.getJSON()));
  },
  onComposition: (value) => {
    note.state.composing = value;
    if (!value)
      requestAnimationFrame(() => {
        if (editor.isDestroyed) return;
        note.edit(serializeMarkdown(editor.getJSON()));
        refreshSearchHighlight(editor, searchQuery.value);
      });
  },
});
function placeCaretFromPadding(event: PointerEvent) {
  if (event.button !== 0 || !showEditor.value || documentLoading.value) return;
  const target = event.target;
  if (!(target instanceof HTMLElement) || target !== event.currentTarget)
    return;
  const view = editor.view;
  const lines = Array.from(view.dom.children).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const first = lines[0];
  const last = lines.at(-1);
  if (!first || !last) return;
  let position: number;
  if (event.clientY < first.getBoundingClientRect().top) position = 1;
  else if (event.clientY >= last.getBoundingClientRect().bottom)
    position = view.state.doc.content.size - 1;
  else {
    const line = lines.find((element) => {
      const rect = element.getBoundingClientRect();
      return event.clientY >= rect.top && event.clientY < rect.bottom;
    });
    if (!line) return;
    const rect = line.getBoundingClientRect();
    if (event.clientX >= rect.left && event.clientX <= rect.right) return;
    const start = view.posAtDOM(line, 0);
    const node = view.state.doc.resolve(start).parent;
    position = event.clientX < rect.left ? start : start + node.content.size;
  }
  event.preventDefault();
  editor.commands.setTextSelection(position);
  view.focus();
}
watch(searchQuery, (query) => {
  if (!note.state.composing) refreshSearchHighlight(editor, query);
});
const status = computed(() =>
  note.state.localError
    ? '端末に保管できません'
    : note.state.error || note.state.saving
      ? ''
      : note.dirty()
        ? '未保存'
        : note.state.persisted
          ? '保存済み'
          : '',
);
const saveLabel = computed(() =>
  note.state.ready
    ? note.state.error || (note.state.saving ? '保存中' : status.value)
    : '',
);
const documentLoading = computed(() => navigating.value || note.state.loading);
const DOCUMENT_LOADING_DELAY = { skeleton: 150, message: 3000 };
const showDocumentSkeleton = shallowRef(false);
const showDocumentLoadingMessage = shallowRef(false);
const holdPreviousDocument = shallowRef(false);
const previewing = computed(() => !!note.state.preview);
watch(
  previewing,
  (preview) => {
    if (!preview && !note.state.ready) holdPreviousDocument.value = false;
    const editorProps = editor.options.editorProps;
    editor.setOptions({
      editable: !preview,
      editorProps: {
        ...editorProps,
        attributes: {
          ...editorProps.attributes,
          'aria-readonly': String(preview),
        },
      },
    });
  },
  { flush: 'sync' },
);
const documentReady = computed(
  () => note.state.ready && !documentLoading.value,
);
watch(documentReady, (ready, previous) => {
  holdPreviousDocument.value = !ready && previous && documentLoading.value;
});
const showEditor = computed(
  () =>
    previewing.value ||
    documentReady.value ||
    (documentLoading.value &&
      holdPreviousDocument.value &&
      !showDocumentSkeleton.value),
);
watch(
  documentLoading,
  (loading, _previous, onCleanup) => {
    showDocumentSkeleton.value = false;
    showDocumentLoadingMessage.value = false;
    if (!loading) {
      holdPreviousDocument.value = false;
      return;
    }
    const skeletonTimer = window.setTimeout(() => {
      showDocumentSkeleton.value = true;
    }, DOCUMENT_LOADING_DELAY.skeleton);
    const messageTimer = window.setTimeout(() => {
      showDocumentLoadingMessage.value = true;
    }, DOCUMENT_LOADING_DELAY.message);
    onCleanup(() => {
      window.clearTimeout(skeletonTimer);
      window.clearTimeout(messageTimer);
    });
  },
  { immediate: true },
);
const inList = computed(() =>
  items.value.some((item) => item.token === note.state.token),
);
const title = computed(
  () =>
    note.state.content
      .split(/\r?\n/)
      .find((line) => line.trim())
      ?.trim()
      .slice(0, 100) || '無題',
);
const visibleItems = computed(() =>
  items.value.map((item) =>
    note.state.ready && item.token === note.state.token
      ? { ...item, title: title.value }
      : item,
  ),
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
let listRequest = 0;
async function refreshList() {
  const account = accountId.value;
  const request = ++listRequest;
  const isCurrent = () =>
    request === listRequest && account === accountId.value;
  if (!signedIn.value) {
    items.value = [];
    return;
  }
  try {
    const next = await api<NoteReference[]>('/list');
    if (isCurrent()) {
      items.value = next;
      listState.value = 'ready';
    }
  } catch (error) {
    if (!isCurrent()) return;
    if (error instanceof ApiError && error.status === 401) {
      signedIn.value = false;
      accountId.value = '';
      items.value = [];
    } else {
      if (listState.value !== 'ready') listState.value = 'failed';
      throw error;
    }
  }
}
async function retryList() {
  listState.value = 'loading';
  await refreshList().catch(() => {});
}
async function moveNote(token: string, before: string | null) {
  if (!signedIn.value || busy.value) return;
  busy.value = true;
  moving.value = true;
  moveError.value = '';
  let saved = false;
  try {
    await api('/list/order', { token, before });
    saved = true;
    await refreshList();
  } catch (error) {
    moveError.value = saved
      ? '並び順は保存されましたが、一覧を取得できませんでした。'
      : error instanceof ApiError && error.code === 'list_order_too_large'
        ? 'メモが多いため、並び順を保存できませんでした。'
        : '並び順を更新できませんでした。もう一度お試しください。';
  } finally {
    moving.value = false;
    busy.value = false;
  }
}
async function focusEditor() {
  await nextTick();
  editor.commands.focus('end', { scrollIntoView: false });
}
async function openNote(
  token: string,
  { allowCreate = false, fresh = false, replace = false } = {},
) {
  const opened = await note.open(token, {
    allowCreate,
    fresh,
    activate: () => {
      if (location.pathname !== `/${token}`)
        history[replace ? 'replaceState' : 'pushState']({}, '', `/${token}`);
    },
  });
  if (
    !opened &&
    note.state.ready &&
    location.pathname !== `/${note.state.token}`
  )
    history.replaceState({}, '', `/${note.state.token}`);
  return opened;
}
async function select(token: string, remember = true) {
  busy.value = true;
  message.value = '';
  const stopPreviewWatch = watch(previewing, (preview) => {
    if (preview && note.state.token === token && innerWidth < 800)
      sidebar.value = false;
  });
  try {
    if (await openNote(token)) {
      if (remember && signedIn.value)
        localStorage.setItem(`memo.last.${accountId.value}`, token);
      if (innerWidth < 800) sidebar.value = false;
      await focusEditor();
    }
  } finally {
    stopPreviewWatch();
    busy.value = false;
  }
}
async function create() {
  if (!signedIn.value || busy.value || documentLoading.value) return;
  busy.value = true;
  creating.value = true;
  try {
    const token = note.newToken();
    if (!(await openNote(token, { allowCreate: true, fresh: true }))) return;
    if (!(await note.flush(true))) {
      message.value = '作成できませんでした。本文はこの端末に保持しています。';
      return;
    }
    await refreshList();
    localStorage.setItem(`memo.last.${accountId.value}`, token);
    if (innerWidth < 800) sidebar.value = false;
    await focusEditor();
  } catch {
    message.value = '作成できませんでした。';
  } finally {
    creating.value = false;
    busy.value = false;
  }
}
const { dragging } = useFileDrop({
  allowed: () =>
    note.state.ready &&
    !busy.value &&
    !navigating.value &&
    !note.state.composing &&
    !document.querySelector('dialog[open]'),
  importText,
  report: (text) => {
    message.value = text;
  },
});
async function importText(text: string) {
  busy.value = true;
  message.value = '';
  try {
    const token = note.newToken();
    if (!(await openNote(token, { allowCreate: true, fresh: true }))) return;
    loadMarkdown(editor, text);
    note.edit(text);
    localStorage.setItem(
      signedIn.value ? `memo.last.${accountId.value}` : 'memo.current',
      token,
    );
    if (innerWidth < 800) sidebar.value = false;
    if (!(await note.flush(true))) {
      message.value = note.state.localError
        ? '保存できませんでした。元のファイルを保持して接続を確認してください。'
        : '保存できませんでした。本文はこの端末に保持しています。';
    } else if (signedIn.value) await refreshList();
    await focusEditor();
  } catch {
    message.value =
      '取り込みを完了できませんでした。元のファイルを保持してください。';
  } finally {
    busy.value = false;
  }
}
async function add() {
  busy.value = true;
  adding.value = true;
  try {
    const token = note.state.token;
    if (!isNoteToken(token)) throw new Error();
    if (!(await note.flush(true))) throw new Error();
    await api('/list', { token });
    await refreshList();
  } catch {
    message.value = 'リストに追加できませんでした。接続を確認してください。';
  } finally {
    adding.value = false;
    busy.value = false;
  }
}
async function remove(token: string) {
  busy.value = true;
  try {
    await api(`/list/${token}`, undefined, 'DELETE');
    await refreshList();
  } finally {
    busy.value = false;
  }
}
async function share() {
  busy.value = true;
  sharing.value = true;
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
    sharing.value = false;
    busy.value = false;
  }
}
async function session() {
  const value = await api<{ signedIn: boolean; account?: string }>('/session');
  if (accountId.value !== (value.account ?? '')) {
    items.value = [];
    listState.value = 'loading';
    moveError.value = '';
  }
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
async function logout(): Promise<boolean> {
  busy.value = true;
  try {
    if (!(await note.prepareLeave())) return false;
    await api('/auth/logout', {});
    await note.clearPreviews();
    signedIn.value = false;
    accountId.value = '';
    items.value = [];
    note.state.ready = false;
    const token = note.newToken();
    localStorage.setItem('memo.current', token);
    const opened = await openNote(token, {
      allowCreate: true,
      fresh: true,
      replace: true,
    });
    if (innerWidth < 800) sidebar.value = false;
    return opened;
  } finally {
    busy.value = false;
  }
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
  navigating.value = true;
  try {
    const path = location.pathname;
    if (path === '/' || path === '') {
      // The home route needs the account's last note and list fallback.
      await initialSession;
      if (editor.isDestroyed || location.pathname !== path) return;
      await openNote(topToken(), { allowCreate: true, replace: true });
    } else if (/^\/[A-Za-z0-9_-]{22}$/.test(path) && isNoteToken(path.slice(1)))
      await openNote(path.slice(1), { replace: true });
    else {
      note.state.ready = false;
      note.state.preview = undefined;
      note.state.error = 'メモが見つかりません';
    }
  } finally {
    navigating.value = false;
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
  if (signedIn.value && !busy.value && document.visibilityState === 'visible')
    void refreshList().catch(() => {});
}, 15000);
async function loadInitialSession() {
  try {
    await session();
  } catch {
    if (listState.value !== 'failed')
      message.value = '接続を確認してください。';
  } finally {
    starting.value = false;
  }
  if (editor.isDestroyed) return;
  if (!signedIn.value && localStorage.getItem('memo.sidebar') === null)
    sidebar.value = false;
}
onMounted(async () => {
  window.addEventListener('keydown', keyboard);
  window.addEventListener('popstate', route);
  initialSession = loadInitialSession();
  await route();
  if (!editor.isDestroyed && innerWidth >= 800 && note.state.ready)
    await focusEditor();
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
    <div v-if="dragging" class="file-drop-overlay" role="status">
      ドロップして新しいメモを作成
    </div>
    <button
      v-if="sidebar"
      class="drawer-backdrop"
      aria-label="リストを閉じる"
      @click="sidebar = false"
    ></button>
    <NoteList
      v-show="sidebar"
      :key="accountId"
      :items="visibleItems"
      :selected="note.state.token"
      :signed-in="signedIn"
      :loading="starting || (signedIn && listState === 'loading')"
      :load-failed="listState === 'failed'"
      :busy="busy || documentLoading"
      :moving="moving"
      :creating="creating"
      :move-error="moveError"
      @select="select"
      @move="moveNote"
      @retry="retryList"
      @create="create"
      @account="accountDialog?.open()"
      @search-query="searchQuery = $event"
      @close="toggleList"
    />
    <div class="writing-area">
      <header class="app-header">
        <div class="header-left">
          <button
            class="quiet list-toggle"
            aria-label="メモリスト"
            title="メモリスト（Ctrl/⌘＋\）"
            :aria-expanded="sidebar"
            @click="toggleList"
          >
            <MaterialIcon name="menu" /></button
          ><span class="save-state" role="status">{{ saveLabel }}</span>
        </div>
        <div class="header-right">
          <button
            v-if="signedIn && (note.state.ready || documentLoading)"
            class="list-membership"
            :disabled="busy || documentLoading || listState !== 'ready'"
            @click="
              inList ? removeNoteDialog?.open(note.state.token, title) : add()
            "
          >
            {{
              adding ? '追加中…' : inList ? 'リストから削除' : 'リストに追加'
            }}</button><button
            class="header-icon-button"
            aria-label="共有"
            title="共有"
            :disabled="busy || !documentReady || note.state.composing"
            @click="share"
          >
            <span v-if="sharing" class="spinner" aria-hidden="true"></span>
            <MaterialIcon v-else name="iosShare" /></button
          ><button
            class="account-button header-icon-button"
            aria-label="アカウント"
            :title="signedIn ? 'アカウント' : 'ログイン'"
            :disabled="starting || busy"
            @click="accountDialog?.open()"
          >
            <MaterialIcon name="passkey" />
          </button>
        </div>
      </header>
      <div v-if="message" class="notice" role="status">
        <span>{{ message }}</span><button
          class="quiet"
          aria-label="通知を閉じる"
          @click="message = ''"
        >
          <MaterialIcon name="close" />
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
          <MaterialIcon name="close" />
        </button>
      </div>
      <main class="document-scroll" :aria-label="title">
        <div
          v-if="documentLoading && showDocumentSkeleton && !previewing"
          class="memo-document document-loading"
        >
          <div class="document-skeleton" aria-hidden="true">
            <span class="skeleton-line"></span>
            <span class="skeleton-line"></span>
            <span class="skeleton-line"></span>
          </div>
          <p
            v-if="showDocumentLoadingMessage"
            class="document-loading-status"
            role="status"
          >
            メモを読み込み中…
          </p>
        </div>
        <EditorContent
          v-show="showEditor"
          :inert="documentLoading && !previewing"
          :editor="editor"
          class="memo-document"
          @pointerdown="placeCaretFromPadding"
        />
        <div
          v-if="
            !documentLoading &&
            !note.state.ready &&
            note.state.error &&
            !previewing
          "
          class="document-error"
        >
          <p role="alert">{{ note.state.error }}</p>
          <button class="quiet" @click="route">再読み込み</button>
        </div>
      </main>
      <div v-if="previewing" class="notice document-preview-notice">
        <span role="status">
          {{
            !documentLoading && note.state.error
              ? '最新版を取得できません。前回取得した内容を表示しています。'
              : '前回取得した内容を表示中。最新版を確認しています…'
          }}
        </span>
        <button
          v-if="!documentLoading && note.state.error"
          class="quiet"
          @click="route"
        >
          再読み込み
        </button>
      </div>
    </div>
    <EditorOverlays
      :editor="editor"
      :composing="note.state.composing || previewing"
    />
    <AccountDialog
      ref="accountDialog"
      :signed-in="signedIn"
      @authenticated="authenticated"
      @closed="note.state.ready && editor.view.focus()"
      :sign-out="logout"
    />
    <RemoveNoteDialog
      ref="removeNoteDialog"
      :remove="remove"
      @closed="note.state.ready && editor.view.focus()"
    />
    <ShareDialog
      ref="shareDialog"
      :token="note.state.token"
      @closed="note.state.ready && editor.view.focus()"
    />
  </div>
</template>
