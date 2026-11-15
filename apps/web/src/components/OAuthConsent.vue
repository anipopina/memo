<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue';
import { api, ApiError } from '../api';
import AccountDialog from './AccountDialog.vue';
interface RequestInfo {
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
}
const info = shallowRef<RequestInfo>(),
  signedIn = shallowRef(false);
const checking = shallowRef(true),
  deciding = shallowRef<'allow' | 'deny'>(),
  retryable = shallowRef(false),
  error = shallowRef('');
const dialog =
  useTemplateRef<InstanceType<typeof AccountDialog>>('accountDialog');
const request = new URLSearchParams(location.search).get('request') ?? '';
async function load() {
  checking.value = true;
  info.value = undefined;
  retryable.value = false;
  error.value = '';
  try {
    const [details, session] = await Promise.all([
      api<RequestInfo>(`/oauth/request/${encodeURIComponent(request)}`),
      api<{ signedIn: boolean }>('/session'),
    ]);
    info.value = details;
    signedIn.value = session.signedIn;
  } catch (cause) {
    const invalid =
      !request ||
      (cause instanceof ApiError &&
        ['invalid_request', 'invalid_client'].includes(cause.code));
    error.value = invalid
      ? '連携リクエストが無効か期限切れです。AIクライアントから接続をやり直してください。'
      : '連携情報を確認できませんでした。';
    retryable.value = !invalid;
  } finally {
    checking.value = false;
  }
}
async function decide(allow: boolean) {
  if (deciding.value) return;
  deciding.value = allow ? 'allow' : 'deny';
  error.value = '';
  try {
    const result = await api<{ redirect: string }>('/oauth/decision', {
      request,
      allow,
    });
    location.assign(result.redirect);
  } catch {
    error.value =
      '連携を完了できませんでした。AIクライアントから接続をやり直してください。';
    deciding.value = undefined;
  }
}
onMounted(load);
</script>
<template>
  <main class="oauth-consent">
    <h1>AI連携の確認</h1>
    <p v-if="checking" class="progress" role="status">
      <span class="spinner" aria-hidden="true"></span> 連携情報を確認中…
    </p>
    <template v-else-if="info">
      <p>
        <strong>{{ info.clientName }}</strong>
        がメモへのアクセスを要求しています。
      </p>
      <p class="hint">
        接続先:
        {{ info.redirectOrigin }}（クライアントが登録した名前と接続先です）
      </p>
      <p>対象は、このアカウントのメモリストです。</p>
      <ul>
        <li v-if="info.scopes.includes('memo:read')">
          メモの一覧・検索・本文の取得
        </li>
        <li v-if="info.scopes.includes('memo:create')">
          新しいメモの作成とリストへの追加
        </li>
        <li v-if="info.scopes.includes('memo:write')">メモ本文の編集・追記</li>
        <li v-if="info.scopes.includes('memo:reorder')">
          メモリストの並び替え
        </li>
      </ul>
      <p class="hint">
        連携はアカウント画面から解除できます。解除しても取得済みの本文や秘密URLは無効になりません。
      </p>
      <p v-if="!signedIn">メモのアカウントにPasskeyでログインしてください。</p>
      <button v-if="!signedIn" class="primary wide" @click="dialog?.open()">
        Passkeyでログイン
      </button>
      <template v-else>
        <button
          class="primary wide"
          :disabled="!!deciding"
          @click="decide(true)"
        >
          <span
            v-if="deciding === 'allow'"
            class="spinner"
            aria-hidden="true"
          ></span>
          {{ deciding === 'allow' ? '連携中…' : '連携を許可' }}
        </button>
        <button
          class="quiet wide"
          :disabled="!!deciding"
          @click="decide(false)"
        >
          <span
            v-if="deciding === 'deny'"
            class="spinner"
            aria-hidden="true"
          ></span>
          {{ deciding === 'deny' ? 'キャンセル中…' : 'キャンセル' }}
        </button>
      </template>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <button v-if="retryable" class="quiet" @click="load">再読み込み</button>
    <AccountDialog
      ref="accountDialog"
      :signed-in="false"
      :sign-out="async () => false"
      @authenticated="load"
    />
  </main>
</template>
<style scoped>
.oauth-consent {
  max-width: 560px;
  margin: 48px auto;
  padding: 24px;
  overflow-wrap: anywhere;
}
h1 {
  font-size: 22px;
}
li {
  margin: 12px 0;
}
</style>
