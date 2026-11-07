# EqualInformation App Store

A static, data-driven app store for the apps made by EqualInformation. Live at
https://equalinformation.com/app-store/ (also https://bpupadhyaya.github.io/app-store/).

Own apps only. Store buttons ("App Store", "Google Play") appear only when that listing is verified live; everything else shows "Coming soon".

## How it works
- `catalog/` is the single source of truth (one JSON file per app, plus categories, collections, Today stories).
- `node tools/validate-catalog.mjs` enforces the schema (see `docs/CATALOG-SCHEMA.md`).
- `node tools/build.mjs` is a zero-dependency static generator: writes `dist/` (Today, Games, Apps, categories, collections, app pages, search, developer, about, 404, sitemap, robots, JSON-LD, PWA manifest + service worker, search index).
- GitHub Actions (`.github/workflows/pages.yml`) validates, builds and deploys `dist/` to GitHub Pages on every push.
- `node tools/refresh-store-status.mjs` checks the real stores and updates `ios.status` / `android.status` (`--write` to save).

## Commands
```
node tools/validate-catalog.mjs          # exit 1 on schema errors
node tools/build.mjs                     # build to dist/ (uses catalog/apps, or catalog/_sample if empty)
node tools/build.mjs --sample            # force the sample catalog
node tools/serve.mjs [port]              # serve dist/ at http://localhost:PORT/app-store/
node tools/refresh-store-status.mjs --write
```
Requires Node 20+. No npm install.

## Publishing hook (EVERY agent: last step of publishing ANY app)
```
cd ~/coding_common/os/app-store && git pull --rebase
node tools/ingest-app.mjs <slug> [--name "App Name"] [--apple-id N] [--package com.x.y] [--category puzzle,casual]
git add catalog assets && git commit -m "catalog: <slug>" && git push     # CI validates, builds and deploys
```
`ingest-app.mjs` reads command-center `docs/tasks/publish-program/STATUS.md`, `play-packets/<slug>.md`, `docs/tasks/<SLUG>-STORE-TEXT.md`, the app's `publish-program/assets/<slug>/store*/` art (icon, feature graphic, iphone/ipad shots), probes the App Store lookup and the Play URL, optimises images (webp, resized) and writes `catalog/apps/<slug>.json` after schema validation. Hand-edited fields (editorial, related, tags, accent, categories) survive re-runs. Use `--dry` to preview, `--no-probe` offline. Review the printed summary; fix gaps by editing the JSON. A nightly Action runs `refresh-store-status.mjs --write` so live/soon flips automatically.

## Scale
Incremental output (unchanged files are not rewritten), sharded search index (500 apps per shard), category/collection pages paginated (120 per page), no per-app hand-written HTML.

## Docs
- `docs/ARCHITECTURE.md` build, URLs, PWA, search, AI hook, CI
- `docs/CATALOG-SCHEMA.md` the contract for the catalog agent (read first)
- `docs/OPERATIONS.md` resume notes, status refresh, polishing checklist
