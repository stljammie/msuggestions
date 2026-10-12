// Builds a self-contained artwork preview page for every pick: the poster,
// backdrop and title-logo options TMDB has, with the image files embedded so
// the page works anywhere. Output: art-preview/index.html
// Usage: node scripts/art-preview.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmdb, IMAGE_BASE } from './lib/tmdb.js';

const catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
const MAX = { posters: 4, backdrops: 2, logos: 2 };
const SIZE = { posters: 'w154', backdrops: 'w500', logos: 'w300' };

async function embed(path, size) {
  const res = await fetch(`${IMAGE_BASE}/${size}${path}`);
  if (!res.ok) return null;
  const type = res.headers.get('content-type') || 'image/jpeg';
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:${type};base64,${buf.toString('base64')}`;
}

const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function rank(list, preferEnglish) {
  return [...(list || [])].sort((a, b) => {
    if (preferEnglish) {
      const la = a.iso_639_1 === 'en' ? 0 : a.iso_639_1 == null ? 1 : 2;
      const lb = b.iso_639_1 === 'en' ? 0 : b.iso_639_1 == null ? 1 : 2;
      if (la !== lb) return la - lb;
    }
    return b.vote_average - a.vote_average || b.width - a.width;
  });
}

const sections = [];
for (const t of Object.values(catalog.titles)) {
  const img = await tmdb(`/${t.type}/${t.tmdb_id}/images`);
  const groups = {
    posters: rank(img.posters, true),
    backdrops: rank(img.backdrops?.filter((b) => b.iso_639_1 == null || b.iso_639_1 === 'en'), false),
    logos: rank(img.logos?.filter((l) => l.iso_639_1 === 'en' || l.iso_639_1 == null), true),
  };
  const parts = [];
  for (const [kind, list] of Object.entries(groups)) {
    const shown = [];
    for (const item of list.slice(0, MAX[kind])) {
      const src = await embed(item.file_path, SIZE[kind]);
      if (src) shown.push({ src, w: item.width, h: item.height, lang: item.iso_639_1 });
    }
    parts.push({ kind, total: list.length, shown });
  }
  sections.push({ t, parts });
}

const label = { posters: 'Posters', backdrops: 'Backdrops', logos: 'Title logos' };
const use = {
  posters: 'Rows and title tiles',
  backdrops: 'Hero banner and detail pages',
  logos: 'Laid over a backdrop for the featured pick',
};

const body = sections.map(({ t, parts }) => `
  <section class="title" id="${t.key}">
    <header class="title-head">
      <h2>${esc(t.title)} <span class="yr">${t.year ?? ''}</span></h2>
      <p class="meta">${esc(t.genres.join(' · '))}${t.runtime ? ` · ${t.runtime} min` : ''}${t.rating ? ` · TMDB ${t.rating}` : ''}</p>
      <p class="free">Free on ${esc(t.where.map((w) => w.label).join(', ') || 'no tracked service')}</p>
    </header>
    ${parts.map((p) => `
    <div class="group">
      <div class="group-head">
        <h3>${label[p.kind]}</h3>
        <span class="count">${p.shown.length} of ${p.total} available</span>
        <span class="use">${use[p.kind]}</span>
      </div>
      ${p.shown.length ? `<div class="strip ${p.kind}">
        ${p.shown.map((s, i) => `<figure class="${i === 0 ? 'default' : ''}"><img src="${s.src}" alt="${esc(t.title)} ${p.kind.slice(0, -1)} option ${i + 1}" loading="lazy"><figcaption>${i === 0 ? 'Top rated' : `Option ${i + 1}`} <span>${s.w}×${s.h}${s.lang ? ' · ' + s.lang : ''}</span></figcaption></figure>`).join('')}
      </div>` : '<p class="none">None on TMDB for this title.</p>'}
    </div>`).join('')}
  </section>`).join('');

const html = `<title>msuggestions Artwork Check</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=IBM+Plex+Sans:wght@400;500&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
/* Layout: a dark screening-room contact sheet, one band per title, art in horizontal strips */
:root {
  --bg: #111215; --surface: #1a1b20; --line: #2b2d34;
  --fg: #ecebe6; --muted: #9a9ca5; --accent: #e9b872;
  --display: 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif;
  --body: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  color-scheme: dark;
}
body { background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); padding-inline: 20px; padding-block: 28px 64px; }
.wrap { max-width: 1180px; margin: 0 auto; display: grid; gap: 56px; }
.intro { display: grid; gap: 10px; max-width: 68ch; }
.intro .eyebrow { font: 12px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); }
.intro h1 { font: 800 clamp(40px, 7vw, 76px)/.95 var(--display); letter-spacing: .01em; text-transform: uppercase; margin: 0; text-wrap: balance; }
.intro p { margin: 0; color: var(--muted); }
.title { display: grid; gap: 26px; padding-top: 28px; border-top: 1px solid var(--line); }
.title-head { display: grid; gap: 4px; }
.title-head h2 { font: 800 clamp(28px, 4.5vw, 44px)/1 var(--display); text-transform: uppercase; margin: 0; text-wrap: balance; }
.title-head .yr { color: var(--muted); font-weight: 600; }
.meta { margin: 0; color: var(--muted); font-size: 14px; }
.free { margin: 0; font-size: 14px; }
.group { display: grid; gap: 12px; }
.group-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 14px; }
.group-head h3 { font: 600 20px var(--display); text-transform: uppercase; letter-spacing: .04em; margin: 0; }
.count { font: 12px var(--mono); color: var(--accent); }
.use { font: 12px var(--mono); color: var(--muted); }
.strip { display: flex; gap: 14px; overflow-x: auto; padding-bottom: 8px; scrollbar-color: var(--line) transparent; }
.strip figure { margin: 0; display: grid; gap: 6px; flex: none; }
.strip img { display: block; border-radius: 4px; background: var(--surface); }
.posters img { width: 120px; aspect-ratio: 2 / 3; object-fit: cover; }
.backdrops img { width: min(340px, 78vw); aspect-ratio: 16 / 9; object-fit: cover; }
.logos figure { background: repeating-conic-gradient(var(--surface) 0 25%, var(--line) 0 50%) 0 0 / 16px 16px; padding: 14px; border-radius: 4px; }
.logos img { height: 90px; width: auto; max-width: 260px; object-fit: contain; background: none; }
.strip figure.default img { outline: 2px solid var(--accent); outline-offset: 2px; }
figcaption { font: 11px var(--mono); color: var(--fg); display: flex; justify-content: space-between; gap: 8px; }
figcaption span { color: var(--muted); }
.none { margin: 0; color: var(--muted); font-size: 14px; }
.credit { color: var(--muted); font-size: 12px; border-top: 1px solid var(--line); padding-top: 18px; }
</style>
<main class="wrap">
  <div class="intro">
    <span class="eyebrow">Artwork check · built ${catalog.updated}</span>
    <h1>What the picks look like</h1>
    <p>Every poster, backdrop and title logo TMDB has for your current picks, best rated first. The outlined one is the top rated choice. Scroll each strip sideways for more. Any option can be pinned for the site.</p>
  </div>
  ${body}
  <p class="credit">Images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
</main>
`;

mkdirSync('art-preview', { recursive: true });
writeFileSync('art-preview/index.html', html);
console.log(`Wrote art-preview/index.html (${(html.length / 1024 / 1024).toFixed(2)} MB) for ${sections.length} titles`);
