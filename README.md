# memo

ブラウザですぐ書き始め、人間とAIが秘密URLで同じMarkdown本文を扱うメモ帳。
現在は本体実装前の先行検証段階です。アカウント・永続保存・AWS環境はまだありません。

## ローカルで検証する

Node.js 24と、[package.json](package.json) に固定したpnpmを使用します。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

表示されるローカルURLでエディタ、Markdownの往復、差分統合を確認できます。
画面は開発用の検証台で、本体のUIではありません。入力内容は保存されません。

iPhoneからは、Tailscale ServeのHTTPS転送先を `http://127.0.0.1:5173` にすると、
`https://gtune2023.tail4432be.ts.net/` でアクセスできます。このホスト名はViteで許可済みです。
HTTPSとWebSocketの転送はTailscale Serve側で行い、ViteはローカルHTTPで起動します。

MCPの先行検証サーバーは別ターミナルで起動します。

```bash
pnpm dev:mcp
```

ローカル専用の固定サンプルは
`http://127.0.0.1:8787/mcp/AAAAAAAAAAAAAAAAAAAAAA` です。
再起動すると内容は失われます。実データを入れず、外部公開しないでください。
ChatGPTからの接続確認には別途HTTPS環境が必要です。

## 品質確認

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm exec playwright install chromium webkit
pnpm test:browser
```

Linuxでブラウザ用OSライブラリが不足する場合は
`pnpm exec playwright install-deps chromium webkit` を実行します。管理者権限が必要です。
MCP統合テストとブラウザテストにはlocalhostでの待受権限が必要です。

共有スキルを復元する場合は `python3 tools/restore-skills.py` を実行します。
同梱アーカイブのハッシュを検証し、既存の異なるファイルは上書きしません。
管理環境で `.agents` が読み取り専用なら、環境提供の同じ版を利用するか、
`python3 tools/restore-skills.py <復元先>` で書き込み可能な場所へ復元してください。

## 資料

- [機能仕様 v0.2](docs/spec-v0.2.md)：元の仕様。`tmp/` の原本も保持
- [設計と決定事項](docs/design.md)：合意した軽量構成、競合処理、費用・公開境界
- [先行検証の記録](docs/validation.md)：確認結果、未確認事項、本体への移行条件
- [開発ルール](AGENTS.md)、[スキル管理](skills.md)

本番公開・コミットはユーザーが管理します。秘密値をリポジトリへ保存しません。
