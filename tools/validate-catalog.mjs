#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { loadCatalog, ROOT } from './lib/catalog.mjs';
const cat = loadCatalog({ sample: process.argv.includes('--sample') });
const errs = [];
const err = (w, m) => errs.push(w + ': ' + m);
const catIds = new Set(cat.categories.map(c => c.id));
const slugs = new Set();
const isStr = v => typeof v === 'string' && v.trim() !== '';
const date = v => /^\d{4}-\d{2}-\d{2}$/.test(v || '');
const host = (u, h) => { try { const x = new URL(u); return x.protocol === 'https:' && h.some(y => x.hostname === y); } catch { return false; } };
for (const c of cat.categories) { if (!/^[a-z0-9-]+$/.test(c.id || '')) err('categories', 'bad id ' + c.id); if (!isStr(c.name)) err(c.id, 'name'); if (!['game', 'app'].includes(c.kind)) err(c.id, 'kind must be game|app'); }
for (const a of cat.apps) {
  const w = a._file;
  if (!/^[a-z0-9-]+$/.test(a.slug || '') || a._file !== a.slug + '.json') err(w, 'slug must match file name and be [a-z0-9-]+');
  if (slugs.has(a.slug)) err(w, 'duplicate slug'); slugs.add(a.slug);
  for (const k of ['name', 'subtitle', 'shortDescription', 'longDescription', 'price', 'monetization', 'ageRating', 'icon']) if (!isStr(a[k])) err(w, 'missing ' + k);
  if (a.developer !== 'EqualInformation') err(w, 'developer must be EqualInformation');
  if (a.price !== 'Free') err(w, 'price must be Free');
  if (isStr(a.monetization) && !/ads/i.test(a.monetization)) err(w, 'monetization must disclose ads');
  if (isStr(a.shortDescription) && a.shortDescription.length > 160) err(w, 'shortDescription > 160 chars');
  if (!Array.isArray(a.categories) || !a.categories.length) err(w, 'categories needs >=1'); else for (const c of a.categories) if (!catIds.has(c)) err(w, 'unknown category ' + c);
  if (!date(a.releasedAt)) err(w, 'releasedAt YYYY-MM-DD'); if (!date(a.updatedAt)) err(w, 'updatedAt YYYY-MM-DD');
  if (a.accent && !/^#[0-9a-fA-F]{6}$/.test(a.accent)) err(w, 'accent #rrggbb');
  for (const [p, hs] of [['ios', ['apps.apple.com']], ['android', ['play.google.com']]]) {
    const s = a[p]; if (!s || !['live', 'review', 'soon'].includes(s.status)) { err(w, p + '.status live|review|soon'); continue; }
    if (s.status === 'live' && !host(s.url, hs)) err(w, p + ' live requires https url on ' + hs[0]);
  }
  for (const k of ['privacyUrl', 'supportUrl']) if (a[k] && !/^https:\/\//.test(a[k])) err(w, k + ' must be https');
  for (const s of a.screenshots || []) { if (!isStr(s.src) || !['phone', 'tablet'].includes(s.device)) err(w, 'screenshot needs src and device phone|tablet'); }
  if (!cat.sample) for (const f of [a.icon, a.hero, ...(a.screenshots || []).map(s => s.src)].filter(Boolean)) if (!fs.existsSync(path.join(ROOT, f))) err(w, 'missing file ' + f);
  if (JSON.stringify(a).match(/equalinformation-studio|ghp_|secret|api[_-]?key/i)) err(w, 'contains forbidden internal/secret text');
}
for (const a of cat.apps) for (const r of a.related || []) if (!slugs.has(r)) err(a._file, 'related unknown slug ' + r);
for (const c of cat.collections) { if (!/^[a-z0-9-]+$/.test(c.id || '') || !isStr(c.title)) err('collections', 'bad collection ' + c.id); for (const s of c.appSlugs || []) if (!slugs.has(s)) err('collection ' + c.id, 'unknown slug ' + s); }
if (cat.today.featured && !slugs.has(cat.today.featured)) err('today', 'featured unknown slug');
for (const s of cat.today.stories || []) { if (!isStr(s.id) || !isStr(s.title) || !date(s.date)) err('today', 'story needs id,title,date: ' + s.id); for (const x of s.appSlugs || []) if (!slugs.has(x)) err('today ' + s.id, 'unknown slug ' + x); }
if (errs.length) { console.error(errs.join('\n')); console.error(`\n${errs.length} error(s)`); process.exit(1); }
console.log(`catalog OK: ${cat.apps.length} apps${cat.sample ? ' (sample)' : ''}, ${cat.categories.length} categories, ${cat.collections.length} collections, ${(cat.today.stories || []).length} stories`);
