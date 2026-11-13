# 運用と公開準備

## ローカル

起動方法は [README](../README.md) を参照する。
`tools/dev.ts` がWebとAPIを同時に起動する。SQLiteとリスト用トークンの暗号鍵は
`.memo/` に保存し、APIはループバックだけで待ち受ける。データの移動・保管はサーバーを止めて
ディレクトリ全体を対象にする。鍵だけを失うと、保存したアカウントリストのURLを復元できない。
サーバー再起動でもメモ・アカウント・セッションは維持する。

開発用のOriginはlocalhost、127.0.0.1、既存のTailscaleホストに限定する。
別の開発用HTTPSホストを使う場合は `MEMO_ORIGIN` を設定する。
TailscaleのTLS終端後も、Originなしの読み取り要求は許可済みHostから公開Originへ対応付ける。
開発サーバーの起動スクリプトを変更した場合は、`pnpm dev` の再起動が必要。
Passkeyは登録したホストに結び付くため、localhost/Tailscale/本番ホスト間で共有しない。

ブラウザのローカル記録にはトップ用URL、選択メモ、タブ別の未保存下書きと統合の基準本文を含む。
ブラウザのサイトデータを消すとこれらを失う。サーバーのメモ本体は削除しない。
ログアウトはリストのセッションを終了し、新しい空メモの固有URLへ切り替える。
それまでのメモは閉じるが、知っているURLの権限は失効させない。
Passkeyを無効化しても端末側のPasskeyマネージャからは削除されない。

ローカルDBを初期化した場合は、PC/iPhoneそれぞれで対象Originのサイトデータも削除し、
`/` から開き直す。古いテスト用Passkeyが端末のマネージャに残っていれば、必要に応じてそこで削除する。

## AWS構成の生成

AWSリソースを作らずに、次を確認できる。

```bash
pnpm build
pnpm synth
pnpm exec tsx tools/check-infra.ts
```

`infra/app.ts` にDynamoDB、Lambda、HTTP API、非公開S3、CloudFront、証明書、
既存Route 53ゾーンのレコードを定義している。新しいHosted Zoneは作らない。
`Memo` は東京（ap-northeast-1）にAPI・DB・S3を配置し、
`MemoCertificate` はバージニア北部（us-east-1）にCloudFront用証明書を作る。
プロファイルは `ai-dev`、公開先は `memo.anipopina.com`、既存ゾーンは `anipopina.com`。
初回は証明書スタックを先にデプロイし、その出力 `CertificateArn` を本体スタックの同名パラメーターへ渡す。
両スタックの `HostedZoneId` に既存の公開ゾーンIDを指定する。クロスリージョン参照の補助リソースは追加しない。
本番は空で開始し、ローカルデータや暗号鍵を移行しない。

`pnpm synth` は既存のビルド成果物を使い、CloudFormationと配布用アセットを `cdk.out/` へ出力する。
`VaultKey` はNoEchoパラメーターで参照するだけで、値をコードやテンプレートに保存しない。
暗号鍵を含むファイル・コマンド履歴・CDK出力をGitへ追加しない。

## 公開・更新時に確認すること

- AWSアカウント、CDK bootstrap環境、利用リージョン、既存Hosted Zoneと同名レコードの有無。
- 鍵の安全な受け渡しとオフライン保管。生成・投入時にもAIのログへ値を表示しない。
- `cdk diff` による作成・変更範囲と、CloudFrontの料金プラン・AWS全体の利用状況。
- 実AWS上でのDynamoDB条件付き更新、Cookie、Origin、レート制限、配信ヘッダーの確認。
  初回公開時の実通信結果は [検証記録](validation.md) を参照。
- iPhone実機での保存・日本語IME・追従操作・Passkeyと、ChatGPTからのMCP接続。
  Playwrightの仮想認証器を実機Passkey検証と同一視しない。

このリポジトリの実装依頼だけでは、デプロイ・DNS更新・公開を行わない。
公開作業の依頼後に、具体的な差分と設定を確認して実施する。

## 保持と費用

本文の履歴・自動削除・ユーザー向けバックアップUIは追加していない。
DynamoDB/S3はスタック削除時にも保持し、DynamoDBは削除保護を有効にする。
DynamoDB PITRは有効とする。復元履歴の保存には従量費が発生する。
デプロイはWebバケットの古い配布ファイルを整理する。CDK bootstrap側の古いアセットは
デプロイ時に保持状況を確認し、運用側で整理する。

アクセスログ・解析・分散トレーシング・顧客管理KMS鍵は作らない。
アプリLambdaは安全な固定エラーコードだけを記録し、通常の実行ログを抑制する。
CDKの配布用補助Lambdaはデプロイ時だけ使う。
料金ゼロは保証せず、HTTP API、DynamoDB、ストレージ、配信、短期ログの従量費を対象にする。

## 初回公開の記録（2026-11-13）

`ai-dev` で `MemoCertificate`（us-east-1）、`Memo`（ap-northeast-1）を作成した。
既存ゾーン `Z100947420XSLWOY8HP9I` を使い、`https://memo.anipopina.com/` を公開済み。
本体スタックはCREATE_COMPLETE、CloudFrontはDeployed。DynamoDBのPITR・削除保護・TTLは有効。
本体のアクセスログは無効。公開HTTPS経由の本文保存・認証・MCPは検証記録を参照。

本番用の暗号鍵の控えは `.memo/production/vault-key` に保存し、ファイル権限は0600。
ローカル開発用の `.memo/vault-key` とは別物。値を画面へ出さず生成・投入し、CDK生成物への混入がないことを確認した。
この控えはGit管理しない。別の安全な場所へバックアップし、本番更新で鍵を生成し直さない。
作成済みスタックの更新では既存のVaultKeyパラメーターを引き継ぐ。
