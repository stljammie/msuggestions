// One-time helper: fills data/picks.json with real, currently free titles for
// every home page section, so the layout can be judged with real art.
// These are starter picks to replace with your own.
// Usage: node scripts/seed-picks.js

import { readFileSync, writeFileSync } from 'node:fs';
import { tmdb, providerIdsFor, genreMap, REGION } from './lib/tmdb.js';

const SEED_SERVICES = ['tubi', 'pluto', 'roku', 'plex', 'fandango', 'prime', 'youtube', 'xumo', 'filmrise', 'shout'];
const TV_EXCLUDE = [10762, 10763, 10764, 10766, 10767, 16]; // kids, news, reality, soap, talk, animation

const providerIds = [];
for (const key of SEED_SERVICES) providerIds.push(...(await providerIdsFor(key)).ids);
const providers = [...new Set(providerIds)].join('|');

const movieGenres = await genreMap('movie');
const used = new Set();

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

// Keep the five horror classics already chosen at the front of the featured row.
const existing = JSON.parse(readFileSync('data/picks.json', 'utf8'));
const classics = existing.rows.find((r) => r.id === 'halloween')?.items || [];

const hero = await fill({ count: 5, minVotes: 2000, needArt: true });
const top = await fill({ count: 8, minVotes: 3000, sort: 'vote_average.desc' });
const horror = await fill({ count: 12 - classics.length, genre: 'horror', minVotes: 800 });
const action = await fill({ count: 10, genre: 'action', minVotes: 1500 });
const binge = await fill({ type: 'tv', count: 6, minVotes: 300, needArt: true, exclude: TV_EXCLUDE });
const comedy = await fill({ count: 10, genre: 'comedy', minVotes: 1500 });

const picks = {
  _howto: existing._howto,
  _starter: 'Starter picks pulled from what is free right now, so the layout shows real art. Replace them with your own.',
  rows: [
    { id: 'featured', title: 'Featured', style: 'hero', items: hero },
    { id: 'top', title: 'Top Suggestions', style: 'poster-large', items: top },
    { id: 'genre-of-the-month', title: 'October: Free Horror', subtitle: 'Featured genre of the month', style: 'poster', items: [...classics, ...horror] },
    { id: 'action', title: 'Action Picks', style: 'poster', items: action },
    { id: 'binge', title: 'Binge Picks for the Month', subtitle: 'Series worth the commitment', style: 'backdrop', items: binge },
    { id: 'comedy', title: 'Comedy Picks', style: 'poster', items: comedy },
  ],
};

writeFileSync('data/picks.json', JSON.stringify(picks, null, 2) + '\n');
for (const r of picks.rows) console.log(`${r.title}: ${r.items.map((i) => `${i.title} (${i.year})`).join('; ')}`);
