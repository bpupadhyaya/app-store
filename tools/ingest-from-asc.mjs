#!/usr/bin/env node
// Bulk-add apps from App Store Connect (company + personal accounts) that are missing from the catalog.
// Usage: node tools/ingest-from-asc.mjs [--accounts company,personal] [--dry] [--only <substring of name/bundle>] [--refresh] [--no-play-probe]
//        [--include-prepare bundle1,bundle2] [--repo-only] [--upgrade-existing]
// Needs: release-ops checkout at ~/coding_common/pvt/release-ops (read-only use of _tools/asc-key.sh and _tools/lib.mjs; override RELEASE_OPS), cwebp, sips.
// Rules enforced here:
//  - Only ADDS entries. Existing catalog entries (matched by ios.bundleId, slug or normalised name) are never rewritten; --upgrade-existing only
//    fills an empty bundleId and promotes ios 'soon' to 'review' when Apple shows the app submitted. It never lowers a status.
//  - Included: ASC state READY_FOR_SALE, PENDING_*_RELEASE, IN_REVIEW, WAITING_FOR_REVIEW (and PREPARE_FOR_SUBMISSION only for --include-prepare bundles).
//    REJECTED / developer-removed / metadata-rejected apps with no live version are skipped and printed.
//  - ios.status 'live' only when the iTunes lookup (country us) returns the app; otherwise 'review' (shown as "Coming soon"). Re-run refresh-store-status.mjs later.
//  - android.status 'live' only when the Play page answers 200, else 'soon'.
//  - No private text: only public store fields (name, subtitle, description, what's new, keywords, urls, screenshots) are used.
//  - --repo-only adds code-complete repos that have no ASC record (list in REPO_ONLY below) using their store/ text, ios.status 'soon'.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './lib/catalog.mjs';
import { probeIos, probePlay } from './refresh-store-status.mjs';
import { webDescription, shorten } from './lib/storetext.mjs';
import { monetizationFor } from './lib/monetization.mjs';
const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : undefined; }, flag = k => argv.includes('--' + k);
const DRY = flag('dry');
const OPS = process.env.RELEASE_OPS || path.join(os.homedir(), 'coding_common/pvt/release-ops');
const WORK = path.join(os.homedir(), 'coding_common/pvt/studio-work');
const accounts = (opt('accounts') || 'company,personal').split(',');
const INCLUDE_PREPARE = new Set((opt('include-prepare') || 'com.equalinformation.game-lightbend.app').split(','));
const FILL = flag('fill-media'); // --fill-media: only fill EMPTY screenshots / missing hero of existing entries (never overwrites or deletes)
const APPS = path.join(ROOT, 'catalog/apps');
const CACHE = path.join(ROOT, '.cache/asc'); fs.mkdirSync(CACHE, { recursive: true });
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const slugify = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const today = new Date().toLocaleDateString('sv');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'asc-ingest-'));
const cwebp = spawnSync('which', ['cwebp']).status === 0;

// ---- existing catalog
const existing = fs.readdirSync(APPS).filter(f => f.endsWith('.json')).map(f => ({ ...JSON.parse(fs.readFileSync(path.join(APPS, f), 'utf8')), _f: f }));
const byBundle = new Map(), bySlug = new Map(), byName = new Map();
for (const a of existing) { if (a.ios?.bundleId) byBundle.set(a.ios.bundleId, a); bySlug.set(a.slug, a); for (const n of [a.name, a.name.split(':').pop(), a.name.split(' - ')[0]]) byName.set(norm(n), a); }
const FILLB = new Set(existing.filter(a => !(a.screenshots || []).length && a.ios?.bundleId).map(a => a.ios.bundleId));
const findExisting = (bundle, name, slug) => byBundle.get(bundle) || bySlug.get(slug) || [name, name.split(':').pop(), name.split(' - ')[0]].map(n => byName.get(norm(n))).find(Boolean);

