// Nightly build: reads data/picks.json, looks up each pick on TMDB (details,
// artwork, where it's free in the US), and writes public/data/catalog.json
// for the site. Also flags picks that are no longer free anywhere.
// Usage: node scripts/build-catalog.js

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { tmdb, serviceFor, IMAGE_BASE, REGION } from './lib/tmdb.js';

const PICKS = 'data/picks.json';
const OUT = 'public/data/catalog.json';

const picks = JSON.parse(readFileSync(PICKS, 'utf8'));
const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : { titles: {} };
const today = new Date().toISOString().slice(0, 10);

async function resolveId(item) {
  if (item.tmdb_id) return item.tmdb_id;
  const type = item.type === 'tv' ? 'tv' : 'movie';
  const res = await tmdb(`/search/${type}`, {
    query: item.title,
    [type === 'tv' ? 'first_air_date_year' : 'year']: item.year,
    include_adult: 'false',
  });
  let hit = res.results[0];
  if (!hit && item.year) {
    const loose = await tmdb(`/search/${type}`, { query: item.title, include_adult: 'false' });
    hit = loose.results[0];
  }
  return hit ? hit.id : null;
}

function pickImage(list, langs = ['en', null]) {
  for (const lang of langs) {
    const found = (list || []).filter((i) => i.iso_639_1 === lang).sort((a, b) => b.vote_average - a.vote_average)[0];
    if (found) return found.file_path;
  }
  return null;
}

const titles = {};
const problems = [];
const rows = [];

for (const row of picks.rows) {
  const ids = [];
  for (const item of row.items) {
    const type = item.type === 'tv' ? 'tv' : 'movie';
    const id = await resolveId(item);
    if (!id) {
      problems.push(`Could not find "${item.title}" (${item.year || 'no year'}) on TMDB`);
      continue;
    }
    const key = `${type}-${id}`;
    ids.push(key);
    if (titles[key]) continue;

    const d = await tmdb(`/${type}/${id}`, {
      append_to_response: 'watch/providers,images',
      include_image_language: 'en,null',
    });
    const us = d['watch/providers']?.results?.[REGION] || {};
    const offers = [
      ...(us.free || []).map((p) => ({ ...p, kind: 'free' })),
      ...(us.ads || []).map((p) => ({ ...p, kind: 'ads' })),
    ];
    const where = [];
    for (const p of offers) {
      const svc = serviceFor(p.provider_name);
      where.push({
        service: svc?.key || 'other',
        label: svc?.label || p.provider_name,
        provider: p.provider_name,
        kind: p.kind,
      });
    }

    const prev = previous.titles?.[key];
    const available = where.length > 0;
    titles[key] = {
      key,
      tmdb_id: id,
      type,
      title: d.title || d.name,
      year: Number((d.release_date || d.first_air_date || '').slice(0, 4)) || null,
      overview: d.overview,
      runtime: d.runtime || null,
      seasons: d.number_of_seasons || null,
      genres: (d.genres || []).map((g) => g.name),
      rating: d.vote_average ? Number(d.vote_average.toFixed(1)) : null,
      poster: d.poster_path ? `${IMAGE_BASE}/w342${d.poster_path}` : null,
      poster_large: d.poster_path ? `${IMAGE_BASE}/w780${d.poster_path}` : null,
      backdrop: d.backdrop_path ? `${IMAGE_BASE}/w1280${d.backdrop_path}` : null,
      logo: (() => { const l = pickImage(d.images?.logos, ['en']); return l ? `${IMAGE_BASE}/w500${l}` : null; })(),
      note: item.note || '',
      where,
      watch_link: us.link || null,
      available,
      first_seen_free: available ? prev?.first_seen_free || today : prev?.first_seen_free || null,
      last_seen_free: available ? today : prev?.last_seen_free || null,
    };
    if (!available) problems.push(`"${titles[key].title}" (${titles[key].year}) is not free on any tracked service right now`);
  }
  rows.push({ id: row.id, title: row.title, items: ids });
}

mkdirSync('public/data', { recursive: true });
const catalog = {
  updated: today,
  region: REGION,
  credits: 'Data and images from TMDB. Streaming availability provided by JustWatch.',
  rows,
  titles,
};
writeFileSync(OUT, JSON.stringify(catalog, null, 2) + '\n');

// Report
const all = Object.values(titles);
const lines = [
  `## Catalog built ${today}`,
  '',
  `**${all.length}** titles in **${rows.length}** rows. **${all.filter((t) => t.available).length}** currently free.`,
  '',
  '| Title | Year | Free on |',
  '|---|---|---|',
  ...all.map((t) => `| ${t.title} | ${t.year ?? ''} | ${[...new Set(t.where.map((w) => w.label))].join(', ') || 'NOT FREE'} |`),
];
if (problems.length) lines.push('', '### Needs attention', '', ...problems.map((p) => `- ${p}`));
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
