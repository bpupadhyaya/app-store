# Catalog schema (the contract)

Catalog agent writes: `catalog/apps/<slug>.json` and images in `assets/apps/<slug>/`. Then run `node tools/validate-catalog.mjs`, commit, push. The site rebuilds automatically.

## catalog/apps/<slug>.json
```json
{
  "slug": "pebble-shift",
  "name": "Pebble Shift",
  "subtitle": "Slide stones, calm your mind",
  "categories": ["puzzle", "casual"],
  "tags": ["relaxing", "offline", "brain-training"],
  "developer": "EqualInformation",
  "shortDescription": "<= 160 chars, plain text",
  "longDescription": "Markdown. Paragraphs, **bold**, lists, links.",
  "whatsNew": "Plain text / markdown",
  "price": "Free",
  "monetization": "Free with ads, optional monthly ad-free",
  "ageRating": "4+",
  "privacyUrl": "https://equalinformation.com/privacy-pebbleshift.html",
  "supportUrl": "https://equalinformation.com/app-support-pebbleshift.html",
  "releasedAt": "2026-11-06",
  "updatedAt": "2026-11-06",
  "version": "1.0.0",
  "icon": "assets/apps/pebble-shift/icon-512.png",
  "hero": "assets/apps/pebble-shift/hero.jpg",
  "accent": "#6a45f2",
  "screenshots": [{"src": "assets/apps/pebble-shift/shot-1.jpg", "device": "phone", "caption": "Slide to match"}],
  "ios":     {"status": "live", "url": "https://apps.apple.com/app/id123", "appleId": "123", "bundleId": "com.equalinformation.pebbleshift"},
  "android": {"status": "soon", "url": "", "package": "com.equalinformation.pebbleshift"},
  "related": ["other-slug"],
  "editorial": {"headline": "A pebble garden in your pocket", "story": "Markdown, 1-3 paragraphs."}
}
```
Rules:
- Required: slug (= file name, `[a-z0-9-]+`), name, subtitle, categories (>=1, ids from `catalog/categories.json`, primary first), shortDescription, longDescription, price, monetization, ageRating, releasedAt, updatedAt, icon, ios.status, android.status.
- Optional: tags, whatsNew, version, hero, accent (#rrggbb), screenshots, related, editorial, privacyUrl, supportUrl.
- `developer` is always `EqualInformation`; `price` always `Free`; `monetization` must disclose ads and the optional monthly ad-free plan.
- status is `live` | `review` | `soon`. `live` REQUIRES an https url on apps.apple.com (iOS) / play.google.com (Android). Never link another publisher's listing. `review` and `soon` show "Coming soon" without a link.
- Images: icon 512x512 PNG; hero 1600x900 (jpg/webp); screenshots 1170x2532 phone / 2048x2732 tablet jpg or webp, each <= ~250 KB (optimise before commit). Missing files fail validation; the sample catalog is exempt. A gradient placeholder is used when `hero` is omitted.
- No secrets, internal repo links or private org names anywhere in the JSON.

## catalog/categories.json
`[{"id":"puzzle","name":"Puzzle","kind":"game","blurb":"...","icon":"puzzle","hue":262}]` kind is `game` or `app`. An app is a Game when its primary category kind is `game`.

## catalog/collections.json
`[{"id":"new-this-week","title":"New this week","subtitle":"...","appSlugs":["a","b"]}]`

## catalog/today.json
`{"featured":"slug-of-featured-app","stories":[{"id":"2026-11-06-pebbles","date":"2026-11-06","kicker":"Now playing","title":"...","subtitle":"...","body":"markdown","appSlugs":["pebble-shift"],"accent":"#6a45f2","image":"assets/..optional.jpg"}]}`

## catalog/synonyms.json (optional, search)
`{"relax":["calm","chill","zen","soothing"], ...}` groups of words treated as equal by search and the Ask box.
