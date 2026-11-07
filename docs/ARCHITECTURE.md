# Architecture

## Serving
Public repo `bpupadhyaya/app-store`, GitHub Pages (source: GitHub Actions). Served at https://bpupadhyaya.github.io/app-store/ and, via the owner's custom domain on the user site, https://equalinformation.com/app-store/ (same pattern as games-site, medforge-site). All internal links are generated RELATIVE to each page, so the site works under any prefix and offline. Canonical/OG/sitemap URLs use `SITE_URL` from `site.config.json` (https://equalinformation.com/app-store/).

## Build (`tools/build.mjs`, zero dependencies)
Reads `catalog/` -> writes `dist/`. Templates are plain JS functions in `tools/lib/`. Pages: `/` (Today), `games/`, `apps/`, `category/<id>/`, `collection/<id>/`, `app/<slug>/`, `search/`, `developer/`, `about/`, `404.html`; plus `sitemap.xml`, `robots.txt`, `manifest.webmanifest`, `sw.js`, `search-index.json`, generated PNGs (default OG image, PWA icons). 5,000 apps build in seconds (single pass, no per-page I/O beyond writes).
Strings live in `site/strings/en.json` (i18n-ready: add `fr.json` etc. and a locale build flag later).

## Client JS (`site/site.js`, ~8 KB, no framework)
Theme toggle (dark/light/auto), screenshot carousel (scroll-snap + keys), instant search (lazy-loads `search-index.json`, synonyms, prefix + typo tolerant), "Ask the store".

## Ask the store (AI hook)
Works fully client-side today: parses a natural-language query into intent (kind, tags via synonyms, "like <app>" via related/tags overlap) and ranks locally. To plug in an LLM: set `askEndpoint` in `site.config.json` to an HTTPS URL. The client then POSTs `{"query": "...", "locale": "en"}` and expects `{"slugs": ["a","b"], "answer": "short text"}`; slugs are rendered as results, `answer` shown above them. On any error or timeout (4 s) it silently falls back to the local ranker. The endpoint must only ever return slugs that exist in the catalog.

## PWA
`manifest.webmanifest`, `sw.js` (cache-first for assets, stale-while-revalidate for pages, offline fallback page, versioned by content hash).

## CI
`.github/workflows/pages.yml`: validate -> build -> upload artifact -> deploy. A scheduled run (daily) also runs `refresh-store-status.mjs --write` and commits status changes only if there are any.

## Quality targets
AA contrast, keyboard operable, visible focus, `prefers-reduced-motion`, semantic landmarks, images with width/height + lazy, no render-blocking JS, CSS inlined per page <20 KB. Lighthouse 95+.
