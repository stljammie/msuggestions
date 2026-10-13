// Checks every pick before it goes live: which TMDB version it matches,
// whether it's free on a main service, whether hero and binge picks have a
// title logo and textless backdrop, and which titles appear in more than one
// row. For titles with several versions, it lists the alternatives and where
// each one is free. Writes reports/picks-check.md.
// Usage: node scripts/check-picks.js

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmdb, serviceFor, serviceByName, REGION } from './lib/tmdb.js';

const picks = JSON.parse(readFileSync('data/picks.json', 'utf8'));

async function mainServices(type, id) {
  const res = await tmdb(`/${type}/${id}/watch/providers`);
  const us = res.results?.[REGION] || {};
  const out = [];
  for (const p of [...(us.free || []), ...(us.ads || [])]) {
    const svc = serviceFor(p.provider_name);
    if (svc && !svc.requires && !out.includes(svc.label)) out.push(svc.label);
  }
  return out;
}

async function art(type, id) {
  const img = await tmdb(`/${type}/${id}/images`, { include_image_language: 'en,null' });
  return {
    logo: (img.logos || []).some((l) => l.iso_639_1 === 'en'),
    textless: (img.backdrops || []).some((b) => b.iso_639_1 == null && b.width >= 1280),
  };
}

const lines = ['# Picks check', '', `Checked ${new Date().toISOString().slice(0, 10)}. Main services only (no library card or login).`, ''];
const seen = new Map();
let problems = 0;

for (const row of picks.rows) {
  lines.push(`## ${row.title}`, '', '| # | Pick | Matched | Free on | Notes |', '|---:|---|---|---|---|');
  for (const [n, item] of row.items.entries()) {
    const type = item.type === 'tv' ? 'tv' : 'movie';
    let id = item.tmdb_id;
    let matched;
    if (id) {
      const d = await tmdb(`/${type}/${id}`);
      matched = { id, title: d.title || d.name, year: (d.release_date || d.first_air_date || '').slice(0, 4) };
    } else {
      const res = await tmdb(`/search/${type}`, { query: item.title, [type === 'tv' ? 'first_air_date_year' : 'year']: item.year });
      const norm = (x) => (x || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const r = res.results.find((x) => norm(x.title || x.name) === norm(item.title)) || res.results[0];
      if (r) matched = { id: r.id, title: r.title || r.name, year: (r.release_date || r.first_air_date || '').slice(0, 4) };
    }
    const notes = [];
    let free = [];
    if (!matched) {
      notes.push('**Not found on TMDB**');
      problems++;
    } else {
      free = await mainServices(type, matched.id);
      for (const name of item.verified?.services || []) {
        const svc = serviceByName(name);
        if (svc && !svc.requires && !free.includes(svc.label)) {
          free.push(svc.label);
          notes.push(`${svc.label} verified by you${item.verified.on ? ` on ${item.verified.on}` : ''}`);
        }
      }
      if (!free.length) { notes.push('**Not free on a main service**'); problems++; }
      if (item.prefer && free.length && !free.includes(item.prefer)) notes.push(`You noted ${item.prefer}, but it isn't listed there`);
      if (['hero', 'backdrop', 'square'].includes(row.style)) {
        const a = await art(type, matched.id);
        if (!a.logo) { notes.push('**No English title logo**'); problems++; }
        if (!a.textless) { notes.push('**No textless backdrop**'); problems++; }
      }
      const key = `${type}-${matched.id}`;
      if (seen.has(key)) notes.push(`Also in ${seen.get(key)}`);
      else seen.set(key, row.title);

      // Other versions with the same name, and where they're free.
      const all = await tmdb(`/search/${type}`, { query: item.title });
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
      const others = all.results.filter((r) => r.id !== matched.id && norm(r.title || r.name) === norm(item.title)).slice(0, 4);
      for (const o of others) {
        const f = await mainServices(type, o.id);
        notes.push(`Other version: ${o.title || o.name} (${(o.release_date || o.first_air_date || '').slice(0, 4)}, id ${o.id})${f.length ? ` free on ${f.join(', ')}` : ', not free'}`);
      }
    }
    lines.push(`| ${n + 1} | ${item.title}${item.year ? ` (${item.year})` : ''} | ${matched ? `${matched.title} (${matched.year}), id ${matched.id}` : 'none'} | ${free.join(', ') || 'none'} | ${notes.join('<br>')} |`);
  }
  lines.push('');
}
lines.splice(3, 0, problems ? `**${problems} issue(s) to fix**, marked in bold below.` : 'Every pick passes.', '');

mkdirSync('reports', { recursive: true });
writeFileSync('reports/picks-check.md', lines.join('\n') + '\n');
console.log(lines.join('\n'));
