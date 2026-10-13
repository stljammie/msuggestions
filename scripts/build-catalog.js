// Nightly build: reads data/picks.json, looks up each pick on TMDB (details,
// artwork, where it's free in the US), and writes public/data/catalog.json
// for the site. Also flags picks that are no longer free anywhere.
// Usage: node scripts/build-catalog.js

import { readFileSync, writeFileSync, mkdirSync, existsSync, appendFileSync } from 'node:fs';
import { tmdb, serviceFor, serviceByName, FREE_SERVICES, IMAGE_BASE, REGION } from './lib/tmdb.js';
import { freeSources, watchmodeEnabled } from './lib/watchmode.js';

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
  const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let hit = res.results.find((x) => norm(x.title || x.name) === norm(item.title)) || res.results[0];
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


// Choose artwork. Backdrops prefer textless versions (no language) so a title
// logo can sit on top. Any choice can be pinned in picks.json with
// "pin": { "poster": "/file.jpg", "backdrop": "/file.jpg", "logo": "/file.png" },
// or "poster": "top" for the highest rated poster.
function images(d, pin) {
  const textless = [...(d.images?.backdrops || [])]
    .filter((b) => b.iso_639_1 == null)
    .sort((a, b) => b.vote_average - a.vote_average || b.width - a.width)[0]?.file_path;
  // "top" picks the highest rated English poster on TMDB instead of the default.
  const topPoster = [...(d.images?.posters || [])]
    .filter((x) => x.iso_639_1 === 'en')
    .sort((a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count)[0]?.file_path;
  const poster = (pin.poster === 'top' ? topPoster : pin.poster) || d.poster_path;
  const backdrop = pin.backdrop || textless || d.backdrop_path;
  // "logo": "none" shows the title as text instead (for titles known by another name).
  const logo = pin.logo === 'none' ? null : pin.logo || pickImage(d.images?.logos, ['en']);
  const url = (size, path) => (path ? `${IMAGE_BASE}/${size}${path}` : null);
  return {
    poster: url('w342', poster),
    poster_large: url('w500', poster),
    backdrop: url('w1280', backdrop),
    backdrop_small: url('w780', backdrop),
    backdrop_textless: Boolean(pin.backdrop || textless),
    logo: url('w500', logo),
    art: { poster, backdrop, logo },
  };
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
    // Keep only the services we track, one entry per service.
    const where = [];
    let otherFree = 0;
    for (const p of offers) {
      const svc = serviceFor(p.provider_name);
      if (!svc) { otherFree++; continue; }
      if (where.some((w) => w.service === svc.key)) continue;
      where.push({ service: svc.key, label: svc.label, requires: svc.requires || null, main: !svc.requires, kind: p.kind });
    }
    // Direct links from Watchmode, looked up at most once a day per title so
    // rebuilds don't use up the free monthly quota. Watchmode can also confirm
    // a free service the main data is missing.
    const prevTitle = previous.titles?.[key];
    let wm = prevTitle?.wm_checked === today ? prevTitle.wm_sources : null;
    let wmChecked = prevTitle?.wm_checked || null;
    if (!wm && watchmodeEnabled) {
      wm = await freeSources(type, id);
      if (wm) wmChecked = today;
    }
    if (!wm) wm = prevTitle?.wm_sources || [];
    for (const src of wm) {
      let w = where.find((x) => x.service === src.service);
      if (!w) {
        w = { service: src.service, label: src.label, requires: src.requires, main: !src.requires, kind: 'free', source: 'watchmode' };
        where.push(w);
      }
      w.link = src.web || null;
      w.ios = src.ios || null;
      w.android = src.android || null;
    }

    // Services you confirmed yourself ("verified" in picks.json) count even
    // when the data hasn't caught up yet.
    for (const name of item.verified?.services || []) {
      const svc = serviceByName(name);
      if (!svc) { problems.push(`"${item.title}": verified service "${name}" isn't a tracked service`); continue; }
      const found = where.find((w) => w.service === svc.key);
      if (found) { found.confirmed_by_data = true; continue; }
      where.push({ service: svc.key, label: svc.label, requires: svc.requires || null, main: !svc.requires, kind: 'ads', verified_on: item.verified.on || null });
      const age = item.verified.on ? Math.floor((Date.now() - Date.parse(item.verified.on)) / 864e5) : null;
      if (age === null || age > 30) problems.push(`"${item.title}" on ${svc.label} was verified by you ${age === null ? 'without a date' : `${age} days ago`} and the data still doesn't show it. Worth a quick recheck.`);
    }
    // Links you added yourself in picks.json ("links": {"Pluto TV": "https://..."}) win.
    for (const [name, url] of Object.entries(item.links || {})) {
      const svc = serviceByName(name);
      const w = svc && where.find((x) => x.service === svc.key);
      if (w) w.link = url;
      else problems.push(`"${item.title}": link given for "${name}", which isn't one of its free services`);
    }
    const order = FREE_SERVICES.map((x) => x.key);
    where.sort((a, b) => order.indexOf(a.service) - order.indexOf(b.service));

    const prev = previous.titles?.[key];
    // A pick only counts as available when it's free on a main service
    // (no library card or login needed).
    const available = where.some((w) => w.main);
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
      ...images(d, item.pin || {}),
      note: item.note || '',
      prefer: item.prefer || null,
      display_title: item.display_title || null,
      focus: item.focus || null,
      where,
      other_free_services: otherFree,
      watch_link: us.link || null,
      wm_checked: wmChecked,
      wm_sources: wm,
      available,
      first_seen_free: available ? prev?.first_seen_free || today : prev?.first_seen_free || null,
      last_seen_free: available ? today : prev?.last_seen_free || null,
    };
    if (['hero', 'backdrop', 'square'].includes(row.style) && (!titles[key].logo || !titles[key].backdrop_textless)) {
      problems.push(`"${titles[key].title}" is in "${row.title}" but has no ${titles[key].logo ? 'textless backdrop' : 'English title logo'}`);
    }
    if (!available) problems.push(`"${titles[key].title}" (${titles[key].year}) is not free on a main service right now${where.length ? ` (only ${where.map((w) => w.label).join(', ')})` : ''}. It is hidden from the site until it is, so swap it out.`);
  }
  rows.push({ id: row.id, title: row.title, subtitle: row.subtitle || null, style: row.style || 'poster', items: ids });
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
  `**${all.length}** titles in **${rows.length}** rows. **${all.filter((t) => t.available).length}** free on a main service.`,
  '',
  '| Title | Year | Free on |',
  '|---|---|---|',
  ...all.map((t) => `| ${t.title} | ${t.year ?? ''} | ${t.where.map((w) => w.label).join(', ') || 'NOT FREE'} |`),
];
if (problems.length) lines.push('', '### Needs attention', '', ...problems.map((p) => `- ${p}`));
console.log(lines.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