// ---- category mapping (ASC category ids -> catalog category ids)
const SUB = { GAMES_PUZZLE: 'puzzle', GAMES_BOARD: 'board-strategy', GAMES_CARD: 'board-strategy', GAMES_STRATEGY: 'board-strategy', GAMES_DICE: 'board-strategy', GAMES_WORD: 'word', GAMES_MUSIC: 'music', GAMES_SPORTS: 'sports', GAMES_RACING: 'sports' };
const TOP = { GAMES: 'casual', EDUCATION: 'education', HEALTH_AND_FITNESS: 'health', MEDICAL: 'health', UTILITIES: 'utilities', LIFESTYLE: 'lifestyle', FINANCE: 'finance', PRODUCTIVITY: 'productivity', REFERENCE: 'education', BUSINESS: 'productivity',
  NEWS: 'utilities', NAVIGATION: 'utilities', TRAVEL: 'utilities', WEATHER: 'utilities', FOOD_AND_DRINK: 'lifestyle', ENTERTAINMENT: 'casual', SOCIAL_NETWORKING: 'lifestyle', MUSIC: 'lifestyle', SPORTS: 'lifestyle', SHOPPING: 'lifestyle', PHOTO_AND_VIDEO: 'utilities', BOOKS: 'education' };
const AGE = { FOUR_PLUS: '4+', NINE_PLUS: '9+', TWELVE_PLUS: '12+', SEVENTEEN_PLUS: '17+', EIGHTEEN_PLUS: '18+' };
const RANK = { READY_FOR_SALE: 5, PENDING_DEVELOPER_RELEASE: 4, PENDING_APPLE_RELEASE: 4, IN_REVIEW: 3, WAITING_FOR_REVIEW: 3, PREPARE_FOR_SUBMISSION: 1 };
const rank = s => RANK[s] ?? 0; // REJECTED etc. = 0

const imgDl = async (u, f) => { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('download ' + r.status); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; };
const tpl = (t, w, h, f) => t.replace('{w}', w).replace('{h}', h).replace('{f}', f);
const toWebp = (src, dest, w, q) => { fs.mkdirSync(path.dirname(dest), { recursive: true }); if (cwebp) execFileSync('cwebp', ['-quiet', '-q', String(q), '-resize', String(w), '0', src, '-o', dest]); else fs.copyFileSync(src, dest.replace(/\.webp$/, '.jpg')); };

const report = { added: [], skippedRejected: [], existingUpgraded: [], dupSkipped: [], thin: [] };

