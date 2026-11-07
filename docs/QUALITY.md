# Quality log

## Lighthouse (mobile emulation, default throttling, live site, 2026-11-06)
| Page | Performance | Accessibility | Best practices | SEO |
|---|---|---|---|---|
| https://equalinformation.com/app-store/ (Today) | 100 | 100 | 100 | 100 |
| https://equalinformation.com/app-store/app/whirrtin/ | 100 | 100 | 100 | 100 |

Local runs against `tools/serve.mjs` scored 98 / 100 / 100 / 92: the SEO gap was only `robots.txt` resolving at the origin root of the local server, not a page issue.
Command: `npx lighthouse <url> --chrome-flags="--headless=new"` (any Lighthouse 12+; scripted with chrome-launcher).

## Layout checks (headless Chrome, real device metrics emulation, mobile touch)
Today, Games, app page, search (with query) and category were rendered at 430x932, 390x844 (phone), 820x1180 (tablet) and 1440x900 (desktop). No horizontal overflow at any size (scrollWidth == clientWidth). Phones get a sticky bottom tab bar (Today / Games / Apps / Search, 58px targets, safe-area aware); the header nav shows from 721px up.

## Image pipeline
webp variants 320/640/960/1440 (icons 96/192/384) with srcset/sizes, width/height attributes, lazy loading and blur-up placeholders; per-app 1200x630 OG JPEGs. Source art in `assets/` is not duplicated; generated files live in `dist/` and `.cache/`.
