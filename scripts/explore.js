// Explore what's free on a service, to shop for picks.
// Usage examples:
//   node scripts/explore.js --service tubi --genre horror
//   node scripts/explore.js --service pluto --type tv --from 1990 --to 1999
//   node scripts/explore.js --service all --genre thriller --minVotes 500
// Options: --service (tubi, pluto, roku, plex, ... or all), --type movie|tv,
//   --genre, --from, --to, --minVotes, --sort popular|rating|newest, --limit

import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmdb, providerIdsFor, genreMap, FREE_SERVICES, REGION } from './lib/tmdb.js';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
    return acc;
  }, [])
);

const service = (args.service || 'tubi').toLowerCase();
const type = args.type === 'tv' ? 'tv' : 'movie';
const limit = Math.min(Number(args.limit || 100), 500);
const minVotes = Number(args.minVotes || 50);
const sortMap = {
  popular: 'popularity.desc',
  rating: 'vote_average.desc',
  newest: type === 'tv' ? 'first_air_date.desc' : 'primary_release_date.desc',
};
const sort = sortMap[args.sort || 'popular'] || sortMap.popular;
const dateField = type === 'tv' ? 'first_air_date' : 'primary_release_date';

// Which providers to search
let providerIds = [];
let serviceLabel;
if (service === 'all') {
  for (const s of FREE_SERVICES) providerIds.push(...(await providerIdsFor(s.key)).ids);
  serviceLabel = 'all free services';
} else {
  const r = await providerIdsFor(service);
  if (!r.ids.length) throw new Error(`TMDB has no US provider matching "${service}".`);
  providerIds = r.ids;
  serviceLabel = r.svc.label;
}

// Genre filter
let genreId;
if (args.genre) {
  const genres = await genreMap(type);
  genreId = genres.get(args.genre.toLowerCase());
  if (!genreId) throw new Error(`Unknown ${type} genre "${args.genre}". Options: ${[...genres.keys()].join(', ')}`);
}

const query = {
  watch_region: REGION,
  with_watch_providers: [...new Set(providerIds)].join('|'),
  with_watch_monetization_types: 'free|ads',
  with_genres: genreId,
  sort_by: sort,
  'vote_count.gte': minVotes,
  [`${dateField}.gte`]: args.from ? `${args.from}-01-01` : undefined,
  [`${dateField}.lte`]: args.to ? `${args.to}-12-31` : undefined,
  include_adult: 'false',
};

const results = [];
let total = 0;
for (let page = 1; results.length < limit && page <= 25; page++) {
  const res = await tmdb(`/discover/${type}`, { ...query, page });
  total = res.total_results;
  results.push(...res.results);
  if (page >= res.total_pages) break;
}
const rows = results.slice(0, limit).map((r) => ({
  tmdb_id: r.id,
  title: r.title || r.name,
  year: (r[type === 'tv' ? 'first_air_date' : 'release_date'] || '').slice(0, 4),
  rating: r.vote_average?.toFixed(1),
  votes: r.vote_count,
}));

// Output
const desc = [
  serviceLabel,
  type === 'tv' ? 'series' : 'movies',
  args.genre && `genre: ${args.genre}`,
  (args.from || args.to) && `years: ${args.from || 'any'} to ${args.to || 'now'}`,
  `min votes: ${minVotes}`,
].filter(Boolean).join(', ');

const lines = [
  `## Free ${type === 'tv' ? 'series' : 'movies'}: ${desc}`,
  '',
  `**${total.toLocaleString()}** matching titles. Showing the top ${rows.length}.`,
  '',
  '| # | Title | Year | Rating | Votes | TMDB ID |',
  '|---:|---|---|---:|---:|---:|',
  ...rows.map((r, i) => `| ${i + 1} | ${r.title.replace(/\|/g, '/')} | ${r.year} | ${r.rating} | ${r.votes} | ${r.tmdb_id} |`),
];
console.log(lines.join('\n'));

mkdirSync('explore-output', { recursive: true });
const csv = ['tmdb_id,title,year,rating,votes', ...rows.map((r) => `${r.tmdb_id},"${r.title.replace(/"/g, '""')}",${r.year},${r.rating},${r.votes}`)];
writeFileSync('explore-output/results.csv', csv.join('\n') + '\n');

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
