<script setup lang="ts">
import MaterialIcon from './MaterialIcon.vue';
import { shallowRef, useTemplateRef } from 'vue';
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
const name = shallowRef(''),
  busy = shallowRef(false),
  error = shallowRef(''),
  added = shallowRef(false);
const credentials = shallowRef<Passkey[]>([]),
  confirming = shallowRef<string | null>(null);
async function refresh() {
  credentials.value = await api<Passkey[]>('/auth/credentials');
}
function open() {
  error.value = '';
  added.value = false;
  name.value = '';
  confirming.value = null;
  credentials.value = [];
  dialog.value?.showModal();
  if (signedIn) {
    busy.value = true;
    void refresh()
      .catch(() => {
        error.value = 'Passkeyの一覧を取得できませんでした。';
      })
      .finally(() => {
        busy.value = false;
      });
  }
}
async function authenticate(kind: 'register' | 'login') {
  if (kind === 'register' && !name.value.trim()) {
    error.value = 'Passkeyの名前を入力してください。';
    return;
  }
  busy.value = true;
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
    busy.value = false;
  }
}
async function revoke(id: string) {
  busy.value = true;
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
    busy.value = false;
  }
}
async function logout() {
  busy.value = true;
  error.value = '';
  try {
    if (await signOut()) dialog.value?.close();
    else
      error.value =
        'ログアウトできませんでした。保存と接続を確認してください。';
  } catch {
    error.value = 'ログアウトできませんでした。';
  } finally {
    busy.value = false;
  }
}
const formatDate = (time: number) =>
  new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium' }).format(time);
defineExpose({ open });
</script>
<template>
  <dialog
    ref="dialog"
    aria-labelledby="account-title"
    @close="emit('closed')"
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
        ログイン
      </button>
      <div class="dialog-divider"></div>
    </template>
    <template v-else>
      <h3 id="passkey-list-title" class="passkey-title">
        このアカウントのPasskey
      </h3>
      <ul class="passkeys" aria-labelledby="passkey-list-title">
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
              無効化する</button
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
          :disabled="busy"
      /></label>
      <button class="wide" :disabled="busy || !name.trim()" type="submit">
        {{ signedIn ? 'Passkeyを追加' : 'アカウントを作る' }}
      </button>
    </form>
    <template v-if="signedIn">
      <p v-if="added" role="status">Passkeyを追加しました。</p>
      <div class="account-session">
        <button class="danger wide" :disabled="busy" @click="logout">
          ログアウト
        </button>
      </div>
    </template>
    <p v-else class="hint">ログインするとメモリストを端末間で共有できます。</p>
    <p v-if="busy" role="status" class="hint">確認中…</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </dialog>
</template>
<style scoped>
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
