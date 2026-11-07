#!/usr/bin/env node
// Zero-dependency static generator. Writes dist/. Incremental: a file is rewritten only if its bytes changed.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { loadCatalog, ROOT } from './lib/catalog.mjs';
const sample = process.argv.includes('--sample');
const cat = loadCatalog({ sample });
const DIST = path.join(ROOT, 'dist');
const S = JSON.parse(fs.readFileSync(path.join(ROOT, 'site', 'strings', cat.config.locale + '.json'), 'utf8'));
const SITE = cat.config.siteUrl;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const catById = Object.fromEntries(cat.categories.map(c => [c.id, c]));
const bySlug = Object.fromEntries(cat.apps.map(a => [a.slug, a]));
const kindOf = a => (catById[a.categories[0]] || {}).kind || 'app';
const V = crypto.createHash('sha1').update(fs.readFileSync(path.join(ROOT, 'site', 'style.css'))).update(fs.readFileSync(path.join(ROOT, 'site', 'site.js'))).digest('hex').slice(0, 8);
const emitted = new Set(); let written = 0, skipped = 0;
function out(rel, data) {
  const p = path.join(DIST, rel); emitted.add(rel);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  try { if (fs.readFileSync(p).equals(buf)) { skipped++; return; } } catch {}
  fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, buf); written++;
}
// ---- markdown (small, safe) ----
function inline(s) { return esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\*(.+?)\*/g, '<em>$1</em>').replace(/\[([^\]]+)\]\((https:\/\/[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>'); }
function md(src = '') {
  const lines = String(src).replace(/\r/g, '').split('\n'); let h = '', list = false, para = [];
  const flush = () => { if (para.length) { h += '<p>' + inline(para.join(' ')) + '</p>'; para = []; } };
  for (const l of lines) {
    const hm = l.match(/^#{1,4}\s+(.*)$/); if (hm) { flush(); if (list) { h += '</ul>'; list = false; } h += '<h3>' + inline(hm[1]) + '</h3>'; continue; }
    if (/^\s*[-*] /.test(l)) { flush(); if (!list) { h += '<ul>'; list = true; } h += '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>'; continue; }
    if (list) { h += '</ul>'; list = false; }
    if (!l.trim()) flush(); else para.push(l.trim());
  }
  flush(); if (list) h += '</ul>'; return h;
}
// ---- PNG generator (gradient) ----
function crc32(b) { let c, crc = ~0; for (let i = 0; i < b.length; i++) { c = (crc ^ b[i]) & 255; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function chunk(t, d) { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); }
function png(w, h, fn) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; for (let x = 0; x < w; x++) { const [r, g, b] = fn(x / w, y / h); const o = y * (w * 4 + 1) + 1 + x * 4; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = 255; } }
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const grad = (u, v) => { const c = u * .5 + v * .5; const s = c < .55 ? mix([26, 17, 72], [38, 38, 143], c / .55) : mix([38, 38, 143], [28, 140, 190], (c - .55) / .45); const gl = Math.max(0, 1 - Math.hypot(u - .15, v - .1) * 2.2) * 70; return s.map(x => Math.min(255, Math.round(x + gl))); };
// ---- layout ----
const BRAND_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6a45f2"/><stop offset=".55" stop-color="#3f62f5"/><stop offset="1" stop-color="#12c0c0"/></linearGradient></defs><rect width="40" height="40" rx="10" fill="url(#bg)"/><path d="M20 8l3.4 7 7.6 1-5.6 5.3 1.4 7.6L20 25.2 13.2 28.9l1.4-7.6L9 16l7.6-1z" fill="#fff" opacity=".95"/></svg>';
function iconHtml(a, size = 64, eager) {
  const st = `style="--s:${size}px;--a:${esc(a.accent || '#5b4be8')}"`;
  if (a.icon && fs.existsSync(path.join(ROOT, a.icon))) return `<img class="icon" ${st} src="__R__${esc(a.icon)}" alt="" width="${size}" height="${size}"${eager ? '' : ' loading="lazy"'}>`;
  return `<span class="icon" ${st} aria-hidden="true">${esc(a.name[0])}</span>`;
}
function tile(a) { return `<a class="tile" href="__R__app/${a.slug}/">${iconHtml(a)}<span class="t"><b>${esc(a.name)}</b><small>${esc(a.subtitle)}</small></span>${a.ios.status === 'live' || a.android.status === 'live' ? '' : `<span class="badge">${S.comingSoon}</span>`}</a>`; }
function page({ depth, title, desc, path: pth, body, nav = '', json, og, noindex }) {
  const R = depth ? '../'.repeat(depth) : './';
  const t = title === S.today ? cat.config.siteName : `${title} | ${cat.config.siteName}`;
  const canon = SITE + pth; const ogImg = og ? SITE + og : SITE + 'og-default.png';
  const navItems = [['today', '', S.today], ['games', 'games/', S.games], ['apps', 'apps/', S.apps], ['search', 'search/', S.search]]
    .map(([k, h, n]) => `<a href="${R}${h}"${nav === k ? ' aria-current="page"' : ''}>${n}</a>`).join('');
  const html = `<!doctype html><html lang="${cat.config.locale}" data-base="${R}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(t)}</title><meta name="description" content="${esc(desc)}">${noindex ? '<meta name="robots" content="noindex">' : ''}<link rel="canonical" href="${canon}"><meta name="theme-color" content="#1a1148"><meta property="og:title" content="${esc(t)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:type" content="website"><meta property="og:url" content="${canon}"><meta property="og:image" content="${ogImg}"><meta name="twitter:card" content="summary_large_image"><link rel="manifest" href="${R}manifest.webmanifest"><link rel="icon" href="${R}icon-192.png"><link rel="apple-touch-icon" href="${R}icon-192.png"><link rel="stylesheet" href="${R}style.css?v=__V__">${json ? `<script type="application/ld+json">${JSON.stringify(json).replace(/</g, '\\u003c')}</script>` : ''}<script>try{var t=localStorage.getItem('ei-theme');if(t)document.documentElement.setAttribute('data-theme',t)}catch(e){}</script></head><body><a class="skip" href="#main">${S.skip}</a><header class="top"><div class="wrap bar"><a class="brand" href="${R}">${BRAND_SVG}<span><b>App Store</b><small>EqualInformation</small></span></a><nav class="main" aria-label="Primary">${navItems}</nav><button class="iconbtn theme" id="theme" type="button" aria-label="${S.theme}">&#9680;</button></div></header><main id="main" class="wrap">${body}</main><footer class="foot"><div class="wrap cols"><span>&copy; EqualInformation. ${S.footerTag}</span><nav aria-label="Footer"><a href="${R}about/">${S.about}</a><a href="${R}developer/">${S.developer}</a><a href="https://equalinformation.com/" rel="noopener">equalinformation.com</a></nav></div></footer><script>window.ASK_ENDPOINT=${JSON.stringify(cat.config.askEndpoint || '')};window.NO_RESULTS=${JSON.stringify(S.noResults)}</script><script src="${R}site.js?v=__V__" defer></script></body></html>`;
  return html.replace(/__R__/g, R).replace(/__V__/g, V);
}
const storeBtns = a => ['ios', 'android'].map(p => {
  const s = a[p], name = p === 'ios' ? S.appStore : S.googlePlay, pre = p === 'ios' ? S.downloadOn : S.getItOn;
  if (s.status === 'live') return `<a class="store" href="${esc(s.url)}" rel="noopener" target="_blank"><span><small>${pre}</small>${name}</span></a>`;
  return `<span class="store soon" aria-label="${name}: ${s.status === 'review' ? S.inReview : S.comingSoon}"><span><small>${name}</small>${s.status === 'review' ? S.inReview : S.comingSoon}</span></span>`;
}).join('');
const sortNew = (x, y) => (y.updatedAt + y.releasedAt).localeCompare(x.updatedAt + x.releasedAt);
const gradFor = a => `--g:linear-gradient(135deg,${a.accent || '#3b2bb8'},#1c5fb0)`;
function storyCard(s) {
  const first = bySlug[(s.appSlugs || [])[0]];
  return `<a class="story reveal" style="--g:linear-gradient(135deg,${esc(s.accent || '#26268f')},#1c5fb0)" href="${first ? `__R__app/${first.slug}/` : '__R__'}"><span class="kicker">${esc(s.kicker || '')}</span><h3>${esc(s.title)}</h3><p>${esc(s.subtitle || '')}</p></a>`;
}
const appGrid = list => `<div class="results">${list.map(tile).join('')}</div>`;
const row = list => `<div class="row">${list.map(tile).join('')}</div>`;
const sec = (title, inner, more) => `<div class="sec-head"><h2>${esc(title)}</h2>${more || ''}</div>${inner}`;

// ---- Today ----
{
  const feat = bySlug[cat.today.featured] || [...cat.apps].sort(sortNew)[0];
  let body = '';
  if (feat) {
    const heroImg = feat.hero && fs.existsSync(path.join(ROOT, feat.hero)) ? `<img class="bg" src="__R__${esc(feat.hero)}" alt="" fetchpriority="high">` : '';
    body += `<p class="kicker">${S.featured}</p><a class="hero-card reveal" style="${gradFor(feat)}" href="__R__app/${feat.slug}/">${heroImg}<span class="hero-in"><span><span class="kicker">${esc(feat.editorial?.headline ? S.today : feat.categories[0])}</span><h2>${esc(feat.editorial?.headline || feat.name)}</h2><p>${esc(feat.shortDescription)}</p></span><span class="pill-app">${iconHtml(feat, 52, 1)}<span><b>${esc(feat.name)}</b><small>${esc(feat.subtitle)}</small></span></span></span></a>`;
  }
  const stories = [...(cat.today.stories || [])].sort((a, b) => b.date.localeCompare(a.date));
  if (stories.length) body += sec(S.today, `<div class="grid">${stories.map(storyCard).join('')}</div>`);
  for (const c of cat.collections.slice(0, 6)) body += sec(c.title, row(c.appSlugs.map(s => bySlug[s]).filter(Boolean)), `<a href="__R__collection/${c.id}/">${S.allApps}</a>`);
  body += sec(S.newAndUpdated, appGrid([...cat.apps].sort(sortNew).slice(0, 24)));
  body += sec(S.categories, `<div class="grid">${cat.categories.map(c => `<a class="cat-card" style="--h:${c.hue || 250}" href="__R__category/${c.id}/"><b>${esc(c.name)}</b><p>${esc(c.blurb || '')}</p></a>`).join('')}</div>`);
  out('index.html', page({ depth: 0, title: S.today, desc: 'Discover games and apps from EqualInformation: free, with ads and an optional monthly ad-free plan.', path: '', body, nav: 'today', og: 'og-default.png' }));
}
// ---- Games / Apps / categories / collections ----
function listing(kind, label, pth) {
  const apps = cat.apps.filter(a => kindOf(a) === kind).sort(sortNew);
  const cats = cat.categories.filter(c => c.kind === kind);
  const body = `<h1>${label}</h1><div class="cats">${cats.map(c => `<a class="chip" href="__R__category/${c.id}/">${esc(c.name)}</a>`).join('')}</div>` + sec(S.newAndUpdated, appGrid(apps.slice(0, 48))) + cats.map(c => { const l = apps.filter(a => a.categories.includes(c.id)); return l.length ? sec(c.name, row(l.slice(0, 20)), `<a href="__R__category/${c.id}/">${S.allApps}</a>`) : ''; }).join('');
  out(pth + 'index.html', page({ depth: 1, title: label, desc: `${label} from EqualInformation.`, path: pth, body, nav: kind === 'game' ? 'games' : 'apps' }));
}
listing('game', S.games, 'games/'); listing('app', S.apps, 'apps/');
const PAGE = 120;
function paged(base, title, desc, sub, list, nav) {
  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  for (let i = 0; i < pages; i++) {
    const p = i ? `${base}page/${i + 1}/` : base, depth = p.split('/').filter(Boolean).length, R = '../'.repeat(depth);
    const pager = pages > 1 ? `<nav class="cats" aria-label="Pages">${Array.from({ length: pages }, (_, k) => `<a class="chip" href="${R}${k ? `${base}page/${k + 1}/` : base}"${k === i ? ' aria-current="page"' : ''}>${k + 1}</a>`).join('')}</nav>` : '';
    out(p + 'index.html', page({ depth, title, desc, path: p, nav, body: `<h1>${esc(title)}</h1><p class="lede">${esc(sub)}</p>${appGrid(list.slice(i * PAGE, (i + 1) * PAGE))}${pager}` }));
  }
}
for (const c of cat.categories) paged(`category/${c.id}/`, c.name, `${c.name} apps and games from EqualInformation.`, c.blurb || '', cat.apps.filter(a => a.categories.includes(c.id)).sort(sortNew), c.kind === 'game' ? 'games' : 'apps');
for (const c of cat.collections) paged(`collection/${c.id}/`, c.title, c.subtitle || c.title, c.subtitle || '', c.appSlugs.map(s => bySlug[s]).filter(Boolean), '');
// ---- app pages ----
for (const a of cat.apps) {
  const c0 = catById[a.categories[0]];
  const shots = a.screenshots || [];
  const shotsHtml = ['phone', 'tablet'].map(dv => { const l = shots.filter(s => s.device === dv); return l.length ? `<div class="shots ${dv}" tabindex="0" role="region" aria-label="${S.screenshots} (${dv})">${l.map(s => `<figure><img src="__R__${esc(s.src)}" alt="${esc(s.caption || a.name)}" loading="lazy" decoding="async">${s.caption ? `<figcaption>${esc(s.caption)}</figcaption>` : ''}</figure>`).join('')}</div>` : ''; }).join('');
  const hero = a.hero && fs.existsSync(path.join(ROOT, a.hero)) ? `<img class="hero-img" src="__R__${esc(a.hero)}" alt="${esc(a.name)}" fetchpriority="high">` : '';
  const rel = (a.related || []).map(s => bySlug[s]).filter(Boolean);
  const more = cat.apps.filter(x => x.slug !== a.slug && !rel.includes(x) && x.categories[0] === a.categories[0]).slice(0, 6);
  const info = [[S.seller, a.developer], [S.price, a.price], [S.category, c0 ? c0.name : ''], [S.age, a.ageRating], [S.released, a.releasedAt], [S.updated, a.updatedAt], a.version ? [S.version, a.version] : null].filter(Boolean).map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  const body = `<section class="app-head reveal" style="--a:${esc(a.accent || '#5b4be8')}">${iconHtml(a, 128, 1)}<div><h1>${esc(a.name)}</h1><p class="sub">${esc(a.subtitle)}</p><div class="btns">${storeBtns(a)}</div></div></section>${hero}
  ${shotsHtml ? `<h2>${S.screenshots}</h2>${shotsHtml}` : ''}
  <div class="two"><div class="prose"><h2>${S.description}</h2>${md(a.longDescription)}<p class="callout">${esc(a.monetization)}. ${S.adNote}</p>${a.editorial?.story ? `<h2>${esc(a.editorial.headline || '')}</h2>${md(a.editorial.story)}` : ''}${a.whatsNew ? `<h2>${S.whatsNew}</h2>${md(a.whatsNew)}` : ''}</div>
  <aside><h2>${S.info}</h2><dl class="info">${info}</dl><p>${a.privacyUrl ? `<a href="${esc(a.privacyUrl)}" rel="noopener">${S.privacy}</a>` : ''}${a.supportUrl ? ` &middot; <a href="${esc(a.supportUrl)}" rel="noopener">${S.support}</a>` : ''}</p>${(a.tags || []).length ? `<div class="cats">${a.tags.map(t => `<a class="chip" href="__R__search/?q=${encodeURIComponent(t)}">${esc(t)}</a>`).join('')}</div>` : ''}</aside></div>
  ${rel.length ? sec(S.related, row(rel)) : ''}${more.length ? sec(S.moreFrom, row(more)) : ''}`;
  const ld = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: a.name, description: a.shortDescription, applicationCategory: c0 && c0.kind === 'game' ? 'GameApplication' : 'UtilitiesApplication', operatingSystem: [a.ios.status === 'live' ? 'iOS' : null, a.android.status === 'live' ? 'Android' : null].filter(Boolean).join(', ') || 'iOS, Android', offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, author: { '@type': 'Organization', name: a.developer, url: cat.config.developerUrl }, datePublished: a.releasedAt, dateModified: a.updatedAt, image: a.icon ? SITE + a.icon : undefined, contentRating: a.ageRating, url: SITE + `app/${a.slug}/` };
  out(`app/${a.slug}/index.html`, page({ depth: 2, title: `${a.name}: ${a.subtitle}`, desc: a.shortDescription, path: `app/${a.slug}/`, body, nav: kindOf(a) === 'game' ? 'games' : 'apps', json: ld, og: a.hero && fs.existsSync(path.join(ROOT, a.hero)) ? a.hero : undefined }));
}
// ---- search (sharded index) ----
{
  const SHARD = 500;
  const recs = cat.apps.map(a => ({ s: a.slug, n: a.name, t: a.subtitle, k: kindOf(a), c: a.categories.map(x => (catById[x] || {}).name || x), g: a.tags || [], d: a.shortDescription, i: a.icon && fs.existsSync(path.join(ROOT, a.icon)) ? a.icon : '', a: a.accent || '' }));
  const n = Math.max(1, Math.ceil(recs.length / SHARD));
  for (let i = 0; i < n; i++) out(`search-index-${i}.json`, JSON.stringify(recs.slice(i * SHARD, (i + 1) * SHARD)));
  out('search-index.json', JSON.stringify({ shards: n, count: recs.length, synonyms: cat.synonyms }));
  const sugg = ['a calm puzzle for the plane', 'games like ' + (cat.apps[0]?.name || 'puzzle'), 'play offline', 'brain training', 'for kids'];
  const body = `<h1>${S.search}</h1><p class="lede">Type to search instantly, or press Ask to describe what you want in your own words.</p><form id="sform" class="searchbox" role="search"><input id="q" type="search" autocomplete="off" placeholder="${esc(S.askPlaceholder)}" aria-label="${S.searchPlaceholder}"><button type="submit">${S.ask}</button></form><div class="sugg">${sugg.map(s => `<button type="button">${esc(s)}</button>`).join('')}</div><div id="answer" class="answer" hidden aria-live="polite"></div><div id="results" class="results" aria-live="polite"></div><noscript><p>Search needs JavaScript. Browse <a href="__R__apps/">Apps</a> or <a href="__R__games/">Games</a>.</p></noscript>`;
  out('search/index.html', page({ depth: 1, title: S.search, desc: 'Search and ask the EqualInformation App Store.', path: 'search/', body, nav: 'search' }));
}
// ---- static pages ----
out('developer/index.html', page({ depth: 1, title: S.developer, desc: 'Apps by EqualInformation.', path: 'developer/', body: `<h1>EqualInformation</h1><p class="lede">We make useful, friendly apps and games. Everything here is ours.</p>${sec(S.allApps, appGrid([...cat.apps].sort(sortNew)))}<p><a href="https://equalinformation.com/" rel="noopener">equalinformation.com</a></p>` }));
out('about/index.html', page({ depth: 1, title: S.about, desc: 'About the EqualInformation App Store.', path: 'about/', nav: '', body: `<h1>${S.about}</h1><div class="prose"><p>This is the EqualInformation App Store: a home for the apps and games we build ourselves. Every app is free with ads, with an optional monthly plan that removes them.</p><p>Store buttons appear only when an app is live on the App Store or Google Play. Until then you will see "Coming soon", never a dead link.</p><p>Search understands plain language: try "a calm puzzle for the plane" or "games like Sample Pebbles".</p></div>` }));
out('404.html', page({ depth: 0, title: 'Not found', desc: 'Page not found.', path: '404.html', noindex: true, body: `<h1>Page not found</h1><p class="lede">That page moved or never existed. <a href="__R__">Back to Today</a> or <a href="__R__search/">search</a>.</p>` }).replace('href="./style.css', 'href="/app-store/style.css').replace('src="./site.js', 'src="/app-store/site.js'));
out('offline.html', page({ depth: 0, title: 'Offline', desc: S.offline, path: 'offline.html', noindex: true, body: `<h1>${S.offline}</h1>` }));
// ---- seo / pwa ----
const urls = [...emitted].filter(f => f.endsWith('index.html')).map(f => f.replace(/index\.html$/, ''));
out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.filter(u => !/page\/\d+\/$/.test(u) || true).map(u => `<url><loc>${SITE}${u}</loc></url>`).join('')}</urlset>`);
out('robots.txt', `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);
out('manifest.webmanifest', JSON.stringify({ name: cat.config.siteName, short_name: cat.config.shortName, start_url: './', scope: './', display: 'standalone', background_color: '#090b1c', theme_color: '#1a1148', icons: [{ src: 'icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }] }));
out('icon-192.png', png(192, 192, grad)); out('icon-512.png', png(512, 512, grad)); out('og-default.png', png(1200, 630, grad));
for (const f of ['style.css', 'site.js']) out(f, fs.readFileSync(path.join(ROOT, 'site', f)));
// assets (copy referenced app assets only)
function copyDir(src, rel) { if (!fs.existsSync(src)) return; for (const e of fs.readdirSync(src, { withFileTypes: true })) { const s = path.join(src, e.name), r = rel + '/' + e.name; if (e.isDirectory()) copyDir(s, r); else if (!e.name.startsWith('.')) out(r, fs.readFileSync(s)); } }
copyDir(path.join(ROOT, 'assets'), 'assets');
// version + service worker
const htmlSig = crypto.createHash('sha1'); for (const f of [...emitted].sort()) { if (f.endsWith('.html') || f.endsWith('.css') || f.endsWith('.js') || f.endsWith('.json')) htmlSig.update(f + fs.readFileSync(path.join(DIST, f)).length); }
const swSrc = `const V='ei-${V}-${htmlSig.digest('hex').slice(0, 8)}';
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(['./','offline.html','style.css','site.js'])).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
e.respondWith(caches.open(V).then(async c=>{const hit=await c.match(r);const net=fetch(r).then(res=>{if(res.ok)c.put(r,res.clone());return res}).catch(()=>null);
if(hit)return hit;const res=await net;if(res)return res;if(r.mode==='navigate')return c.match('offline.html');return Response.error()}))});`;
out('sw.js', swSrc);
// prune stale files from dist
(function prune(dir, rel) { if (!fs.existsSync(dir)) return; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { prune(path.join(dir, e.name), r); try { fs.rmdirSync(path.join(dir, e.name)); } catch {} } else if (!emitted.has(r)) fs.unlinkSync(path.join(dir, e.name)); } })(DIST, '');
console.log(`built ${cat.apps.length} apps${cat.sample ? ' (sample)' : ''}: ${emitted.size} files, ${written} written, ${skipped} unchanged -> dist/`);
