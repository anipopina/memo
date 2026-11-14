# Web用ブランド画像

- faviconの正本は [`apps/web/public/favicon.svg`](../../apps/web/public/favicon.svg)。
  単色のパスを使い、折り目と本文の線は背景が見える切り抜きにしています。
- OGPの編集用原稿は [`ogp.svg`](ogp.svg)。文字はローカルのLiberation Sans Bold
  （SIL Open Font License 1.1）からパス化しており、配信時のフォント取得は不要です。
  フォントファイル自体は同梱していません。
- 配信用は [`apps/web/public/ogp.png`](../../apps/web/public/ogp.png)。原稿を1200×630で
  描画し、単色領域を保ちながら文字の縁だけを中間色にしたパレットPNGです。
  原稿を変更した場合は、同じ寸法でPNGも再出力してください。
- ホーム画面用のPNG（`apple-touch-icon.png` とmanifest内のアイコン）は、
  OGP原稿の中央を正方形に切り抜いて縮小しています。背景は不透明に保ち、
  OS側の角丸・マスク処理に備えて文字の周囲に余白を残しています。
- `favicon.ico` はSVG faviconと同じメモの形を使っています。
  manifestはブラウザ表示を維持し、起動先はメモの秘密URLを含まないサイトルートです。

設定の参考：[AppleのWeb Clipアイコン](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)、
[manifestのアイコン](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)。

元の生成画像は比較用の `tmp/branding-proposals-20261114/` に保持しています。
