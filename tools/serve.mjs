#!/usr/bin/env node
// Serve dist/ under /app-store/ (mirrors production path). Usage: node tools/serve.mjs [port]
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { ROOT } from './lib/catalog.mjs';
const port = +process.argv[2] || 0, DIST = path.join(ROOT, 'dist');
const T = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.webmanifest': 'application/manifest+json' };
const srv = http.createServer((q, r) => {
  let u = decodeURIComponent(new URL(q.url, 'http://x').pathname); if (!u.startsWith('/app-store/')) { r.writeHead(302, { location: '/app-store/' }); return r.end(); }
  u = u.slice('/app-store/'.length); let f = path.join(DIST, u); if (!f.startsWith(DIST)) { r.writeHead(403); return r.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { r.writeHead(404, { 'content-type': 'text/html' }); return r.end(fs.readFileSync(path.join(DIST, '404.html'))); }
  r.writeHead(200, { 'content-type': T[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(r);
});
srv.listen(port, () => console.log(`http://localhost:${srv.address().port}/app-store/`));
