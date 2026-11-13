# memo

ブラウザですぐ書き始め、人間とAIが秘密URLで同じMarkdown本文を扱うメモ帳。
入力・メモの切り替えを中心にしたVueアプリと、Web/MCP共通の保存APIを実装しています。
公開先：[memo.anipopina.com](https://memo.anipopina.com/)。本体はAWS東京リージョンへデプロイ済みです。

## 起動

Node.js 24と、[package.json](package.json) に固定したpnpmを使用します。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

PCでは `http://localhost:5173/` を開いてください。Passkeyのローカル検証にもlocalhostを使います。
本体のWeb画面とAPIがまとめて起動し、入力はローカルのSQLiteへ保存されます。
起動中の旧検証サーバーがある場合は、停止してから再起動してください。

ローカルデータと暗号鍵は `.memo/` に作成します。このディレクトリはGit管理しません。
保存内容を保つ場合は、サーバー停止中にディレクトリ全体を保管してください。
ローカルと本番のデータ・Passkeyは別のものです。

Tailscale ServeのHTTPS転送先を `http://127.0.0.1:5173` にすると、
iPhoneから `https://gtune2023.tail4432be.ts.net/` で利用できます。このホストは許可済みです。
HTTPSとWebSocketの転送はTailscale Serve側で行います。

従来の検証画面は `pnpm dev:spike`、MCP単体のメモリストア検証は `pnpm dev:mcp` で起動できます。
これらの検証用サーバーは永続化・公開用の構成ではありません。

## 品質確認

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
pnpm test:app
pnpm test:browser
```

ブラウザが未導入の場合は `pnpm exec playwright install chromium webkit` を実行します。
LinuxのOSライブラリが不足する場合は `pnpm exec playwright install-deps chromium webkit` が必要です。
MCP統合テストとブラウザテストにはlocalhostでの待受権限が必要です。

AWS構成の生成・確認は [運用と公開準備](docs/operations.md) を参照してください。
共有スキルは `python3 tools/restore-skills.py` で同梱アーカイブから復元できます。
環境管理の `.agents/` が読み取り専用なら、復元先を引数で指定してください。

## 資料

- [機能仕様 v0.2](docs/spec-v0.2.md)：元の仕様。`tmp/` の原本も保持
- [設計と決定事項](docs/design.md)：合意した構成・操作・競合処理
- [検証記録](docs/validation.md)：確認結果と未確認事項
- [運用と公開準備](docs/operations.md)：ローカルデータ、AWS構成、公開前の確認
- [開発ルール](AGENTS.md)、[スキル管理](skills.md)

コミット・AWSリソース作成・本番公開はユーザーの明示的な依頼後に行います。
