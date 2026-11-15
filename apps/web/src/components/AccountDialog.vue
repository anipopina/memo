<script setup lang="ts">
import MaterialIcon from './MaterialIcon.vue';
import OAuthConnections from './OAuthConnections.vue';
import { computed, onBeforeUnmount, shallowRef, useTemplateRef } from 'vue';
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api, ApiError } from '../api';
interface Passkey {
  id: string;
  name: string;
  createdAt: number;
}
const { signedIn, signOut } = defineProps<{
  signedIn: boolean;
  signOut: () => Promise<boolean>;
}>();
const emit = defineEmits<{ authenticated: []; closed: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const opened = shallowRef(false);
const loading = shallowRef(false);
const loadFailed = shallowRef(false);
const action = shallowRef<'register' | 'login' | 'revoke' | 'logout'>();
const busy = computed(() => !!action.value);
const name = shallowRef(''),
  error = shallowRef(''),
  added = shallowRef(false);
const credentials = shallowRef<Passkey[]>([]),
  confirming = shallowRef<string | null>(null);
async function refresh() {
  credentials.value = await api<Passkey[]>('/auth/credentials');
  loadFailed.value = false;
}
let request: AbortController | undefined;
async function loadCredentials() {
  request?.abort();
  const controller = new AbortController();
  request = controller;
  loading.value = true;
  loadFailed.value = false;
  try {
    const next = await api<Passkey[]>(
      '/auth/credentials',
      undefined,
      'GET',
      controller.signal,
    );
    if (request === controller) credentials.value = next;
  } catch {
    if (request === controller) loadFailed.value = true;
  } finally {
    if (request === controller) {
      request = undefined;
      loading.value = false;
    }
  }
}
function stopLoading() {
  request?.abort();
  request = undefined;
  loading.value = false;
}
function closed() {
  if (dialog.value?.open) return;
  stopLoading();
  opened.value = false;
  emit('closed');
}
onBeforeUnmount(stopLoading);
function open() {
  if (!dialog.value || dialog.value.open) return;
  error.value = '';
  added.value = false;
  name.value = '';
  confirming.value = null;
  credentials.value = [];
  opened.value = true;
  if (signedIn) void loadCredentials();
  dialog.value.showModal();
}
async function authenticate(kind: 'register' | 'login') {
  if (kind === 'register' && !name.value.trim()) {
    error.value = 'Passkeyの名前を入力してください。';
    return;
  }
  action.value = kind;
  error.value = '';
  added.value = false;
  try {
    const result = await api<{
      challengeId: string;
      options:
        | PublicKeyCredentialCreationOptionsJSON
        | PublicKeyCredentialRequestOptionsJSON;
    }>('/auth/begin', { kind, name: name.value.trim() });
    const response =
      kind === 'register'
        ? await startRegistration({
            optionsJSON:
              result.options as PublicKeyCredentialCreationOptionsJSON,
          })
        : await startAuthentication({
            optionsJSON:
              result.options as PublicKeyCredentialRequestOptionsJSON,
          });
    await api('/auth/finish', { challengeId: result.challengeId, response });
    name.value = '';
    if (signedIn) {
      await refresh();
      added.value = true;
    } else {
      dialog.value?.close();
      emit('authenticated');
    }
  } catch {
    error.value = 'Passkeyで完了できませんでした。もう一度試してください。';
  } finally {
    action.value = undefined;
  }
}
async function revoke(id: string) {
  action.value = 'revoke';
  error.value = '';
  try {
    await api(
      `/auth/credentials/${encodeURIComponent(id)}`,
      undefined,
      'DELETE',
    );
    confirming.value = null;
    await refresh();
  } catch (cause) {
    error.value =
      cause instanceof ApiError && cause.code === 'last_passkey'
        ? '最後のPasskeyは無効化できません。'
        : '無効化できませんでした。一覧を開き直して確認してください。';
  } finally {
    action.value = undefined;
  }
}
async function logout() {
  action.value = 'logout';
  error.value = '';
  try {
    if (await signOut()) dialog.value?.close();
    else
      error.value =
        'ログアウトできませんでした。保存と接続を確認してください。';
  } catch {
    error.value = 'ログアウトできませんでした。';
  } finally {
    action.value = undefined;
  }
}
const formatDate = (time: number) =>
  new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(time);
defineExpose({ open });
</script>
<template>
  <dialog
    ref="dialog"
    class="account-dialog"
    aria-labelledby="account-title"
    @close="closed"
    @cancel="busy && $event.preventDefault()"
  >
    <div class="dialog-heading">
      <h2 id="account-title">{{ signedIn ? 'アカウント' : 'Passkey' }}</h2>
      <button
        class="quiet"
        aria-label="閉じる"
        :disabled="busy"
        @click="dialog?.close()"
      >
        <MaterialIcon name="close" />
      </button>
    </div>
    <template v-if="!signedIn">
      <button
        class="primary wide"
        :disabled="busy"
        @click="authenticate('login')"
      >
        <span
          v-if="action === 'login'"
          class="spinner"
          aria-hidden="true"
        ></span>
        {{ action === 'login' ? 'ログイン中…' : 'ログイン' }}
      </button>
      <div class="dialog-divider"></div>
    </template>
    <template v-else>
      <h3 id="passkey-list-title" class="passkey-title">
        このアカウントのPasskey
      </h3>
      <ul class="passkeys" aria-labelledby="passkey-list-title">
        <li v-if="loading" class="passkey-row">
          <span class="progress" role="status">
            <span class="spinner" aria-hidden="true"></span>
            Passkeyを読み込み中…
          </span>
        </li>
        <li v-else-if="loadFailed" class="passkey-row">
          <span class="error" role="alert"
            >Passkeyの一覧を取得できませんでした。</span
          >
          <button class="quiet" :disabled="busy" @click="loadCredentials">
            再読み込み
          </button>
        </li>
        <li v-for="credential in credentials" :key="credential.id">
          <div class="passkey-row">
            <div>
              <span>{{ credential.name }}</span><time
                :datetime="new Date(credential.createdAt).toISOString()"
                >{{ formatDate(credential.createdAt) }}</time
              >
            </div>
            <button
              v-if="credentials.length > 1"
              class="quiet icon-button danger"
              aria-label="無効化"
              title="無効化"
              :disabled="busy"
              @click="confirming = credential.id"
            >
              <MaterialIcon name="delete" />
            </button>
          </div>
          <div v-if="confirming === credential.id" class="revoke-confirm">
            <p class="hint">このPasskeyでログインできなくなります。</p>
            <button
              class="danger"
              :disabled="busy"
              @click="revoke(credential.id)"
            >
              <span
                v-if="action === 'revoke'"
                class="spinner"
                aria-hidden="true"
              ></span>
              {{ action === 'revoke' ? '無効化中…' : '無効化する' }}</button
            ><button class="quiet" :disabled="busy" @click="confirming = null">
              やめる
            </button>
          </div>
        </li>
      </ul>
      <div class="dialog-divider"></div>
    </template>
    <form @submit.prevent="authenticate('register')">
      <label
        >Passkeyの名前<input
          v-model="name"
          placeholder="例: 1Password, Google, ..."
          maxlength="80"
          autocomplete="off"
          required
          :disabled="busy || loading"
      /></label>
      <button
        class="wide"
        :disabled="busy || loading || !name.trim()"
        type="submit"
      >
        <span
          v-if="action === 'register'"
          class="spinner"
          aria-hidden="true"
        ></span>
        {{
          action === 'register'
            ? 'Passkeyを処理中…'
            : signedIn
              ? 'Passkeyを追加'
              : 'アカウントを作る'
        }}
      </button>
    </form>
    <template v-if="signedIn">
      <p v-if="added" role="status">Passkeyを追加しました。</p>
      <OAuthConnections v-if="opened" />
      <div class="account-session">
        <button class="danger wide" :disabled="busy || loading" @click="logout">
          <span
            v-if="action === 'logout'"
            class="spinner"
            aria-hidden="true"
          ></span>
          {{ action === 'logout' ? 'ログアウト中…' : 'ログアウト' }}
        </button>
      </div>
    </template>
    <p v-else class="hint">ログインするとメモリストを端末間で共有できます。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </dialog>
</template>
<style scoped>
.account-dialog {
  margin-block: 16px auto;
}
.account-session {
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.account-session .wide {
  margin-top: 0;
}
.passkey-title {
  font-size: 14px;
  font-weight: 500;
  margin: 16px 0 4px;
}
.passkeys {
  list-style: none;
  padding: 0;
  margin: 0;
  max-height: 34dvh;
  min-height: 64px;
  overflow: auto;
}
.passkeys li + li {
  border-top: 1px solid var(--line);
}
.passkey-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 64px;
  font-size: 14px;
}
.passkey-row time {
  display: block;
  color: var(--muted);
  font-size: 12px;
  margin-top: 4px;
}
.passkey-row span {
  overflow-wrap: anywhere;
}
.revoke-confirm {
  padding-bottom: 12px;
}
</style>