// ---- fetch ASC data for one account
async function loadAccount(acct) {
  const env = execFileSync('bash', [path.join(OPS, '_tools/asc-key.sh'), acct], { encoding: 'utf8' });
  const e = Object.fromEntries([...env.matchAll(/(ASC_\w+)='([^']+)'/g)].map(m => [m[1], m[2]]));
  const { asc, ascAll } = await import(path.join(OPS, '_tools/lib.mjs'));
  const cfg = { dir: '/', asc: { p8: e.ASC_KEY_PATH, keyId: e.ASC_KEY_ID, issuerId: e.ASC_ISSUER_ID } };
  const get = async p => { for (let t = 0; t < 3; t++) { const r = await asc(cfg, p); if (r.ok) return r.j; if (r.s === 404) return null; await new Promise(r => setTimeout(r, 1500)); } return null; };
  const apps = await ascAll(cfg, '/v1/apps?limit=200');
  const out = [];
  for (const a of apps) {
    const cf = path.join(CACHE, `${a.id}.json`);
    if (!flag('refresh') && fs.existsSync(cf)) { const c = JSON.parse(fs.readFileSync(cf, 'utf8')); if (!(FILL && FILLB.has(c.bundle) && !c.sets)) { out.push(c); continue; } }
    const name = a.attributes.name, bundle = a.attributes.bundleId;
    if (opt('only') && !(name + bundle).toLowerCase().includes(opt('only').toLowerCase())) continue;
    const vs = await ascAll(cfg, `/v1/apps/${a.id}/appStoreVersions?limit=20`);
    const states = vs.map(v => v.attributes.appStoreState || v.attributes.appVersionState);
    const best = states.slice().sort((x, y) => rank(y) - rank(x))[0] || 'NONE';
    const rec = { acct, id: a.id, name, bundle, best, versions: vs.map(v => ({ v: v.attributes.versionString, s: v.attributes.appStoreState, created: v.attributes.createdDate })) };
    const want = rank(best) >= 3 || (rank(best) === 1 && (INCLUDE_PREPARE.has(bundle) || (FILL && FILLB.has(bundle))));
    if (want) {
      const v = vs.filter(x => rank(x.attributes.appStoreState) >= 1).sort((x, y) => (rank(y.attributes.appStoreState) - rank(x.attributes.appStoreState)) || String(y.attributes.createdDate).localeCompare(x.attributes.createdDate))[0]
        || vs[0];
      const latest = vs.slice().sort((x, y) => String(y.attributes.createdDate).localeCompare(String(x.attributes.createdDate))).filter(x => rank(x.attributes.appStoreState) >= 1)[0] || v;
      rec.version = latest.attributes.versionString; rec.versionCreated = latest.attributes.createdDate;
      const infos = await get(`/v1/apps/${a.id}/appInfos?include=appInfoLocalizations,primaryCategory,secondaryCategory,primarySubcategoryOne,primarySubcategoryTwo&limit=10`);
      if (infos) {
        const inc = infos.included || [];
        const info = infos.data.find(i => i.attributes.state !== 'READY_FOR_DISTRIBUTION') || infos.data[0];
        rec.ageRating = AGE[info.attributes.appStoreAgeRating] || '';
        const rel = n => info.relationships?.[n]?.data?.id;
        rec.cats = { p: rel('primaryCategory'), s: rel('secondaryCategory'), p1: rel('primarySubcategoryOne'), p2: rel('primarySubcategoryTwo') };
        const lids = new Set((info.relationships?.appInfoLocalizations?.data || []).map(x => x.id));
        const loc = inc.filter(x => x.type === 'appInfoLocalizations' && lids.has(x.id)); const l = loc.find(x => x.attributes.locale === 'en-US') || loc[0];
        if (l) { rec.infoName = l.attributes.name; rec.subtitle = l.attributes.subtitle; rec.privacyUrl = l.attributes.privacyPolicyUrl; }
      }
      const vl = await get(`/v1/appStoreVersions/${latest.id}/appStoreVersionLocalizations?limit=20`);
      const l = (vl?.data || []).find(x => x.attributes.locale === 'en-US') || vl?.data?.[0];
      if (l) {
        Object.assign(rec, { description: l.attributes.description, whatsNew: l.attributes.whatsNew, promo: l.attributes.promotionalText, keywords: l.attributes.keywords, supportUrl: l.attributes.supportUrl });
        const ss = await get(`/v1/appStoreVersionLocalizations/${l.id}/appScreenshotSets?include=appScreenshots&limit=50`);
        rec.sets = []; if (ss) { const shots = new Map((ss.included || []).map(x => [x.id, x])); for (const s of ss.data) rec.sets.push({ type: s.attributes.screenshotDisplayType, shots: (s.relationships.appScreenshots.data || []).map(r => shots.get(r.id)?.attributes?.imageAsset).filter(Boolean) }); }
      }
      const b = await get(`/v1/appStoreVersions/${latest.id}/build`);
      rec.iconTemplate = b?.data?.attributes?.iconAssetToken?.templateUrl;
    }
    fs.writeFileSync(cf, JSON.stringify(rec)); out.push(rec);
  }
  return out;
}

const PHONE_PREF = ['APP_IPHONE_67', 'APP_IPHONE_69', 'APP_IPHONE_65', 'APP_IPHONE_61', 'APP_IPHONE_58', 'APP_IPHONE_55'];
const SHOTS = 4;
async function build(rec, ex) {
  const full = (rec.infoName || rec.name).trim();
  const [subj, brand] = full.includes(':') ? [full.split(':')[0], full.split(':').slice(1).join(':')] : [full.replace(/\s+[-–]\s+.*$/, ''), ''];
  let slug = slugify(brand ? `${subj}-${brand}` : subj);
  const dup = findExisting(rec.bundle, full, slug);
  if (dup) { report.dupSkipped.push(`${full} (${rec.bundle}) ~ ${dup.slug}`); return { dup }; }
  const adir = path.join(ROOT, 'assets/apps', slug), arel = `assets/apps/${slug}`;
  const clean = s => (s || '').replace(/\r/g, '').trim();
  const desc = clean(rec.description);
  const longDescription = (webDescription(desc) || desc).replace(/\bsecret(s)?\b/gi, 'hidden').replace(/api[_ -]?key/gi, 'key');
  const shortDescription = shorten(clean(rec.promo) || longDescription.split('\n').find(l => l && !l.startsWith('#')) || '');
  const cats = [...new Set([SUB[rec.cats?.p1], SUB[rec.cats?.p2], TOP[rec.cats?.p], TOP[rec.cats?.s]].filter(Boolean))];
  // games: put the specific subcategory first, drop the generic 'casual' fallback when a subcategory exists
  const categories = (rec.cats?.p === 'GAMES' && cats.length > 1 ? cats.filter((c, i) => c !== 'casual' || i === 0 && cats.length === 1) : cats);
  if (!categories.length) categories.push(rec.cats?.p === 'GAMES' ? 'casual' : 'education');
  const lk = rec.best === 'READY_FOR_SALE' ? await probeIos(rec.id, rec.bundle) : null;
  const releasedAt = lk?.releasedAt || (rec.versionCreated || '').slice(0, 10) || today;
  const monet = monetizationFor(desc, { education: categories.includes('education') });
  const pk = flag('no-play-probe') ? null : await probePlay(rec.bundle);
  const ios = { status: lk?.live ? 'live' : 'review', url: lk?.live ? lk.url : '', bundleId: rec.bundle };
  if (rec.best === 'PREPARE_FOR_SUBMISSION') ios.status = 'soon';
  if (rec.best === 'READY_FOR_SALE') ios.appleId = rec.id;
  const android = { status: pk?.live ? 'live' : 'soon', url: pk?.live ? pk.url : '', package: rec.bundle };
  // images
  let icon = `${arel}/icon-512.webp`, hero, screenshots = [];
  if (!DRY) {
    let ok = false;
    try { if (rec.iconTemplate) { await imgDl(tpl(rec.iconTemplate, 512, 512, 'png'), path.join(TMP, 'i.png')); fs.mkdirSync(adir, { recursive: true }); execFileSync('sips', ['-Z', '512', path.join(TMP, 'i.png'), '--out', path.join(TMP, 'i2.png')], { stdio: 'ignore' }); toWebp(path.join(TMP, 'i2.png'), path.join(adir, 'icon-512.webp'), 512, 90); ok = true; } } catch (e) { }
    if (!ok && lk?.lookup?.artworkUrl512) { try { await imgDl(lk.lookup.artworkUrl512.replace(/\/\d+x\d+bb\.(jpg|png)$/, '/512x512bb.png'), path.join(TMP, 'i.png')); fs.mkdirSync(adir, { recursive: true }); execFileSync('sips', ['-s', 'format', 'png', '-Z', '512', path.join(TMP, 'i.png'), '--out', path.join(TMP, 'i2.png')], { stdio: 'ignore' }); toWebp(path.join(TMP, 'i2.png'), path.join(adir, 'icon-512.webp'), 512, 90); ok = true; } catch { } }
    if (!ok) { report.thin.push(`${full}: no icon`); icon = ''; }
    const sets = rec.sets || [];
    const ph = PHONE_PREF.map(t => sets.find(s => s.type === t && s.shots.length)).find(Boolean) || sets.find(s => /IPHONE/.test(s.type) && s.shots.length);
    const tb = sets.find(s => /IPAD/.test(s.type) && s.shots.length);
    for (const [i, a] of (ph?.shots || []).slice(0, SHOTS).entries()) { try { const w = 640, h = Math.round(w * a.height / a.width); toWebp(await imgDl(tpl(a.templateUrl, w * 2, h * 2, 'jpg'), path.join(TMP, `p${i}.jpg`)), path.join(adir, `shot-${i + 1}.webp`), 640, 72); screenshots.push({ src: `${arel}/shot-${i + 1}.webp`, device: 'phone', caption: '' }); } catch { } }
    if (tb) { try { const a = tb.shots[0]; const f = await imgDl(tpl(a.templateUrl, a.width, a.height, 'jpg'), path.join(TMP, 't.jpg')); const c = path.join(TMP, 'tc.jpg'); execFileSync('sips', ['--cropToHeightWidth', String(Math.round(a.width * 9 / 16)), String(a.width), f, '--out', c], { stdio: 'ignore' }); toWebp(c, path.join(adir, 'hero.webp'), 1600, 74); hero = `${arel}/hero.webp`; } catch { } }
    if (!screenshots.length) report.thin.push(`${full}: no screenshots`);
    if (!desc) report.thin.push(`${full}: no description`);
  }
  const tags = [...new Set((rec.keywords || '').split(',').map(k => slugify(k.trim())).filter(k => k && k.length < 28))].slice(0, 12);
  const entry = {
    slug, name: full, subtitle: clean(rec.subtitle) || shorten(shortDescription, 60), categories, tags, developer: 'EqualInformation', shortDescription, longDescription,
    whatsNew: clean(rec.whatsNew) || 'First release.', price: 'Free', monetization: monet, ageRating: rec.ageRating || '4+',
    ...(rec.privacyUrl && { privacyUrl: rec.privacyUrl }), ...(rec.supportUrl && { supportUrl: rec.supportUrl }),
    releasedAt, updatedAt: today, version: rec.version || '1.0.0', icon, ...(hero && { hero }), screenshots, ios, android, related: [],
  };
  return { entry };
}

function save(entry) { if (DRY) return; fs.writeFileSync(path.join(APPS, entry.slug + '.json'), JSON.stringify(entry, null, 2) + '\n'); }

// ---- main: ASC apps
if (!flag('repo-only') && !FILL) for (const acct of accounts) {
  const list = await loadAccount(acct);
  for (const rec of list) {
    if (rank(rec.best) < 3 && !(rank(rec.best) === 1 && INCLUDE_PREPARE.has(rec.bundle))) {
      const ex = findExisting(rec.bundle, rec.name, slugify(rec.name));
      if (!ex && rec.best !== 'NONE') report.skippedRejected.push(`[${acct}] ${rec.name} (${rec.bundle}) state=${rec.best}`);
      continue;
    }
    const ex = byBundle.get(rec.bundle) || findExisting(rec.bundle, rec.infoName || rec.name, '');
    if (ex) { // existing entry: only non-destructive upgrades
      if (flag('upgrade-existing')) {
        const p = path.join(APPS, ex._f); const cur = JSON.parse(fs.readFileSync(p, 'utf8')); let ch = [];
        if (!cur.ios.bundleId) { cur.ios.bundleId = rec.bundle; ch.push('bundleId'); }
        if (cur.ios.status === 'soon' && rank(rec.best) >= 3) { cur.ios.status = 'review'; ch.push('ios soon->review'); }
        if (ch.length) { report.existingUpgraded.push(`${cur.slug}: ${ch.join(', ')}`); if (!DRY) fs.writeFileSync(p, JSON.stringify(cur, null, 2) + '\n'); }
      }
      continue;
    }
    const r = await build(rec); if (r.dup) continue;
    save(r.entry); report.added.push(`[${acct}] ${r.entry.slug} | ${rec.best} | ios=${r.entry.ios.status} android=${r.entry.android.status} | shots=${r.entry.screenshots.length}`);
    byBundle.set(rec.bundle, r.entry); bySlug.set(r.entry.slug, r.entry);
  }
}

// ---- code-complete repos without an ASC record (store text from the repo's store/ folder; ios 'soon')
const REPO_ONLY = [
  { repo: 'app-cellmoor', slug: 'biology-ap-cellmoor', bundle: 'com.equalinformation.cellmoor.app', cats: ['education'], icon: 'android/play-icon-512.png', shotsDir: 'store/art/iphone', hero: 'store/art/android/feature-graphic-1024x500.png' },
  { repo: 'app-molvane', slug: 'chemistry-ap-molvane', bundle: 'com.equalinformation.molvane.app', cats: ['education'], name: 'Chemistry AP: Molvane', subtitle: 'Chemistry AP Mocks & FRQs',
    description: 'Practice AP Chemistry with original questions, worked solutions, free-response sets and timed mock exams.\n\n### What is inside\nOver 200 multiple-choice questions, each with a full worked solution and a reason why every wrong choice is wrong. Sixteen original free-response questions with point-by-point rubrics. Short topic notes with common traps and links to the official course description and open textbooks.\n\n### Study your way\nQuick and full timed mocks, a daily practice round, and a rough 1 to 5 estimate that is clearly labelled as an estimate. Text size controls on every screen. No account needed, and it works offline.\n\nAP is a registered trademark of the College Board, which is not affiliated with this app.',
    icon: 'ios/Molvane/Assets.xcassets/AppIcon.appiconset' },
];
if (flag('repo-only') || flag('with-repos')) for (const r of REPO_ONLY) {
  const d = path.join(WORK, r.repo), rd = f => { try { return fs.readFileSync(path.join(d, f), 'utf8').trim(); } catch { return ''; } };
  const name = r.name || rd('store/name.txt'), subtitle = r.subtitle || rd('store/subtitle.txt'), desc = r.description || rd('store/description.txt'), promo = rd('store/promo.txt'), kw = rd('store/keywords.txt');
  const dup = findExisting(r.bundle, name, r.slug); if (dup) { report.dupSkipped.push(`${name} ~ ${dup.slug}`); continue; }
  const adir = path.join(ROOT, 'assets/apps', r.slug), arel = `assets/apps/${r.slug}`; let screenshots = [], icon = '', hero;
  if (!DRY) {
    fs.mkdirSync(adir, { recursive: true });
    let ic = path.join(d, r.icon); if (fs.existsSync(ic) && fs.statSync(ic).isDirectory()) { const f = fs.readdirSync(ic).filter(x => /\.png$/.test(x)).sort((a, b) => fs.statSync(path.join(ic, b)).size - fs.statSync(path.join(ic, a)).size)[0]; ic = f ? path.join(ic, f) : ''; }
    if (ic && fs.existsSync(ic)) { execFileSync('sips', ['-s', 'format', 'png', '-Z', '512', ic, '--out', path.join(adir, 'icon-512.png')], { stdio: 'ignore' }); icon = `${arel}/icon-512.png`; } else report.thin.push(`${name}: no icon`);
    const sd = r.shotsDir && path.join(d, r.shotsDir);
    if (sd && fs.existsSync(sd)) fs.readdirSync(sd).filter(x => /\.png$/.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).slice(0, SHOTS).forEach((x, i) => { toWebp(path.join(sd, x), path.join(adir, `shot-${i + 1}.webp`), 640, 72); screenshots.push({ src: `${arel}/shot-${i + 1}.webp`, device: 'phone', caption: '' }); });
    if (r.hero && fs.existsSync(path.join(d, r.hero))) { toWebp(path.join(d, r.hero), path.join(adir, 'hero.webp'), 1600, 74); hero = `${arel}/hero.webp`; }
    if (!screenshots.length) report.thin.push(`${name}: no screenshots`); if (!promo && !r.description) report.thin.push(`${name}: no promo text`);
  } else icon = `${arel}/icon-512.png`;
  const longDescription = webDescription(desc) || desc;
  const entry = { slug: r.slug, name, subtitle, categories: r.cats, tags: kw.split(',').map(k => slugify(k.trim())).filter(k => k && k.length < 28).slice(0, 12), developer: 'EqualInformation', shortDescription: shorten(promo || longDescription.split('\n').find(l => l && !l.startsWith('#'))), longDescription,
    whatsNew: 'First release.', price: 'Free', monetization: monetizationFor(desc, { education: r.cats.includes('education') }), ageRating: '4+', releasedAt: today, updatedAt: today, version: '1.0.0', icon, ...(hero && { hero }), screenshots,
    ios: { status: 'soon', url: '', bundleId: r.bundle }, android: { status: 'soon', url: '', package: r.bundle }, related: [] };
  save(entry); report.added.push(`[repo] ${r.slug} | ios=soon | shots=${screenshots.length}`);
}
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nADDED ${report.added.length}${DRY ? ' (dry run, nothing written)' : ''}`); report.added.forEach(x => console.log('  ' + x));
console.log(`\nEXISTING UPGRADED ${report.existingUpgraded.length}`); report.existingUpgraded.forEach(x => console.log('  ' + x));
console.log(`\nSKIPPED (rejected/incomplete, not in catalog) ${report.skippedRejected.length}`); report.skippedRejected.forEach(x => console.log('  ' + x));
console.log(`\nDUPLICATES SKIPPED ${report.dupSkipped.length}`); report.dupSkipped.forEach(x => console.log('  ' + x));
console.log(`\nTHIN DATA ${report.thin.length}`); report.thin.forEach(x => console.log('  ' + x));

// ---- --fill-media: fill empty screenshots / missing hero on EXISTING entries from ASC (matching bundle id) or the app repo's store-composed art
if (FILL) {
  fs.mkdirSync(TMP, { recursive: true });
  const ART = ['store/art/iphone', 'store/art/iphone63', 'art/store-v2/iphone', 'art/iphone', 'store/iphone', 'store/art-v2/iphone', 'store/screenshots/iphone'];
  const ART_PAD = ['store/art/ipad', 'art/store-v2/ipad', 'art/ipad', 'store/ipad'];
  const repos = fs.readdirSync(WORK).filter(d => d.startsWith('app-') && !d.endsWith('-android'));
  const repoBundle = new Map();
  for (const d of repos) for (const f of ['ios/project.yml', 'project.yml']) { try { const m = fs.readFileSync(path.join(WORK, d, f), 'utf8').match(/PRODUCT_BUNDLE_IDENTIFIER:\s*([\w.\-]+)/); if (m) { repoBundle.set(m[1], d); break; } } catch { } }
  const repoFor = a => repoBundle.get(a.ios?.bundleId) || repos.find(d => d === 'app-' + a.slug || d.endsWith('-' + a.slug) || d.endsWith('-' + a.slug.split('-').pop()) && !/^app-(exam|util|game|fin|home|work)-[a-z]+-/.test(d) && d.endsWith('-' + a.slug.split('-').pop()));
  const imgs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(x => /\.(png|jpg)$/i.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(x => path.join(d, x)) : [];
  const asc = new Map(); for (const acct of accounts) for (const r of await loadAccount(acct)) if (FILLB.has(r.bundle) && r.sets) asc.set(r.bundle, r);
  const filled = [], still = [];
  for (const a of existing) {
    const p = path.join(APPS, a._f); const cur = JSON.parse(fs.readFileSync(p, 'utf8'));
    if ((cur.screenshots || []).length && cur.hero) continue;
    const adir = path.join(ROOT, 'assets/apps', cur.slug), arel = `assets/apps/${cur.slug}`; let src = '';
    const shots = [], rec = asc.get(cur.ios?.bundleId); let heroSrc;
    const needShots = !(cur.screenshots || []).length, needHero = !cur.hero;
    if (rec) {
      const sets = rec.sets || [];
      const ph = PHONE_PREF.map(t => sets.find(s => s.type === t && s.shots.length)).find(Boolean) || sets.find(s => /IPHONE/.test(s.type) && s.shots.length);
      const tb = sets.find(s => /IPAD/.test(s.type) && s.shots.length);
      if (needShots && ph && !DRY) for (const [i, x] of ph.shots.slice(0, SHOTS).entries()) { try { const w = 640, h = Math.round(w * x.height / x.width); toWebp(await imgDl(tpl(x.templateUrl, w * 2, h * 2, 'jpg'), path.join(TMP, `p${i}.jpg`)), path.join(adir, `shot-${i + 1}.webp`), 640, 72); shots.push(`${arel}/shot-${i + 1}.webp`); } catch { } }
      if (needShots && ph && DRY) shots.push(...ph.shots.slice(0, SHOTS).map((_, i) => `${arel}/shot-${i + 1}.webp`));
      if (needHero && tb && !DRY) { try { const x = tb.shots[0]; const f = await imgDl(tpl(x.templateUrl, x.width, x.height, 'jpg'), path.join(TMP, 't.jpg')); const c = path.join(TMP, 'tc.jpg'); execFileSync('sips', ['--cropToHeightWidth', String(Math.round(x.width * 9 / 16)), String(x.width), f, '--out', c], { stdio: 'ignore' }); toWebp(c, path.join(adir, 'hero.webp'), 1600, 74); heroSrc = 'asc'; } catch { } }
      if (shots.length) src = 'asc';
    }
    const rd = repoFor(cur);
    if (rd && (needShots && !shots.length || needHero && !heroSrc)) {
      const d = path.join(WORK, rd);
      if (needShots && !shots.length) { const dir = ART.map(x => path.join(d, x)).find(x => imgs(x).length >= 3); if (dir) { for (const [i, f] of imgs(dir).slice(0, SHOTS).entries()) { if (!DRY) toWebp(f, path.join(adir, `shot-${i + 1}.webp`), 640, 72); shots.push(`${arel}/shot-${i + 1}.webp`); } src = 'repo:' + rd; } }
      if (needHero && !heroSrc) { const fg = ['store/art/android', 'art/play', 'store/art'].flatMap(x => imgs(path.join(d, x)).filter(f => /feature/i.test(path.basename(f))))[0];
        const pad = ART_PAD.map(x => imgs(path.join(d, x))).find(x => x.length); const h = fg || pad?.[0];
        if (h && !DRY) { try { let c = h; if (!fg) { c = path.join(TMP, 'hc.png'); const dim = execFileSync('sips', ['-g', 'pixelWidth', h], { encoding: 'utf8' }).match(/(\d+)\s*$/)[1]; execFileSync('sips', ['--cropToHeightWidth', String(Math.round(dim * 9 / 16)), dim, h, '--out', c], { stdio: 'ignore' }); } fs.mkdirSync(adir, { recursive: true }); toWebp(c, path.join(adir, 'hero.webp'), 1600, 74); heroSrc = 'repo'; } catch { } } }
    }
    let ch = [];
    if (shots.length && needShots) { cur.screenshots = shots.map(s => ({ src: s, device: 'phone', caption: '' })); ch.push(`${shots.length} shots (${src})`); }
    if (heroSrc && needHero) { cur.hero = `${arel}/hero.webp`; ch.push('hero'); }
    if (ch.length) { if (!DRY) fs.writeFileSync(p, JSON.stringify(cur, null, 2) + '\n'); filled.push(`${cur.slug}: ${ch.join(', ')}`); }
    if (needShots && !shots.length) still.push(`${cur.slug} [ios=${cur.ios.status}] ${rd ? 'repo ' + rd + ' has no store-composed iPhone art' : 'no repo/ASC art'}`);
  }
  console.log(`\nFILLED ${filled.length}`); filled.forEach(x => console.log('  ' + x));
  console.log(`\nSTILL WITHOUT SCREENSHOTS ${still.length}`); still.forEach(x => console.log('  ' + x));
}

if (FILL) fs.rmSync(TMP, { recursive: true, force: true });
