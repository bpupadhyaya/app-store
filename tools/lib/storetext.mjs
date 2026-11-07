// Parse our store-text markdown files (several historic formats) into plain fields.
// Handles: "Label (<=30): `value` (27)", "Label: value", "Label:\n value paragraph", "Label:\n```\nblock\n```",
// "## Label (1.0)\nvalue", "Description:" / "## Description" followed by plain text or a fenced block.
// Everything from a "Review Notes" heading onward is discarded (never reaches the public repo).
const unwrap = s => s.replace(/^\s*`([^`]*)`.*$/, '$1').replace(/\s*\(\d+\)\s*$/, '').replace(/\s*\((fallback|if )[^)]*\)\s*$/i, '').replace(/\*\*/g, '').trim();
const STOP_DESC = /^(#{1,4}\s*)?(what'?s new|subscription|google play|age rating|review notes|keywords|promo|support url|privacy url|copyright|age rating notes|privacy labels)\b/i;

export function cutReviewNotes(md) {
  const lines = md.split('\n'); const i = lines.findIndex(l => /^#{2,4}\s*(app |apple )*review notes?\b/i.test(l) || /^review notes?\s*(\(|:|$)/i.test(l));
  return (i > -1 ? lines.slice(0, i) : lines).join('\n');
}

const LINE = /^\s*(?:[-*]\s+|(#{1,4})\s*)?\**([A-Za-z' ]+?)\**\s*(?:\([^)]*\))?\s*(:|$)\s*(.*)$/;
function labelMatch(line, labels) {
  const m = line.match(LINE); if (!m) return null;
  if (!m[1] && !m[3] && !(m[4] === '' && m[2].trim().toLowerCase() === 'description')) return null; // plain line needs "Label:"; headings need no colon
  if (m[1] && m[3] === '' && m[4]) return null;
  return labels.includes(m[2].trim().toLowerCase()) ? { rest: m[4] ?? '' } : null;
}

// value of a label: inline remainder, else fenced block, else following paragraph (until blank line)
export function getField(md, labels, { multi = false } = {}) {
  const L = md.split('\n'); labels = labels.map(s => s.toLowerCase());
  for (let i = 0; i < L.length; i++) {
    const hit = labelMatch(L[i], labels); if (!hit) continue;
    let rest = hit.rest.trim();
    if (rest && !/^```/.test(rest)) return multi ? [rest] .join('\n') : unwrap(rest);
    let j = i + 1; while (j < L.length && !L[j].trim()) j++;
    if (/^```/.test(L[j] || '')) { const out = []; j++; while (j < L.length && !/^```/.test(L[j])) out.push(L[j++]); return out.join('\n').trim(); }
    const out = [];
    for (; j < L.length; j++) { if (!multi && !L[j].trim()) break; if (multi && STOP_DESC.test(L[j].trim()) && out.length) break; out.push(L[j]); }
    return out.join('\n').trim();
  }
  return '';
}

const BOILER_HEAD = /^(ads\b|free\b|optional subscription|subscription|terms|contact|support|privacy\b|ad-?free)/i;
const BOILER_PARA = /auto-?renew|billed to|charged to your apple|admob|restore purchases|watch (a )?short (optional )?videos?|terms of use|itunes\/dev\/stdeula/i;
const isHead = l => { const t = l.trim(); return /^[A-Z][A-Z0-9 ,&'!?\/:.-]{1,60}$/.test(t) && /[A-Z]{2}/.test(t) || /^#{2,4}\s/.test(t) || /^\*\*[^*]+\*\*$/.test(t); };
const headText = l => l.trim().replace(/^#{2,4}\s*/, '').replace(/\*\*/g, '');
const title = s => s.toLowerCase().replace(/(^|[\s(-])([a-z])/g, (_, a, b) => a + b.toUpperCase()).replace(/\b(And|Or|The|A|To|Of|For|With|On|In)\b(?!$)/g, w => w.toLowerCase()).replace(/^./, c => c.toUpperCase());

// Turn a store description into web markdown: ALL-CAPS headings -> "### Title", drop ads/subscription/legal sections and paragraphs.
export function webDescription(desc) {
  const blocks = []; let cur = { head: null, lines: [] };
  for (const l of desc.split('\n')) { if (isHead(l) && !/^[-*]\s/.test(l.trim())) { blocks.push(cur); cur = { head: headText(l), lines: [] }; } else cur.lines.push(l); }
  blocks.push(cur);
  const out = [];
  for (const b of blocks) {
    if (b.head && BOILER_HEAD.test(b.head)) continue;
    const paras = b.lines.join('\n').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
      .filter(p => !BOILER_PARA.test(p) && !/^(terms( of use)?|privacy( policy)?|support)\s*:/i.test(p));
    if (!paras.length && !b.head) continue; if (!paras.length) continue;
    const h = b.head ? (b.head === b.head.toUpperCase() ? title(b.head) : b.head) : null;
    out.push((h ? `### ${h}\n` : '') + paras.join('\n\n'));
  }
  return out.join('\n\n').trim();
}

export function shorten(s, n = 160) {
  s = s.replace(/\s+/g, ' ').trim(); if (s.length <= n) return s;
  const cut = s.slice(0, n); const dot = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  if (dot > n * 0.5) return cut.slice(0, dot + 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,;:\s-]+$/, '') + '…';
}

const CAT = { puzzle: 'puzzle', casual: 'casual', board: 'board-strategy', strategy: 'board-strategy', word: 'word', music: 'music', sports: 'sports', education: 'education', health: 'health', utilities: 'utilities', lifestyle: 'lifestyle', finance: 'finance', productivity: 'productivity' };
export function mapCategories(s) {
  const first = s.split(/\bPrice\b|\bAge\b|\bSKU\b|\bBundle\b|\bCopyright\b/i)[0];
  return [...new Set((first.match(/[A-Za-z]+/g) || []).map(w => CAT[w.toLowerCase()]).filter(Boolean))];
}

export function parseStoreText(raw) {
  const md = cutReviewNotes(raw);
  const clean = v => (v || '').replace(/^["']|["']$/g, '').trim();
  const name = unwrap(getField(md, ['name']));
  const subtitle = unwrap(getField(md, ['subtitle']));
  const promo = clean(getField(md, ['promo text', 'promotional text', 'promo']).replace(/^`|`.*$/g, ''));
  const keywords = (getField(md, ['keywords']).replace(/^`|`.*$/g, '')).split(',').map(s => s.trim()).filter(Boolean);
  const category = (md.match(/^\s*(?:[-*]\s+)?(?:Primary )?Category:\s*(.+)$/im) || md.match(/primary\s+([^|\n]+)/i) || [])[1] || '';
  let whatsNew = clean(getField(md, ["what's new"]).replace(/^`|`.*$/g, '')); if (/^(not needed|n\/a|none)\b/i.test(whatsNew)) whatsNew = '';
  const description = getField(md, ['description'], { multi: true });
  return {
    name, subtitle, promo, keywords, category, categories: mapCategories(category), whatsNew, description,
    ageRating: (md.match(/Age rating:\s*([0-9]+\+)/i) || [])[1] || '',
    privacyUrl: (md.match(/(https:\/\/equalinformation\.com\/privacy-[a-z0-9-]+\.html)/) || [])[1] || '',
    supportUrl: (md.match(/(https:\/\/equalinformation\.com\/(?:app-)?support-[a-z0-9-]+\.html)/) || [])[1] || '',
    bundleId: (md.match(/Bundle(?: id)?:\s*(com\.[a-z0-9.-]+)/i) || [])[1] || '',
  };
}
