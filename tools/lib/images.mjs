// Image pipeline: webp width variants, blur-up placeholders, per-app Open Graph images.
// Needs `cwebp` (brew install webp / apt install webp). Without it the originals are served unchanged.
// OG images additionally need Chrome/Chromium + ffmpeg; without them the site default OG image is used.
// Generated files are cached in .cache/ (gitignored) keyed by content hash, so unchanged images cost nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import { ROOT } from './catalog.mjs';

const CACHE = path.join(ROOT, '.cache');
export const WIDTHS = [320, 640, 960, 1440];
const sha = b => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const has = cmd => spawnSync(cmd, ['-version'], { stdio: 'ignore' }).status === 0 || spawnSync(cmd, ['-h'], { stdio: 'ignore' }).status === 0;
export const HAVE_CWEBP = (() => { try { return spawnSync('cwebp', ['-version'], { stdio: 'ignore' }).status === 0; } catch { return false; } })();

export function dims(buf) {
  if (buf.slice(1, 4).toString() === 'PNG') return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') {
    const t = buf.slice(12, 16).toString();
    if (t === 'VP8X') return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (t === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    if (t === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) { let i = 2; while (i < buf.length) { if (buf[i] !== 0xff) { i++; continue; } const m = buf[i + 1]; if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) }; i += 2 + buf.readUInt16BE(i + 2); } }
  return { w: 0, h: 0 };
}

function cwebp(src, w, q, outFile) {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const r = spawnSync('cwebp', ['-quiet', '-q', String(q), '-m', '4', '-resize', String(w), '0', src, '-o', outFile]);
  return r.status === 0 && fs.existsSync(outFile);
}

const memo = new Map();
/**
 * Returns { w, h, lqip, variants:[{w, rel}], fallback } for a catalog asset path (e.g. assets/apps/x/hero.webp).
 * `emit(rel, buffer)` writes into dist. Variants are emitted next to the original as <name>-<w>.webp.
 */
export function imageInfo(srcRel, emit, { widths = WIDTHS, q = 78 } = {}) {
  const key = srcRel + '|' + widths.join(',');
  if (memo.has(key)) return memo.get(key);
  const abs = path.join(ROOT, srcRel); const buf = fs.readFileSync(abs); const { w, h } = dims(buf);
  const info = { w, h, lqip: '', variants: [], fallback: srcRel };
  if (HAVE_CWEBP && w > 0) {
    const id = sha(buf); const stem = srcRel.replace(/\.[a-z0-9]+$/i, '');
    const ws = [...new Set(widths.filter(x => x < w).concat([Math.min(w, widths[widths.length - 1])]))].sort((a, b) => a - b);
    for (const vw of ws) {
      const cf = path.join(CACHE, 'img', `${id}-${vw}.webp`);
      if (!fs.existsSync(cf) && !cwebp(abs, vw, q, cf)) continue;
      const rel = `${stem}-${vw}.webp`; emit(rel, fs.readFileSync(cf)); info.variants.push({ w: vw, rel });
    }
    const lf = path.join(CACHE, 'img', `${id}-lq.webp`);
    if (!fs.existsSync(lf)) cwebp(abs, 20, 30, lf);
    if (fs.existsSync(lf)) info.lqip = 'data:image/webp;base64,' + fs.readFileSync(lf).toString('base64');
    if (info.variants.length) info.fallback = info.variants[Math.min(1, info.variants.length - 1)].rel;
  } else if (!/\.png$/i.test(srcRel)) emit(srcRel, buf); else emit(srcRel, buf);
  memo.set(key, info); return info;
}
export const srcset = (info, R) => info.variants.map(v => `${R}${v.rel} ${v.w}w`).join(', ');

