<script setup lang="ts">
import { onMounted, shallowRef } from 'vue';
import { api } from '../api';
interface Connection {
  id: string;
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
  expiresAt: number;
}
const connections = shallowRef<Connection[]>([]);
const busy = shallowRef(false),
  error = shallowRef(''),
  copied = shallowRef(false);
const url = `${location.origin}/mcp/account`;
async function refresh() {
  try {
    connections.value = await api<Connection[]>('/oauth/connections');
    error.value = '';
  } catch {
    error.value = 'AI連携を取得できませんでした。';
  }
}
async function revoke(id: string) {
  busy.value = true;
  error.value = '';
  try {
    await api(
      `/oauth/connections/${encodeURIComponent(id)}`,
      undefined,
      'DELETE',
    );
    await refresh();
  } catch {
    error.value = '連携を解除できませんでした。';
  } finally {
    busy.value = false;
  }
}
async function copy() {
  try {
    await navigator.clipboard.writeText(url);
    copied.value = true;
  } catch {
    error.value = 'URLを選択してコピーしてください。';
  }
}
onMounted(refresh);
defineExpose({ refresh });
</script>
<template>
  <section class="oauth-connections" aria-labelledby="oauth-connections-title">
    <h3 id="oauth-connections-title">AI連携</h3>
    <label
      >MCP URL<input
        :value="url"
        readonly
        @focus="($event.target as HTMLInputElement).select()"
    /></label>
    <button class="wide" @click="copy">
      {{ copied ? 'コピーしました' : 'MCP URLをコピー' }}
    </button>
    <p class="hint">
      AIクライアントにこのURLを登録し、OAuthで連携してください。
    </p>
    <ul
      v-if="connections.length"
      class="connections"
      aria-label="連携中のAIクライアント"
    >
      <li v-for="connection in connections" :key="connection.id">
        <p>
          {{ connection.clientName }}<br /><span class="hint">{{
            connection.redirectOrigin
          }}</span>
        </p>
        <p class="hint">
          {{
            connection.scopes
              .map((s) =>
                s === 'memo:read'
                  ? '一覧・検索・本文取得'
                  : s === 'memo:create'
                    ? '新規作成'
                    : '編集',
              )
              .join(' / ')
          }}
        </p>
        <p class="hint">
          有効期限:
          {{ new Date(connection.expiresAt).toLocaleDateString('ja-JP') }}
        </p>
        <button class="danger" :disabled="busy" @click="revoke(connection.id)">
          連携を解除
        </button>
      </li>
    </ul>
    <p v-else class="hint">連携中のAIクライアントはありません。</p>
    <p v-if="error" role="alert" class="error">{{ error }}</p>
  </section>
</template>
<style scoped>
.oauth-connections {
  margin-top: 24px;
  border-top: 1px solid var(--line);
  padding-top: 16px;
}
h3 {
  font-size: 14px;
  font-weight: 500;
}
.connections {
  list-style: none;
  padding: 0;
}
.connections li {
  border-top: 1px solid var(--line);
  padding: 12px 0;
  overflow-wrap: anywhere;
}
</style>
