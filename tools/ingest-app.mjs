#!/usr/bin/env node
// Create/update catalog/apps/<slug>.json + optimised assets/apps/<slug>/ from the publish-program sources of truth.
// Usage: node tools/ingest-app.mjs <slug> [--name "App Name"] [--apple-id N] [--package pkg] [--bundle id] [--category puzzle,casual]
//        [--assets DIR] [--no-probe] [--dry] [--cc DIR] [--sources-only]
// Sources (command-center, default ~/coding_common/pvt/command-center, override --cc or env CC_DIR):
//   docs/tasks/publish-program/STATUS.md (row for the game), publish-program/play-packets/<slug>.md,
//   docs/tasks/<SLUG>-STORE-TEXT.md (slug upper, hyphens removed or kept), publish-program/assets/<slug>/store*/ (art).
// Existing hand-edited fields (editorial, related, tags, accent, categories) are kept; everything else is refreshed.
// Needs: macOS sips and/or cwebp for image optimisation (falls back to copying). Prints a reviewable diff summary.
import fs from 'node:fs'; import path from 'node:path'; import os from 'node:os'; import { execFileSync, spawnSync } from 'node:child_process';
import { ROOT } from './lib/catalog.mjs';
import { probeIos, probePlay } from './refresh-store-status.mjs';
const argv = process.argv.slice(2); const slug = argv.find(a => !a.startsWith('--') && !argv[argv.indexOf(a) - 1]?.startsWith('--'));
const opt = k => { const i = argv.indexOf('--' + k); return i > -1 ? argv[i + 1] : undefined; }, flag = k => argv.includes('--' + k);
if (!slug || !/^[a-z0-9-]+$/.test(slug)) { console.error('usage: ingest-app.mjs <slug> [options] (see header)'); process.exit(2); }
const CC = opt('cc') || process.env.CC_DIR || path.join(os.homedir(), 'coding_common/pvt/command-center');
const T = path.join(CC, 'docs/tasks'), PP = path.join(T, 'publish-program');
const rd = p => fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const outFile = path.join(ROOT, 'catalog/apps', slug + '.json');
const old = fs.existsSync(outFile) ? JSON.parse(rd(outFile)) : {};
const textFile = [slug.toUpperCase(), slug.replace(/-/g, '').toUpperCase()].map(n => path.join(T, n + '-STORE-TEXT.md')).find(fs.existsSync);
const text = rd(textFile || ''), packet = rd(path.join(PP, 'play-packets', slug + '.md'));
const field = (re, s = text) => (s.match(re) || [])[1]?.trim();
// STATUS row
const status = rd(path.join(PP, 'STATUS.md')).split('\n').filter(l => /^\|\s*\d+\s*\|/.test(l)).map(l => l.split('|').map(c => c.trim())).find(c => norm(c[2].replace(/\(.*\)/, '')) === norm(opt('name') || slug)) || [];
const rowText = status.join(' ');
const name = opt('name') || old.name || field(/^Name[^`\n]*`([^`]+)`/m)?.split(':')[0].trim() || status[2]?.replace(/\(.*\)/, '').trim() || slug;
const fullName = field(/^Name[^`\n]*`([^`]+)`/m) || name;
const subtitle = field(/^Subtitle[^`\n]*`([^`]+)`/m) || old.subtitle || (fullName.includes(':') ? fullName.split(':')[1].trim() : '');
const promo = field(/^Promo text[^`\n]*`([^`]+)`/m);
const keywords = (field(/^Keywords[^`\n]*`([^`]+)`/m) || '').split(',').map(s => s.trim()).filter(Boolean);
const whatsNew = field(/^What's New[^`\n]*`([^`]+)`/m) || old.whatsNew || '';
const descBlock = (text.match(/^Description[^\n]*\n```\n([\s\S]*?)\n```/m) || [])[1] || '';
const catLine = field(/^Category:\s*(.+)$/m) || '';
const MAP = { puzzle: 'puzzle', casual: 'casual', board: 'board-strategy', strategy: 'board-strategy', word: 'word', music: 'music', sports: 'sports', education: 'education', health: 'health', utilities: 'utilities', lifestyle: 'lifestyle' };
let categories = opt('category')?.split(',') || old.categories || [...new Set((catLine.match(/[A-Za-z]+/g) || []).map(w => MAP[w.toLowerCase()]).filter(Boolean))];
if (!categories.length) categories = ['casual'];
const ageRating = old.ageRating || (field(/Age rating:\s*([0-9]+\+)/) || '4+');
const pkg = opt('package') || old.android?.package || field(/applicationId:\s*`([^`]+)`/, packet) || field(/Package[^`\n]*`([a-z0-9._]+)`/i, packet) || '';
const bundle = opt('bundle') || old.ios?.bundleId || (rowText.match(/bundle (com\.[a-z0-9.]+)/i) || [])[1] || pkg;
const appleId = opt('apple-id') || old.ios?.appleId || (rowText + text).match(/ASC app (\d{9,10})/)?.[1] || (rowText.match(/\bid(\d{9,10})\b/) || [])[1] || '';
const privacyUrl = field(/(https:\/\/equalinformation\.com\/privacy-[a-z0-9-]+\.html)/) || old.privacyUrl, supportUrl = field(/(https:\/\/equalinformation\.com\/app-support-[a-z0-9-]+\.html)/) || old.supportUrl;
// description: keep web-safe markdown, drop store boilerplate sections
const longDescription = old.longDescription && flag('keep-text') ? old.longDescription : descBlock.split('\n').map(l => /^[A-Z][A-Z0-9 ,&'!-]{5,}$/.test(l.trim()) ? '**' + l.trim().replace(/\b(\w)(\w*)/g, (_, a, b) => a + b.toLowerCase()) + '**' : l).join('\n').trim() || old.longDescription || promo || '';
const shortDescription = (promo || old.shortDescription || longDescription.split('\n')[0] || '').slice(0, 160);
// store status
let ios = { status: old.ios?.status || (/WAITING|IN_REVIEW|SUBMITTED/i.test(status[9] || '') ? 'review' : 'soon'), url: old.ios?.url || '', appleId, bundleId: bundle };
let android = { status: old.android?.status || (/SUBMITTED|review/i.test(status[10] || '') ? 'review' : 'soon'), url: old.android?.url || '', package: pkg };
if (!flag('no-probe')) {
  const i = await probeIos(appleId); if (i?.live) { ios.status = 'live'; ios.url = i.url || ios.url; }
  const p = await probePlay(pkg); if (p?.live) { android.status = 'live'; android.url = p.url; }
}
// assets
const adir = path.join(ROOT, 'assets/apps', slug), arel = `assets/apps/${slug}`;
const srcRoot = opt('assets') || path.join(PP, 'assets', slug);
const storeDirs = fs.existsSync(srcRoot) ? fs.readdirSync(srcRoot).filter(d => /^store/.test(d) && fs.statSync(path.join(srcRoot, d)).isDirectory()) : [];
const rank = d => (/android/.test(d) ? 0 : 1) * 100 + (+(d.match(/\d+/) || [0])[0]);
storeDirs.sort((a, b) => rank(b) - rank(a));
const find = (sub, re) => { for (const d of storeDirs) { const dir = path.join(srcRoot, d, sub); if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).filter(x => re.test(x)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map(x => path.join(dir, x)); if (f.length) return f; } } return []; };
const findFile = re => { for (const d of [...storeDirs, '']) { const dir = path.join(srcRoot, d); if (fs.existsSync(dir)) { const f = fs.readdirSync(dir).filter(x => re.test(x)).sort().reverse()[0]; if (f) return path.join(dir, f); } } return null; };
const cwebp = spawnSync('which', ['cwebp']).status === 0;
function img(src, dest, w, q = 80) { // writes dest (.webp via cwebp, else resized copy)
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (dest.endsWith('.webp') && cwebp) execFileSync('cwebp', ['-quiet', '-q', String(q), '-resize', String(w), '0', src, '-o', dest]);
  else if (spawnSync('which', ['sips']).status === 0) execFileSync('sips', ['-Z', String(w), src, '--out', dest], { stdio: 'ignore' });
  else fs.copyFileSync(src, dest);
}
let icon = old.icon, hero = old.hero, screenshots = old.screenshots || [];
if (!flag('dry') && storeDirs.length) {
  const ic = findFile(/^icon-512\.png$/) || findFile(/^icon.*(1024|512)\.png$/) || findFile(/^icon.*\.png$/);
  if (ic) { img(ic, path.join(adir, 'icon-512.png'), 512); icon = `${arel}/icon-512.png`; }
  const fg = findFile(/^feature.*\.(png|jpg)$/); if (fg) { img(fg, path.join(adir, 'hero.webp'), 1600); hero = `${arel}/hero.webp`; }
  const ph = find('iphone', /\.png$/).length ? find('iphone', /\.png$/) : find('phone', /\.png$/), tb = find('ipad', /\.png$/);
  screenshots = [];
  ph.slice(0, 8).forEach((s, i) => { img(s, path.join(adir, `shot-${i + 1}.webp`), 640, 78); screenshots.push({ src: `${arel}/shot-${i + 1}.webp`, device: 'phone', caption: old.screenshots?.[i]?.caption || '' }); });
  tb.slice(0, 4).forEach((s, i) => { img(s, path.join(adir, `tablet-${i + 1}.webp`), 1000, 78); screenshots.push({ src: `${arel}/tablet-${i + 1}.webp`, device: 'tablet', caption: '' }); });
}
const today = new Date().toISOString().slice(0, 10);
const entry = {
  slug, name, subtitle, categories, tags: old.tags?.length ? old.tags : [...new Set([...keywords, ...(/offline/i.test(longDescription) ? ['offline'] : [])])].slice(0, 12),
  developer: 'EqualInformation', shortDescription, longDescription, whatsNew, price: 'Free', monetization: 'Free with ads, optional monthly ad-free', ageRating,
  ...(privacyUrl && { privacyUrl }), ...(supportUrl && { supportUrl }), releasedAt: old.releasedAt || today, updatedAt: today, version: old.version || '1.0.0',
  icon: icon || `${arel}/icon-512.png`, ...(hero && { hero }), ...(old.accent && { accent: old.accent }), screenshots, ios, android,
  related: old.related || [], ...(old.editorial && { editorial: old.editorial }),
};
const same = JSON.stringify({ ...entry, updatedAt: 0 }) === JSON.stringify({ ...old, updatedAt: 0 });
if (same) entry.updatedAt = old.updatedAt;
console.log(`${slug}: ${name} | ${categories.join(',')} | ios=${ios.status}${appleId ? '(' + appleId + ')' : ''} android=${android.status} | shots=${screenshots.length} | text=${textFile ? path.basename(textFile) : 'MISSING'} | ${same ? 'unchanged' : old.slug ? 'updated' : 'new'}`);
if (!textFile) console.log('WARN: no STORE-TEXT file; description is thin. Review the entry.');
if (flag('dry')) { console.log(JSON.stringify(entry, null, 2)); process.exit(0); }
fs.mkdirSync(path.dirname(outFile), { recursive: true }); fs.writeFileSync(outFile, JSON.stringify(entry, null, 2) + '\n');
const v = spawnSync('node', [path.join(ROOT, 'tools/validate-catalog.mjs')], { encoding: 'utf8' }); process.stdout.write(v.stdout); process.stderr.write(v.stderr);
process.exit(v.status);