// ---- Open Graph images (1200x630 JPEG), generated with headless Chrome + ffmpeg ----
function findChrome() {
  const c = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  return c.find(p => fs.existsSync(p));
}
const CHROME = findChrome();
export const HAVE_OG = !!(CHROME && spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Generates OG JPEGs for many items concurrently. items: [{key,name,subtitle,accent,heroAbs,iconAbs,siteName}] -> Map(key -> Buffer|null) */
export async function ogImages(items, concurrency = 4) {
  const res = new Map(); if (!HAVE_OG) return res;
  fs.mkdirSync(path.join(CACHE, 'og'), { recursive: true });
  const jobs = items.map(o => {
    const parts = [o.name, o.subtitle, o.accent, o.siteName, 'v2'];
    for (const f of [o.heroAbs, o.iconAbs]) if (f && fs.existsSync(f)) parts.push(sha(fs.readFileSync(f)));
    const id = sha(parts.join('|')); return { o, id, jf: path.join(CACHE, 'og', id + '.jpg') };
  });
  const todo = jobs.filter(j => !fs.existsSync(j.jf)); let next = 0;
  const run = j => new Promise(done => {
    const { o, id, jf } = j; const toUri = f => f && fs.existsSync(f) ? 'file://' + f : '';
    const a = o.accent || '#3b2bb8', name = o.name;
    const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box;margin:0}html,body{width:1200px;height:630px;overflow:hidden;font-family:-apple-system,"Helvetica Neue",Arial,sans-serif}
body{background:linear-gradient(135deg,${esc(a)},#1c2a7a);position:relative;color:#fff}
.bg{position:absolute;inset:0;background:url("${toUri(o.heroAbs)}") center/cover}
.sh{position:absolute;inset:0;background:linear-gradient(90deg,rgba(8,8,40,.92) 0%,rgba(8,8,40,.72) 45%,rgba(8,8,40,.15) 100%)}
.c{position:absolute;left:72px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;gap:22px;max-width:700px}
.ic{width:150px;height:150px;border-radius:34px;box-shadow:0 14px 40px rgba(0,0,0,.5);background:url("${toUri(o.iconAbs)}") center/cover}
h1{font-size:${name.length > 14 ? 74 : 92}px;line-height:1.02;letter-spacing:-.02em;font-weight:800}
p{font-size:36px;line-height:1.2;opacity:.9}
.f{position:absolute;left:72px;bottom:44px;font-size:24px;letter-spacing:.16em;text-transform:uppercase;opacity:.85;font-weight:700}</style>
<div class="bg"></div><div class="sh"></div><div class="c"><div class="ic"></div><h1>${esc(name)}</h1><p>${esc(o.subtitle)}</p></div><div class="f">${esc(o.siteName)}</div>`;
    const hf = path.join(CACHE, 'og', id + '.html'), pf = path.join(CACHE, 'og', id + '.png'); fs.writeFileSync(hf, html);
    const udd = fs.mkdtempSync(path.join(CACHE, 'og', 'prof-'));
    const ch = spawn(CHROME, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files', '--force-device-scale-factor=1', '--window-size=1200,630', '--user-data-dir=' + udd, '--screenshot=' + pf, 'file://' + hf], { stdio: 'ignore' });
    const kill = setTimeout(() => ch.kill('SIGKILL'), 60000);
    let fd = false; const fin = () => { if (fd) return; fd = true; clearTimeout(kill); try { ch.kill('SIGKILL'); } catch {} if (fs.existsSync(pf)) spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', pf, '-vf', 'scale=1200:630', '-q:v', '5', jf]); fs.rmSync(hf, { force: true }); fs.rmSync(pf, { force: true }); setTimeout(() => { try { fs.rmSync(udd, { recursive: true, force: true, maxRetries: 3 }); } catch {} }, 1500); done(); };
    ch.on('exit', fin);
    // headless Chrome lingers ~10s after writing the file: finish as soon as the screenshot exists
    const poll = setInterval(() => { if (fs.existsSync(pf) && fs.statSync(pf).size > 1000) { clearInterval(poll); setTimeout(() => { fin(); }, 300); } }, 200); ch.on('exit', () => clearInterval(poll));
  });
  await Promise.all(Array.from({ length: concurrency }, async () => { while (next < todo.length) await run(todo[next++]); }));
  for (const j of jobs) res.set(j.o.key, fs.existsSync(j.jf) ? fs.readFileSync(j.jf) : null);
  return res;
}
