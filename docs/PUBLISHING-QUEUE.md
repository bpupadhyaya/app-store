# Publishing queue: keeping the store in step with the pipeline

Standing process (owner, 2026-11-18). Additive only: never remove or downgrade an entry.

- When an app is code-complete with AdMob wired and queued for publishing: add it to the catalog as `soon` (iOS and Android), with its exact store name `<Field>: <Brand>`, truthful text from its own store listing, icon and 3-5 screenshots, and no store URLs.
- When it is submitted to a store: set that platform's status to `review`.
- When it is live: set `live` and the real store URL (the nightly `refresh-store-status.mjs --write` also flips this once the listing is public).

Tools (run from this repo, after `git pull --rebase --autostash`):
```
node tools/ingest-app.mjs <slug> [--name "<Field>: <Brand>"] --dry      # preview; reads store text/art
node tools/ingest-app.mjs <slug> --submitted                            # when submitted (review)
node tools/ingest-from-asc.mjs --only <slug> --fill-media --upgrade-existing   # from App Store Connect
node tools/validate-catalog.mjs && node tools/build.mjs                 # must pass before commit
git add catalog/apps/<slug>.json assets/apps/<slug> && git commit && git pull --rebase && git push   # CI deploys
```
Never put ad ids, private reasoning or other publishers' links in the catalog. Do not relax validator checks.
