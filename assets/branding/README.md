# Web用ブランド画像

- faviconの正本は [`apps/web/public/favicon.svg`](../../apps/web/public/favicon.svg)。
  アイコン全体を紙面とし、濃い茶黒の背景・生成りの本文線・オレンジの折り返しで構成します。
  右上は折り返しの斜辺で切り落として透過し、残る3つの角を丸めています。
- OGPの編集用原稿は [`ogp.svg`](ogp.svg)。文字はローカルのLiberation Sans Bold
  （SIL Open Font License 1.1）からパス化しており、配信時のフォント取得は不要です。
  フォントファイル自体は同梱していません。
- 配信用は [`apps/web/public/ogp.png`](../../apps/web/public/ogp.png)。原稿を1200×630で
  描画した不透明なPNGです。右上には裏面をオレンジで塗り、角を少し丸めた折り返しを配置しています。
  原稿を変更した場合は、同じ寸法でPNGも再出力してください。
- ホーム画面用のPNG（`apple-touch-icon.png` とmanifest内のアイコン）は、
  専用原稿 [`icon.svg`](icon.svg) から各サイズに描画します。折り返し左下の丸みは
  faviconの約1.6倍です。背景は不透明に保ち、外周の角丸は画像に焼き込まず
  OS側のマスク処理に任せます。
- `favicon.ico` はSVG faviconと同じメモの形を使っています。
  manifestはブラウザ表示を維持し、起動先はメモの秘密URLを含まないサイトルートです。

設定の参考：[AppleのWeb Clipアイコン](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、
[manifestのアイコン](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)。

元の生成画像は比較用の `tmp/branding-proposals-20261114/` に保持しています。

## 再生成

SVG原稿と [生成スクリプト](../../tools/generate-branding.mjs)、配信用画像をGitで管理します。
依存関係のインストール後、リポジトリルートで実行します。

```sh
pnpm exec playwright install chromium
node tools/generate-branding.mjs
```

ロックファイルのPlaywrightと付属Chromiumを使い、PNGとICOを再生成します。
外部素材の取得や追加の画像処理ライブラリは不要です。
描画環境が異なる場合は画像の縁に差が出る可能性があるため、更新時に目視確認してください。
