#!/usr/bin/env node
// Flip ios/android status from the real stores. Dry run by default; --write saves. --downgrade lets live fall back to soon.
import fs from 'node:fs'; import path from 'node:path';
import { ROOT } from './lib/catalog.mjs';
const write = process.argv.includes('--write'), downgrade = process.argv.includes('--downgrade');
const dir = path.join(ROOT, 'catalog', 'apps'); let changes = 0;
const get = async (u, o) => { try { return await fetch(u, { redirect: 'follow', signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (app-store status check)' }, ...o }); } catch { return null; } };
export async function probeIos(appleId) { if (!appleId) return null; const r = await get(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&country=us`); if (!r || !r.ok) return null; const j = await r.json(); const x = (j.results || [])[0]; return x ? { live: true, url: (x.trackViewUrl || '').split('?')[0] } : { live: false }; }
export async function probePlay(pkg) { if (!pkg) return null; const url = `https://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`; const r = await get(url); if (!r) return null; return r.status === 200 ? { live: true, url } : r.status === 404 ? { live: false } : null; }
if (process.argv[1] && process.argv[1].endsWith('refresh-store-status.mjs')) {
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const p = path.join(dir, f), a = JSON.parse(fs.readFileSync(p, 'utf8')); let dirty = false;
    for (const [k, probe, id] of [['ios', probeIos, a.ios?.appleId], ['android', probePlay, a.android?.package]]) {
      const s = a[k]; if (!s) continue; const r = await probe(id); if (!r) continue;
      let next = s.status;
      if (r.live) { next = 'live'; if (r.url && s.url !== r.url) { s.url = r.url; dirty = true; } } else if (s.status === 'live' && downgrade) next = 'soon';
      if (next !== s.status) { console.log(`${a.slug} ${k}: ${s.status} -> ${next}`); s.status = next; dirty = true; changes++; }
      else if (s.status === 'live' && !r.live) console.log(`WARN ${a.slug} ${k}: marked live but store says not live (use --downgrade)`);
    }
    if (dirty && write) { a.updatedAt = a.updatedAt; fs.writeFileSync(p, JSON.stringify(a, null, 2) + '\n'); }
  }
  console.log(`${changes} status change(s)${write ? ' written' : ' (dry run)'}`);
}
