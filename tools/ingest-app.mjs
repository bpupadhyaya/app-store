#!/usr/bin/env node
// Create/update catalog/apps/<slug>.json + optimised assets/apps/<slug>/ from the publish-program sources of truth.
// Usage: node tools/ingest-app.mjs <slug> [--apple-id N] [--submitted] [--name "App Name"] [--apple-id N] [--package pkg] [--bundle id] [--category puzzle,casual]
//        [--assets DIR] [--no-probe] [--dry] [--cc DIR] [--sources-only]
// One command for a newly approved app:  node tools/ingest-app.mjs <slug> --apple-id <ASC id>   (add --dry first; --submitted for apps waiting for review)
// Field sources, in order: store text (docs/tasks/<slug>/STORE-TEXT*.md or <SLUG>-STORE-TEXT*.md, Review Notes stripped) -> iTunes lookup (name, genre, icon, description, own screenshots) -> fail loudly.
// Sources (command-center, default ~/coding_common/pvt/command-center, override --cc or env CC_DIR):
//   docs/tasks/publish-program/STATUS.md (row for the game), publish-program/play-packets/<slug>.md,
//   docs/tasks/<SLUG>-STORE-TEXT.md (slug upper, hyphens removed or kept), publish-program/assets/<slug>/store*/ (art).
// Existing hand-edited fields (editorial, related, tags, accent, categories) are kept; everything else is refreshed.
// Needs: macOS sips and/or cwebp for image optimisation (falls back to copying). Prints a reviewable diff summary.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './lib/catalog.mjs';
import { probeIos, probePlay } from './refresh-store-status.mjs';
import { parseStoreText, webDescription, shorten, mapCategories } from './lib/storetext.mjs';
const argv = process.argv.slice(2);
const VALUE_OPTS = new Set(['name', 'apple-id', 'package', 'bundle', 'category', 'assets', 'cc', 'text', 'subtitle']);
const opt = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : undefined; }, flag = k => argv.includes('--' + k);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(argv[i - 1]?.startsWith('--') && VALUE_OPTS.has(argv[i - 1].slice(2))));
const FAILS = []; const fail = m => FAILS.push(m);
const lookupRaw = async q => { try { const r = await fetch(`https://itunes.apple.com/lookup?${q}&country=us`, { signal: AbortSignal.timeout(15000) }); return (await r.json()).results?.[0] || null; } catch { return null; } };
let LK = null; // iTunes lookup result (null while the app is not yet public)
if (!flag('no-probe')) LK = opt('apple-id') ? await lookupRaw('id=' + opt('apple-id')) : opt('bundle') ? await lookupRaw('bundleId=' + opt('bundle')) : null;
let slug = positional[0] || (LK ? LK.trackName.split(':')[0].trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') : '');
if (!slug || !/^[a-z0-9-]+$/.test(slug)) { console.error('usage: ingest-app.mjs <slug> [--apple-id N] [--submitted] [--dry] (see header)'); process.exit(2); }
const CC = opt('cc') || process.env.CC_DIR || path.join(os.homedir(), 'coding_common/pvt/command-center');
const T = path.join(CC, 'docs/tasks'), PP = path.join(T, 'publish-program');
const rd = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const outFile = path.join(ROOT, 'catalog/apps', slug + '.json');
const old = fs.existsSync(outFile) ? JSON.parse(rd(outFile)) : {};
const listDir = d => fs.existsSync(d) ? fs.readdirSync(d).map(f => path.join(d, f)).filter(f => fs.statSync(f).isFile()) : [];
const textCands = [...listDir(path.join(T, slug)), ...listDir(T)].filter(f => /STORE-?TEXT/i.test(path.basename(f)) && /\.md$/.test(f) && !/play|deluxe/i.test(path.basename(f)) &&
  (path.dirname(f) === path.join(T, slug) || norm(path.basename(f)).startsWith(norm(slug)))).sort((x, y) => x.length - y.length);
const textFile = opt('text') || textCands[0];
const text = rd(textFile || ''), packet = rd(path.join(PP, 'play-packets', slug + '.md'));
const P = textFile ? parseStoreText(text) : parseStoreText('');
if (textFile && !P.description && !P.name) P.description = text.trim(); // plain unlabeled listing draft (e.g. a Play listing file): whole file is the description
const field = (re, s = text) => (s.match(re) || [])[1]?.trim();
// STATUS row
const status = rd(path.join(PP, 'STATUS.md')).split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(c => c.trim())).find(c => norm(c[2].replace(/\(.*\)/, '')) === norm(opt('name') || slug)) || [];
const rowText = status.join(' ');
const fullName = P.name || LK?.trackName || '';
const name = opt('name') || old.name || fullName.split(':')[0].trim() || status[2]?.replace(/\(.*\)/, '').trim() || '';
const subtitle = opt('subtitle') || P.subtitle || old.subtitle || (fullName.includes(':') ? fullName.split(':').slice(1).join(':').trim() : '');
const promo = P.promo, keywords = P.keywords;
const whatsNewText = P.whatsNew || (LK?.releaseNotes || '').trim() || 'First release.';
const whatsNew = (flag('refresh-text') ? whatsNewText : '') || old.whatsNew || whatsNewText;
const MAPG = { lifestyle: 'lifestyle', music: 'music', utilities: 'utilities', education: 'education', 'health & fitness': 'health', games: '', puzzle: 'puzzle', finance: 'finance', productivity: 'productivity', entertainment: 'casual', casual: 'casual', board: 'board-strategy', strategy: 'board-strategy', word: 'word', sports: 'sports' };
let categories = opt('category')?.split(',') || old.categories || (P.categories.length ? P.categories : [...new Set([LK?.primaryGenreName, ...(LK?.genres || [])].filter(Boolean).map(g => MAPG[g.toLowerCase()]).filter(Boolean))]);
if (!categories.length) fail('no category: add a "Category:" line to the store text or pass --category id,id');
const ageRating = old.ageRating || P.ageRating || LK?.contentAdvisoryRating || '4+';
const pkg = opt('package') || old.android?.package || field(/applicationId:\s*`([^`]+)`/, packet) || field(/Package[^`\n]*`([a-z0-9._]+)`/i, packet) || '';
const bundle = opt('bundle') || old.ios?.bundleId || P.bundleId || LK?.bundleId || (rowText.match(/bundle (com\.[a-z0-9.]+)/i) || [])[1] || pkg;
const appleId = opt('apple-id') || old.ios?.appleId || (LK && String(LK.trackId)) || (rowText + text).match(/ASC app (\d{9,10})/)?.[1] || (rowText.match(/\bid(\d{9,10})\b/) || [])[1] || '';
const urlIn = (re) => ((text + packet + (LK?.description || '')).match(re) || [])[1];
const head200 = async u => { try { return (await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(10000) })).status === 200; } catch { return false; } };
const firstLive = async (urls) => { for (const u of urls) if (await head200(u)) return u; return undefined; };
let privacyUrl = P.privacyUrl || old.privacyUrl || urlIn(/(https:\/\/equalinformation\.com\/privacy-[a-z0-9-]+\.html)/), supportUrl = P.supportUrl || old.supportUrl || urlIn(/(https:\/\/equalinformation\.com\/(?:app-)?support-[a-z0-9-]+\.html)/);
if (!flag('no-probe')) { const E = 'https://equalinformation.com/'; privacyUrl ||= await firstLive([`${E}privacy-${slug}.html`, `${E}privacy-${slug.replace(/-/g, '')}.html`]); supportUrl ||= await firstLive([`${E}app-support-${slug}.html`, `${E}support-${slug}.html`, `${E}app-support-${slug.replace(/-/g, '')}.html`, `${E}support-${slug.replace(/-/g, '')}.html`]); }
// description: keep web-safe markdown, drop store boilerplate sections
// Web copy is owned by the catalog once it exists: re-runs keep it unless --refresh-text is given (new entries derive it from the store text).
const keepCopy = !!old.longDescription && !flag('refresh-text');
// drop store-only sections (ads, free-to-play, subscription legalese, privacy, contact) from the web description
const derivedLong = webDescription(P.description || LK?.description || '') || promo || '';
const longDescription = keepCopy ? old.longDescription : derivedLong;
const shortDescription = keepCopy && old.shortDescription ? old.shortDescription : shorten(promo || longDescription.split('\n').find(l => l && !l.startsWith('#')) || '');
// store status
const LIVE = LK && (flag('no-probe') ? false : true);
let ios = { status: old.ios?.status || (flag('submitted') || /WAITING|IN_REVIEW|SUBMITTED/i.test(status[9] || '') ? 'review' : 'soon'), url: old.ios?.url || '', bundleId: bundle };
const pkgFinal = pkg || bundle; // our Android package equals the iOS bundle id unless the packet says otherwise
let android = { status: old.android?.status || (/SUBMITTED|review/i.test(status[10] || '') ? 'review' : 'soon'), url: old.android?.url || '', package: pkgFinal };
if (LK) { ios.status = 'live'; ios.url = (LK.trackViewUrl || '').split('?')[0]; ios.appleId = String(LK.trackId); }
else if (old.ios?.appleId) ios.appleId = old.ios.appleId; // unreleased apps carry no id in the public catalog; refresh-store-status finds them by bundle id
if (!flag('no-probe')) { const p = await probePlay(pkgFinal); if (p?.live) { android.status = 'live'; android.url = p.url; } }
// assets
const adir = path.join(ROOT, 'assets/apps', slug), arel = `assets/apps/${slug}`;
const assetsHome = path.join(PP, 'assets'), assetDir = fs.existsSync(assetsHome) ? fs.readdirSync(assetsHome).find(d => d === slug) || fs.readdirSync(assetsHome).find(d => norm(d) === norm(slug)) : null;
const srcRoot = opt('assets') || path.join(assetsHome, assetDir || slug);
const storeDirs = fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot).filter(d => /^store/.test(d) && fs.statSync(path.join(srcRoot, d)).isDirectory()) : [];
const rank = d => (/android/.test(d) ? 0 : 1) * 100 + (+(d.match(/\d+/) || [0])[0]);
storeDirs.sort((a, b) => rank(b) - rank(a)); storeDirs.push(''); // '' = iphone/ and ipad/ directly under the app's art folder
const find = (sub, re) => { for (const d of storeDirs) { const dir = path.join(srcRoot, d, sub); if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).filter(x => re.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(x => path.join(dir, x)); if (f.length) return f; } } return []; };
const findFile = re => { for (const d of [...storeDirs, 'play']) { const dir = path.join(srcRoot, d); if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).filter(x => re.test(x)).sort().reverse()[0]; if (f) return path.join(dir, f); } } return null; };
const cwebp = spawnSync('which', ['cwebp']).status === 0;
function img(src, dest, w, q = 80) { // writes dest (.webp via cwebp, else resized copy)
  if (fs.existsSync(dest) && !flag('refresh-images')) return; // idempotent: no binary churn on re-runs
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (dest.endsWith('.webp') && cwebp) execFileSync('cwebp', ['-quiet', '-q', String(q), '-resize', String(w), '0', src, '-o', dest]);
  else if (spawnSync('which', ['sips']).status === 0) execFileSync('sips', ['-Z', String(w), src, '--out', dest], { stdio: 'ignore' });
  else fs.copyFileSync(src, dest);
}
let icon = old.icon, hero = old.hero, screenshots = old.screenshots || [];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ingest-'));
const sized = (u, wh) => u.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/, `/${wh}bb.jpg`);
const dl = async (u, f) => { const r = await fetch(u, { signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error('download ' + r.status + ' ' + u); fs.writeFileSync(f, Buffer.from(await r.arrayBuffer())); return f; };
if (!flag('dry')) {
  const ic = findFile(/^icon-512\.png$/) || findFile(/^icon.*(1024|512)\.png$/) || findFile(/^icon.*\.png$/);
  if (ic) { img(ic, path.join(adir, 'icon-512.png'), 512); icon = `${arel}/icon-512.png`; }
  const fg = findFile(/^feature.*\.(png|jpg)$/); if (fg) { img(fg, path.join(adir, 'hero.webp'), 1600); hero = `${arel}/hero.webp`; }
  if (!ic && LK?.artworkUrl512) { const f = await dl(sized(LK.artworkUrl512, '512x512'), path.join(TMP, 'icon.jpg')); img(f, path.join(adir, 'icon-512.png'), 512); icon = `${arel}/icon-512.png`; }
  let ph = [find('iphone', /\.png$/), find('phone', /\.png$/), find('', /^iphone[-_]?\d+\.png$/)].find(x => x.length) || [], tb = [find('ipad', /\.png$/), find('', /^ipad[-_]?\d+\.png$/)].find(x => x.length) || [];
  if (!ph.length && !LK?.screenshotUrls?.length) { // last resort: our own Android store screenshots (same UI)
    const pl = sub => { const d = path.join(srcRoot, 'play', sub); return fs.existsSync(d) ? fs.readdirSync(d).filter(x => /\.png$/.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(x => path.join(d, x)) : []; };
    ph = pl('phone'); tb = pl('tablet10'); if (!tb.length) tb = pl('tab10'); if (ph.length) console.log('NOTE: no iPhone art found; using the Android store screenshots from play/.');
  }
  const keepShots = old.screenshots?.length && !flag('refresh-shots'); // curated shot list (and captions) survive re-runs
  if (!keepShots) screenshots = [];
  if (!keepShots && !ph.length && LK?.screenshotUrls?.length) { // our own live listing media (lookup) when no local art exists
    for (const [i, u] of LK.screenshotUrls.slice(0, 8).entries()) { img(await dl(sized(u, '1170x2532'), path.join(TMP, `p${i}.jpg`)), path.join(adir, `shot-${i + 1}.webp`), 640, 78); screenshots.push({ src: `${arel}/shot-${i + 1}.webp`, device: 'phone', caption: '' }); }
    for (const [i, u] of (LK.ipadScreenshotUrls || []).slice(0, 4).entries()) { img(await dl(sized(u, '2048x2732'), path.join(TMP, `t${i}.jpg`)), path.join(adir, `tablet-${i + 1}.webp`), 1000, 78); screenshots.push({ src: `${arel}/tablet-${i + 1}.webp`, device: 'tablet', caption: '' }); }
  }
  if (!keepShots) ph.slice(0, 8).forEach((s, i) => { img(s, path.join(adir, `shot-${i + 1}.webp`), 640, 78); screenshots.push({ src: `${arel}/shot-${i + 1}.webp`, device: 'phone', caption: old.screenshots?.find(x => x.src === `${arel}/shot-${i + 1}.webp`)?.caption || '' }); });
  if (!keepShots) tb.slice(0, 4).forEach((s, i) => { img(s, path.join(adir, `tablet-${i + 1}.webp`), 1000, 78); screenshots.push({ src: `${arel}/tablet-${i + 1}.webp`, device: 'tablet', caption: old.screenshots?.find(x => x.src === `${arel}/tablet-${i + 1}.webp`)?.caption || '' }); });
}
const today = new Date().toISOString().slice(0, 10);
const entry = {
  slug, name, subtitle, categories, tags: old.tags?.length ? old.tags : [...new Set([...keywords.map(k => k.toLowerCase().replace(/\s+/g, '-')), ...(/offline/i.test(longDescription) ? ['offline'] : [])])].slice(0, 12),
  developer: 'EqualInformation', shortDescription, longDescription, whatsNew, price: 'Free', monetization: old.monetization || (/\bno ads\b/i.test(P.description + packet) && !/shows ads|admob/i.test(P.description) ? 'Free, no ads, optional monthly subscription' : /subscription|ad-?free/i.test(text + packet + rowText) ? 'Free with ads, optional monthly ad-free' : 'Free with ads'), ageRating,
  ...(privacyUrl && { privacyUrl }), ...(supportUrl && { supportUrl }), releasedAt: old.releasedAt || (LK?.releaseDate || '').slice(0, 10) || today, updatedAt: today, version: old.version || '1.0.0',
  icon: icon || `${arel}/icon-512.png`, ...(hero && { hero }), ...(old.accent && { accent: old.accent }), screenshots, ios, android,
  related: old.related || [], ...(old.editorial && { editorial: old.editorial }),
};
for (const [k, v] of [['name', name], ['subtitle', subtitle], ['longDescription', longDescription], ['shortDescription', shortDescription]]) if (!v) fail(`missing ${k}: not in the store text (${textFile ? path.basename(textFile) : 'no STORE-TEXT file found for ' + slug}) and not in the App Store lookup`);
if (!icon && !flag('dry')) fail('no icon: put icon-1024.png/icon-512.png in publish-program/assets/' + slug + '/ or wait until the lookup returns the app');
if (!screenshots.length && !flag('dry')) console.log('WARN: no screenshots (no local iphone/ipad art, none from lookup). The page will show a placeholder.');
if (FAILS.length) { console.error(`INGEST FAILED for ${slug}:\n - ` + FAILS.join('\n - ')); process.exit(1); }
const same = JSON.stringify({ ...entry, updatedAt: 0 }) === JSON.stringify({ ...old, updatedAt: 0 });
if (same) entry.updatedAt = old.updatedAt;
console.log(`${slug}: ${name} | ${categories.join(',')} | ios=${ios.status} android=${android.status} | shots=${screenshots.length} | text=${textFile ? path.basename(textFile) : 'MISSING'} | ${same ? 'unchanged' : old.slug ? 'updated' : 'new'}`);
if (!textFile) console.log(LK ? 'NOTE: no STORE-TEXT file; copy derived from the App Store lookup description. Review the entry.' : 'WARN: no STORE-TEXT file and no lookup; description is thin.');
if (flag('dry')) { fs.rmSync(TMP, { recursive: true, force: true }); console.log(JSON.stringify(entry, null, 2)); process.exit(0); }
fs.rmSync(TMP, { recursive: true, force: true }); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(entry, null, 2) + '\n');
const v = spawnSync('node', [path.join(ROOT, 'tools/validate-catalog.mjs')], { encoding: 'utf8' }); process.stdout.write(v.stdout); process.stderr.write(v.stderr);
process.exit(v.status);
