# Operations / resume notes
- Command-center direction file (private): docs/tasks/APP-STORE-SITE-DIRECTION-2026-11-06.md.
- Status refresh: `node tools/refresh-store-status.mjs` (dry run, prints changes) or `--write`. iOS: `https://itunes.apple.com/lookup?id=<appleId>&country=us` must return resultCount>=1 -> `live` and sets url from `trackViewUrl`; if it was `live` and now empty -> reported, not auto-downgraded unless `--downgrade`. Android: GET the Play URL (`https://play.google.com/store/apps/details?id=<package>`), HTTP 200 -> `live`. Only apps already at `review` or `soon` (or live) are probed.
- Local preview: `node tools/build.mjs && node tools/serve.mjs` then open http://localhost:8080/app-store/.
- Never commit raw large images. Keep each image under ~250 KB.
