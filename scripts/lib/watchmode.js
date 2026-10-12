// Small Watchmode client, used for direct links to each title on each service.
// Reads WATCHMODE_KEY (a GitHub Actions secret). If the key is missing or a
// lookup fails, the build carries on without links rather than failing.

import { serviceFor, FREE_SERVICES } from './tmdb.js';

const BASE = 'https://api.watchmode.com/v1';
const key = process.env.WATCHMODE_KEY;
export const watchmodeEnabled = Boolean(key);

// Watchmode names some services differently from TMDB.
const EXTRA_NAMES = [
  [/^tubi/i, 'tubi'],
  [/^pluto/i, 'pluto'],
  [/roku channel/i, 'roku'],
  [/^plex/i, 'plex'],
  [/fandango|vudu/i, 'fandango'],
  [/freevee|prime video.*free|amazon.*free/i, 'prime'],
  [/^youtube/i, 'youtube'],
  [/xumo/i, 'xumo'],
  [/^the cw|^cw\b/i, 'cw'],
  [/filmrise/i, 'filmrise'],
  [/shout/i, 'shout'],
  [/kanopy/i, 'kanopy'],
  [/hoopla/i, 'hoopla'],
];

export function watchmodeService(name) {
  const direct = serviceFor(name);
  if (direct) return direct;
  const hit = EXTRA_NAMES.find(([re]) => re.test(name));
  return hit ? FREE_SERVICES.find((s) => s.key === hit[1]) : null;
}

// Free US sources for a title, looked up by its TMDB id.
// Returns [{ service, label, requires, web, ios, android }] or null on failure.
export async function freeSources(type, tmdbId) {
  if (!key) return null;
  const url = `${BASE}/title/${type === 'tv' ? 'tv' : 'movie'}-${tmdbId}/sources/?regions=US`;
  try {
    const res = await fetch(url, { headers: { 'X-API-Key': key, Accept: 'application/json' } });
    if (res.status === 404) return [];
    if (!res.ok) {
      console.warn(`Watchmode ${res.status} for ${type}-${tmdbId}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const sources = await res.json();
    const out = [];
    for (const s of Array.isArray(sources) ? sources : []) {
      if (s.type !== 'free' || (s.region && s.region !== 'US')) continue;
      const svc = watchmodeService(s.name || '');
      if (!svc || out.some((o) => o.service === svc.key)) continue;
      out.push({
        service: svc.key,
        label: svc.label,
        requires: svc.requires || null,
        web: s.web_url || null,
        ios: s.ios_url || null,
        android: s.android_url || null,
      });
    }
    return out;
  } catch (err) {
    console.warn(`Watchmode lookup failed for ${type}-${tmdbId}: ${err.message}`);
    return null;
  }
}
