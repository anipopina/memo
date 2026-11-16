# 第三者ライセンス

ルートの [LICENSE](LICENSE) は本プロジェクトの独自部分に適用します。
以下の第三者のコード・素材・スキルをMITへ変更するものではありません。
再配布時も、それぞれの著作権表示・ライセンス・NOTICEを保持してください。

| 対象                                 | ライセンス       | 出所・表示                                                                                                                  |
| ------------------------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Material Symbols SVG                 | Apache-2.0       | [NOTICE](apps/web/public/licenses/material-symbols/NOTICE.md)、[LICENSE](apps/web/public/licenses/material-symbols/LICENSE) |
| UDEV Gothic HSフォント               | OFL-1.1          | [NOTICEと派生元のライセンス案内](apps/web/public/licenses/udev-gothic/NOTICE.md)                                            |
| 同梱スキルのアーカイブ               | MIT / Apache-2.0 | [採用記録](tools/skills-sources.json) に各アーカイブ内のライセンス文書を記載。展開・再配布時も保持する                      |
| ProseMirror Viewのパッチ内の元コード | MIT              | [対象パッチ](patches/prosemirror-view@1.42.9.patch)。元コードの表示を下記に収録                                             |

依存パッケージは各パッケージのライセンスに従います。固定した版は
[pnpm-lock.yaml](pnpm-lock.yaml)、導入済み依存関係の一覧は
`pnpm licenses list` で確認できます。ビルドツールのLightning CSSはMPL-2.0です。
これらのパッケージ自体を再配布する場合は、各パッケージのライセンス文書を保持し、
MPL対象部分のソース提供条件なども満たしてください。

OGP画像内のLiberation Sansの字形はパス化した図版として使用し、フォント自体は同梱していません。
原稿と出所は [ブランド画像](assets/branding/README.md) を参照してください。
OFLフォントを使った図版へのOFL適用は不要です（[OFL FAQ 1.1–1.1.2](https://openfontlicense.org/ofl-faq/)）。

## ProseMirror View

Source: <https://github.com/ProseMirror/prosemirror-view/tree/1.42.9>

```text
Copyright (C) 2015-2017 by Marijn Haverbeke <marijn@haverbeke.berlin> and others

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```
