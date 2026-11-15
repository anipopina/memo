<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { api } from '../api';
interface Connection {
  id: string;
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
  expiresAt: number;
}
const connections = shallowRef<Connection[]>([]);
const loading = shallowRef(true),
  revoking = shallowRef(''),
  loadFailed = shallowRef(false),
  error = shallowRef(''),
  copied = shallowRef(false);
const url = `${location.origin}/mcp/account`;
const lifetime = new AbortController();
async function refresh() {
  if (lifetime.signal.aborted) return;
  loading.value = true;
  loadFailed.value = false;
  try {
    connections.value = await api<Connection[]>(
      '/oauth/connections',
      undefined,
      'GET',
      lifetime.signal,
    );
  } catch {
    if (!lifetime.signal.aborted) loadFailed.value = true;
  } finally {
    loading.value = false;
  }
}
async function revoke(id: string) {
  revoking.value = id;
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
    revoking.value = '';
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
onBeforeUnmount(() => lifetime.abort());
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
    <div class="connection-results">
      <p v-if="loading && !revoking" class="hint progress" role="status">
        <span class="spinner" aria-hidden="true"></span> AI連携を読み込み中…
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
                      : s === 'memo:reorder'
                        ? '並び替え'
                        : '編集',
                )
                .join(' / ')
            }}
          </p>
          <p class="hint">
            有効期限:
            {{ new Date(connection.expiresAt).toLocaleDateString('ja-JP') }}
          </p>
          <button
            class="danger"
            :disabled="!!revoking || loading"
            @click="revoke(connection.id)"
          >
            <span
              v-if="revoking === connection.id"
              class="spinner"
              aria-hidden="true"
            ></span>
            {{ revoking === connection.id ? '解除中…' : '連携を解除' }}
          </button>
        </li>
      </ul>
      <p v-else-if="!loading && !loadFailed" class="hint">
        連携中のAIクライアントはありません。
      </p>
      <template v-if="loadFailed">
        <p role="alert" class="error">AI連携を取得できませんでした。</p>
        <button class="quiet" @click="refresh">再読み込み</button>
      </template>
    </div>
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
.connection-results {
  min-block-size: 3rem;
  display: flow-root;
}
.connections li {
  border-top: 1px solid var(--line);
  padding: 12px 0;
  overflow-wrap: anywhere;
}
</style>
