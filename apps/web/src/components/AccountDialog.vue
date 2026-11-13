<script setup lang="ts">
import { shallowRef, useTemplateRef } from 'vue';
import {
  startRegistration,
  startAuthentication,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { api } from '../api';
const { signedIn } = defineProps<{ signedIn: boolean }>();
const emit = defineEmits<{ authenticated: []; logout: []; closed: [] }>();
const dialog = useTemplateRef<HTMLDialogElement>('dialog');
const name = shallowRef(''),
  busy = shallowRef(false),
  error = shallowRef(''),
  added = shallowRef(false);
function open() {
  error.value = '';
  added.value = false;
  dialog.value?.showModal();
}
async function authenticate(kind: 'register' | 'login') {
  busy.value = true;
  error.value = '';
  try {
    const result = await api<{
      challengeId: string;
      options:
        | PublicKeyCredentialCreationOptionsJSON
        | PublicKeyCredentialRequestOptionsJSON;
    }>('/auth/begin', { kind, name: name.value });
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
    if (signedIn) {
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
async function logout() {
  busy.value = true;
  try {
    await api('/auth/logout', {});
    dialog.value?.close();
    emit('logout');
  } catch {
    error.value = 'ログアウトできませんでした。';
  } finally {
    busy.value = false;
  }
}
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
        ×
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
      <form @submit.prevent="authenticate('register')">
        <label
          >Passkeyの名前<input
            v-model="name"
            placeholder="memo"
            maxlength="80"
            autocomplete="nickname"
            :disabled="busy"
        /></label>
        <button class="wide" :disabled="busy" type="submit">
          アカウントを作る
        </button>
      </form>
      <p class="hint">ログインするとメモ一覧を端末間で共有できます。</p>
    </template>
    <template v-else>
      <button class="wide" :disabled="busy" @click="authenticate('register')">
        Passkeyを追加
      </button>
      <p class="hint">
        すべてのPasskeyを失うと、一覧を復旧できません。メモはURLから引き続き開けます。
      </p>
      <p v-if="added" role="status">Passkeyを追加しました。</p>
      <button class="quiet wide" :disabled="busy" @click="logout">
        ログアウト
      </button>
    </template>
    <p v-if="busy" role="status" class="hint">確認中…</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </dialog>
</template>
