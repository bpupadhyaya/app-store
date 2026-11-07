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

## Docs
- `docs/ARCHITECTURE.md` build, URLs, PWA, search, AI hook, CI
- `docs/CATALOG-SCHEMA.md` the contract for the catalog agent (read first)
- `docs/OPERATIONS.md` resume notes, status refresh, polishing checklist
