import fs from 'node:fs';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { if (d !== undefined && e.code === 'ENOENT') return d; throw new Error(p + ': ' + e.message); } };
export function loadCatalog({ sample = false } = {}) {
  let dir = path.join(ROOT, 'catalog');
  const real = fs.existsSync(path.join(dir, 'apps')) ? fs.readdirSync(path.join(dir, 'apps')).filter(f => f.endsWith('.json')) : [];
  const useSample = sample || (real.length === 0 && !process.env.CI);
  const base = useSample ? path.join(dir, '_sample') : dir;
  if (!fs.existsSync(path.join(base, 'apps'))) fs.mkdirSync(path.join(base, 'apps'), { recursive: true });
  const apps = fs.readdirSync(path.join(base, 'apps')).filter(f => f.endsWith('.json')).sort()
    .map(f => ({ ...readJson(path.join(base, 'apps', f)), _file: f }));
  return {
    sample: useSample, apps,
    categories: readJson(path.join(dir, 'categories.json')),
    collections: readJson(path.join(base, 'collections.json'), []),
    today: readJson(path.join(base, 'today.json'), { featured: '', stories: [] }),
    synonyms: readJson(path.join(dir, 'synonyms.json'), {}),
    config: readJson(path.join(ROOT, 'site.config.json')),
  };
}
