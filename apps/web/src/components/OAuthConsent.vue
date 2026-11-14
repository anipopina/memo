<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue';
import { api } from '../api';
import AccountDialog from './AccountDialog.vue';
interface RequestInfo {
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
}
const info = shallowRef<RequestInfo>(),
  signedIn = shallowRef(false);
const busy = shallowRef(true),
  error = shallowRef('');
const dialog =
  useTemplateRef<InstanceType<typeof AccountDialog>>('accountDialog');
const request = new URLSearchParams(location.search).get('request') ?? '';
async function session() {
  signedIn.value = (await api<{ signedIn: boolean }>('/session')).signedIn;
}
async function authenticated() {
  try {
    await session();
  } catch {
    error.value = 'ログイン状態を確認できませんでした。';
  }
}
async function decide(allow: boolean) {
  busy.value = true;
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
    busy.value = false;
  }
}
onMounted(async () => {
  try {
    info.value = await api<RequestInfo>(
      `/oauth/request/${encodeURIComponent(request)}`,
    );
    await session();
  } catch {
    error.value =
      '連携リクエストが無効か期限切れです。AIクライアントから接続をやり直してください。';
  } finally {
    busy.value = false;
  }
});
</script>
<template>
  <main class="oauth-consent">
    <h1>AI連携の確認</h1>
    <template v-if="info">
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
      </ul>
      <p class="hint">
        連携はアカウント画面から解除できます。解除しても取得済みの本文や秘密URLは無効になりません。
      </p>
      <p v-if="!signedIn">メモのアカウントにPasskeyでログインしてください。</p>
      <button
        v-if="!signedIn"
        class="primary wide"
        :disabled="busy"
        @click="dialog?.open()"
      >
        Passkeyでログイン
      </button>
      <template v-else>
        <button class="primary wide" :disabled="busy" @click="decide(true)">
          連携を許可
        </button>
        <button class="quiet wide" :disabled="busy" @click="decide(false)">
          キャンセル
        </button>
      </template>
    </template>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
    <AccountDialog
      ref="accountDialog"
      :signed-in="false"
      :sign-out="async () => false"
      @authenticated="authenticated"
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
