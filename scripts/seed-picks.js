// Fills data/picks.json with real titles that are free right now on a main
// service (no library card or login), for every home page section.
//
//   node scripts/seed-picks.js         Replace every pick with fresh starters.
//   node scripts/seed-picks.js --fix   Keep every pick that still qualifies and
//                                      replace only the ones that don't.

import { readFileSync, writeFileSync } from 'node:fs';
import { tmdb, providerIdsFor, genreMap, serviceFor, MAIN_SERVICES, REGION } from './lib/tmdb.js';

const FIX = process.argv.includes('--fix');
const TV_EXCLUDE = [10762, 10763, 10764, 10766, 10767, 16]; // kids, news, reality, soap, talk, animation

// What each section is filled with when it needs titles.
const SPECS = {
  featured: { count: 5, minVotes: 2000, needArt: true },
  top: { count: 8, minVotes: 3000, sort: 'vote_average.desc' },
  'genre-of-the-month': { count: 12, genre: 'horror', minVotes: 800 },
  action: { count: 10, genre: 'action', minVotes: 1500 },
  binge: { type: 'tv', count: 6, minVotes: 300, needArt: true, exclude: TV_EXCLUDE },
  comedy: { count: 10, genre: 'comedy', minVotes: 1500 },
};

const providerIds = [];
for (const key of MAIN_SERVICES) providerIds.push(...(await providerIdsFor(key)).ids);
const providers = [...new Set(providerIds)].join('|');
const movieGenres = await genreMap('movie');
const used = new Set();

async function onMainService(type, id) {
  const res = await tmdb(`/${type}/${id}/watch/providers`);
  const us = res.results?.[REGION] || {};
  return [...(us.free || []), ...(us.ads || [])].some((p) => {
    const svc = serviceFor(p.provider_name);
    return svc && !svc.requires;
  });
}

async function hasArt(type, id) {
  const img = await tmdb(`/${type}/${id}/images`, { include_image_language: 'en,null' });
  const textless = (img.backdrops || []).some((b) => b.iso_639_1 == null && b.width >= 1280);
  const logo = (img.logos || []).some((l) => l.iso_639_1 === 'en');
  return textless && logo;
}

async function fill({ type = 'movie', count, genre, minVotes, sort = 'popularity.desc', needArt = false, exclude }) {
  const picked = [];
  for (let page = 1; picked.length < count && page <= 15; page++) {
    const res = await tmdb(`/discover/${type}`, {
      watch_region: REGION,
      with_watch_providers: providers,
      with_watch_monetization_types: 'free|ads',
      with_genres: genre ? movieGenres.get(genre) : undefined,
      without_genres: exclude?.join(','),
      'vote_count.gte': minVotes,
      sort_by: sort,
      include_adult: 'false',
      with_original_language: 'en',
      page,
    });
    for (const r of res.results) {
      if (picked.length >= count) break;
      const key = `${type}-${r.id}`;
      if (used.has(key) || !r.poster_path || !r.backdrop_path) continue;
      if (needArt && !(await hasArt(type, r.id))) continue;
      // Discover results can lag, so confirm each one directly.
      if (!(await onMainService(type, r.id))) continue;
      used.add(key);
      picked.push({
        title: r.title || r.name,
        year: Number((r.release_date || r.first_air_date || '').slice(0, 4)) || undefined,
        type,
        tmdb_id: r.id,
        note: '',
      });
    }
    if (page >= res.total_pages) break;
  }
  return picked;
}

async function resolveId(item) {
  if (item.tmdb_id) return item.tmdb_id;
  const type = item.type === 'tv' ? 'tv' : 'movie';
  const res = await tmdb(`/search/${type}`, { query: item.title, [type === 'tv' ? 'first_air_date_year' : 'year']: item.year });
  return res.results[0]?.id || null;
}

const existing = JSON.parse(readFileSync('data/picks.json', 'utf8'));
const report = [];

if (FIX) {
  // Mark every current pick as used first, so replacements never duplicate.
  for (const row of existing.rows) {
    for (const item of row.items) {
      item.tmdb_id = await resolveId(item);
      if (item.tmdb_id) used.add(`${item.type === 'tv' ? 'tv' : 'movie'}-${item.tmdb_id}`);
    }
  }
  for (const row of existing.rows) {
    const spec = SPECS[row.id];
    const kept = [];
    for (const item of row.items) {
      const type = item.type === 'tv' ? 'tv' : 'movie';
      if (item.tmdb_id && (await onMainService(type, item.tmdb_id))) kept.push(item);
      else report.push(`${row.title}: removed "${item.title}"`);
    }
    const missing = spec ? spec.count - kept.length : 0;
    const added = missing > 0 ? await fill({ ...spec, count: missing }) : [];
    for (const a of added) report.push(`${row.title}: added "${a.title}" (${a.year})`);
    row.items = [...kept, ...added];
  }
  writeFileSync('data/picks.json', JSON.stringify(existing, null, 2) + '\n');
} else {
  const rows = [
    { id: 'featured', title: 'Featured', style: 'hero' },
    { id: 'top', title: 'Top Suggestions', style: 'poster-large' },
    { id: 'genre-of-the-month', title: 'October: Free Horror', subtitle: 'Featured genre of the month', style: 'poster' },
    { id: 'action', title: 'Action Picks', style: 'poster' },
    { id: 'binge', title: 'Binge Picks for the Month', subtitle: 'Series worth the commitment', style: 'backdrop' },
    { id: 'comedy', title: 'Comedy Picks', style: 'poster' },
  ];
  for (const row of rows) row.items = await fill(SPECS[row.id]);
  writeFileSync('data/picks.json', JSON.stringify({ _howto: existing._howto, _starter: existing._starter, rows }, null, 2) + '\n');
  report.push('Replaced all picks with fresh starters.');
}

console.log(report.join('\n') || 'Every pick already qualifies. Nothing changed.');
if (process.env.GITHUB_STEP_SUMMARY) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, ['## Picks', '', ...report.map((r) => `- ${r}`), ''].join('\n'));
}
