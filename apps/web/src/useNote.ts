import { reactive, onBeforeUnmount } from 'vue';
import { api, ApiError, newToken, type RemoteNote } from './api';
import { drafts, recovery, releaseAdoptedDraft, type Draft } from './drafts';
import { notePreviews, previewEpoch, PREVIEW_EPOCH_KEY } from './notePreviews';
import { mergeMarkdown } from '../../../packages/core/src/merge';
import { assertNoteSize } from '../../../packages/core/src/note';

export const SYNC = { idle: 650, continuous: 5000, poll: 3000, maxAttempts: 3 };
export function useNote(apply: (text: string, reset: boolean) => void) {
  const state = reactive({
    token: '',
    content: '',
    base: '',
    version: 0,
    persisted: false,
    ready: false,
    loading: false,
    preview: undefined as RemoteNote | undefined,
    saving: false,
    error: '',
    localError: false,
    adjusted: false,
    recovery: '',
    composing: false,
  });
  let generation = 0,
    disposed = false,
    opening = false;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<boolean> | undefined;
  let draftWork = Promise.resolve();
  const tabId = sessionStorage.getItem('memo.tab') ?? crypto.randomUUID();
  sessionStorage.setItem('memo.tab', tabId);
  const dirty = () =>
    state.content !== state.base ||
    (!state.persisted && state.content.length > 0);
  function protect(): Promise<void> {
    const draft: Draft = {
      key: `${tabId}:${state.token}`,
      token: state.token,
      base: state.base,
      version: state.version,
      content: state.content,
      persisted: state.persisted,
      updatedAt: Date.now(),
    };
    const keep = dirty() || !state.persisted;
    draftWork = draftWork
      .catch(() => {})
      .then(async () => {
        try {
          if (keep) await drafts.put(draft);
          else await drafts.remove(draft.key);
          state.localError = false;
        } catch {
          state.localError = true;
        }
      });
    return draftWork;
  }
  function install(text: string, reset = false) {
    state.content = text;
    apply(text, reset);
  }
  function discardPreview() {
    state.preview = undefined;
  }
  function reconcile(remote: RemoteNote, render = true) {
    const result = mergeMarkdown(state.base, state.content, remote.content);
    if (result.adjusted) {
      state.recovery = state.content;
      state.adjusted = true;
      void recovery.put(state.token, state.content).catch(() => {
        state.localError = true;
      });
    }
    state.base = remote.content;
    state.version = remote.version;
    state.persisted = true;
    if (render && result.content !== state.content) install(result.content);
    else state.content = result.content;
  }
  async function prepareLeave(): Promise<boolean> {
    if (!state.ready) return true;
    if (state.composing) return false;
    await flush();
    await protect();
    return !dirty() || !state.localError;
  }
  async function open(
    token: string,
    {
      allowCreate = false,
      fresh = false,
      activate,
    }: { allowCreate?: boolean; fresh?: boolean; activate?: () => void } = {},
  ): Promise<boolean> {
    if (opening || disposed) return false;
    opening = true;
    try {
      if (!(await prepareLeave())) return false;
      clearTimeout(idle);
      const epoch = ++generation;
      const cacheEpoch = previewEpoch();
      state.ready = false;
      state.loading = true;
      discardPreview();
      state.error = '';
      state.adjusted = false;
      state.recovery = '';
      const previousToken = state.token;
      state.token = token;
      activate?.();
      state.content = '';
      state.base = '';
      state.version = 0;
      state.persisted = false;
      let waitingForRemote = !fresh;
      const preview = fresh
        ? Promise.resolve()
        : notePreviews
            .get(token, cacheEpoch)
            .then((entry) => {
              if (
                !entry ||
                !waitingForRemote ||
                epoch !== generation ||
                cacheEpoch !== previewEpoch()
              )
                return;
              state.preview = entry;
              apply(entry.content, true);
            })
            .catch(() => {});
      let stored: Draft | undefined;
      try {
        const candidates = (await drafts.all())
          .filter((item) => item.token === token)
          .sort((a, b) => b.updatedAt - a.updatedAt);
        stored =
          candidates.find((item) => item.key === `${tabId}:${token}`) ??
          candidates[0];
      } catch {
        state.localError = true;
      }
      try {
        if (fresh) {
          /* A new random capability can be reserved without a server record. */
        } else {
          const remote = await api<RemoteNote>(`/notes/${token}`);
          waitingForRemote = false;
          if (epoch !== generation) return false;
          void notePreviews.put(token, remote, cacheEpoch).catch(() => {});
          state.base = stored?.base ?? remote.content;
          state.content = stored?.content ?? remote.content;
          reconcile(remote, false);
        }
      } catch (error) {
        if (epoch !== generation) return false;
        const unavailable =
          error instanceof ApiError && [401, 403, 404].includes(error.status);
        if (unavailable) {
          waitingForRemote = false;
          discardPreview();
          void notePreviews.remove(token, cacheEpoch).catch(() => {});
        }
        if (stored) {
          state.base = stored.base;
          state.content = stored.content;
          state.version = stored.version;
          state.persisted = stored.persisted;
          state.error =
            error instanceof ApiError &&
            error.status === 404 &&
            !stored.persisted
              ? ''
              : '通信待ち';
        } else if (
          error instanceof ApiError &&
          error.status === 404 &&
          allowCreate
        ) {
          /* locally reserved empty note */
        } else {
          if (!unavailable) await preview;
          if (epoch !== generation) return false;
          state.error =
            error instanceof ApiError && error.status === 404
              ? 'メモが見つかりません'
              : 'メモを読み込めません';
          state.token = token;
          state.loading = false;
          return false;
        }
      }
      waitingForRemote = false;
      state.loading = false;
      state.ready = true;
      if (state.preview?.content !== state.content) apply(state.content, true);
      if (previousToken !== token) state.composing = false;
      await protect();
      if (stored && stored.key !== `${tabId}:${token}` && !state.localError)
        await releaseAdoptedDraft(stored).catch(() => {});
      try {
        const previous = await recovery.get();
        if (previous?.token === token) {
          state.recovery = previous.content;
          state.adjusted = true;
        }
      } catch {
        /* Input remains usable when local storage is unavailable. */
      }
      if (dirty()) schedule();
      return true;
    } finally {
      opening = false;
      state.loading = false;
      if (state.ready) discardPreview();
    }
  }
  function schedule() {
    clearTimeout(idle);
    idle = setTimeout(() => {
      void flush();
    }, SYNC.idle);
  }
  function edit(content: string) {
    if (!state.ready) return;
    state.content = content;
    void protect();
    schedule();
  }
  async function save(force = false): Promise<boolean> {
    if (!state.ready || state.composing || disposed) return false;
    if (!dirty() && (!force || state.persisted)) return true;
    const epoch = generation,
      token = state.token,
      cacheEpoch = previewEpoch();
    state.saving = true;
    state.error = '';
    try {
      for (let attempt = 0; attempt < SYNC.maxAttempts; attempt++) {
        assertNoteSize(state.content);
        const sent = state.content,
          base = state.base,
          version = state.version;
        try {
          const remote = state.persisted
            ? {
                content: sent,
                ...(await api<{ version: number }>(`/notes/${token}`, {
                  content: sent,
                  expectedVersion: version,
                  operationId: crypto.randomUUID(),
                })),
              }
            : await api<RemoteNote>(
                `/notes/${token}`,
                { content: sent },
                'PUT',
              );
          if (epoch !== generation) return false;
          void notePreviews.put(token, remote, cacheEpoch).catch(() => {});
          // Inputs arriving during a request are rebased on its acknowledged snapshot.
          const current = mergeMarkdown(sent, state.content, remote.content);
          state.base = remote.content;
          state.version = remote.version;
          state.persisted = true;
          if (current.content !== state.content) install(current.content);
          await protect();
          if (dirty()) schedule();
          return true;
        } catch (error) {
          if (error instanceof ApiError && error.status === 409) {
            const remote = await api<RemoteNote>(`/notes/${token}`);
            if (epoch !== generation) return false;
            state.base = base;
            reconcile(remote);
            continue;
          }
          throw error;
        }
      }
      throw new Error('busy');
    } catch (error) {
      if (epoch === generation)
        state.error =
          error instanceof Error && error.message === 'note_too_large'
            ? '本文が長すぎます'
            : error instanceof ApiError && error.status === 429
              ? '保存を待機中'
              : '通信待ち';
      await protect();
      return false;
    } finally {
      if (epoch === generation) state.saving = false;
    }
  }
  async function flush(force = false): Promise<boolean> {
    if (pending) {
      const succeeded = await pending;
      // Background timers share the in-flight request instead of queuing more retries.
      if (succeeded && force && (dirty() || !state.persisted))
        return flush(force);
      return succeeded;
    }
    const task = save(force);
    pending = task;
    try {
      return await task;
    } finally {
      if (pending === task) pending = undefined;
    }
  }
  async function poll() {
    if (
      !state.ready ||
      !state.persisted ||
      state.composing ||
      state.saving ||
      opening ||
      document.visibilityState === 'hidden'
    )
      return;
    const epoch = generation;
    const cacheEpoch = previewEpoch();
    try {
      const remote = await api<{ version: number }>(
        `/notes/${state.token}/version`,
      );
      if (epoch !== generation || state.composing || state.saving || opening)
        return;
      if (remote.version > state.version) {
        const note = await api<RemoteNote>(`/notes/${state.token}`);
        if (epoch !== generation || state.composing || state.saving || opening)
          return;
        if (note.version <= state.version) return;
        void notePreviews.put(state.token, note, cacheEpoch).catch(() => {});
        reconcile(note);
        await protect();
        if (dirty()) schedule();
      }
    } catch {
      /* Autosave reports persistent connection errors when a write is pending. */
    }
  }
  const visibility = () => {
    if (document.visibilityState === 'visible') {
      void poll();
      if (dirty()) void flush();
    }
  };
  const online = () => {
    void flush();
    void poll();
  };
  function onStorage(event: StorageEvent) {
    if (event.key === PREVIEW_EPOCH_KEY || event.key === null) discardPreview();
  }
  async function clearPreviews() {
    discardPreview();
    await notePreviews.clear().catch(() => {});
  }
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('online', online);
  window.addEventListener('storage', onStorage);
  const polling = setInterval(() => {
    void poll();
  }, SYNC.poll);
  const saving = setInterval(() => {
    if (dirty() && document.visibilityState !== 'hidden') void flush();
  }, SYNC.continuous);
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    clearTimeout(idle);
    clearInterval(polling);
    clearInterval(saving);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('online', online);
    window.removeEventListener('storage', onStorage);
  });
  return {
    state,
    open,
    edit,
    flush,
    dirty,
    poll,
    newToken,
    prepareLeave,
    clearPreviews,
  };
}
