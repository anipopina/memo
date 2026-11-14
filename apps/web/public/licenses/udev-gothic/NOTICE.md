# UDEV Gothic HS

The editor bundles UDEV Gothic HS Regular v2.2.0 by Yuko OTAWARA,
licensed under the SIL Open Font License 1.1. See [LICENSE](LICENSE),
[LICENSE_BIZUDGothic](LICENSE_BIZUDGothic), and
[LICENSE_JetBrainsMono](LICENSE_JetBrainsMono) for copyright and license notices.

Source: https://github.com/yuru7/udev-gothic/releases/tag/v2.2.0

Archive: `UDEVGothic_HS_v2.2.0.zip` from that release.
Input: `UDEVGothic_HS_v2.2.0/UDEVGothicHS-Regular.ttf`.
This is the 1:2 halfwidth/fullwidth, hidden fullwidth-space variant,
without ligatures or Nerd Fonts. It retains JetBrains Mono's ASCII glyphs.

The bundled WOFF2 is lossless compression of the complete original font,
not a subset. Conversion used Python FontTools 4.61.1 and Brotli 1.2.1:

```python
from fontTools.ttLib.woff2 import compress

compress("UDEVGothicHS-Regular.ttf", "UDEVGothicHS-Regular.woff2", transform_tables=set())
```

All decoded font tables were verified against the source byte for byte,
except for WOFF2's required head compression flag and recalculated checksum.
Names, copyright, licensing metadata, character coverage and glyphs are preserved.
WOFF-specific metadata is omitted. See the [OFL FAQ, section 2.2](https://openfontlicense.org/ofl-faq/#22-can-i-make-and-use-woff-web-open-font-format-versions-of-ofl-fonts).

SHA-256:

- Original TTF: `89fa22a7fe28aca7ab3cdf33812406589b2e28739bcdb051848913e4164a2339`
- Bundled WOFF2: `b307fd5e9494735514405a8a42385ecdae1a3ab3eec22cb17738de641719b4fc`
