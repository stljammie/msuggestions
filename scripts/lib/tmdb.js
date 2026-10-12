// Small TMDB client. Reads the token from the TMDB_TOKEN environment variable
// (stored as a GitHub Actions secret, never in the code).

const BASE = 'https://api.themoviedb.org/3';
export const IMAGE_BASE = 'https://image.tmdb.org/t/p';
export const REGION = 'US';

const token = process.env.TMDB_TOKEN;

function requireToken() {
  if (!token) {
    throw new Error(
      'TMDB_TOKEN is not set. Add it as a repository secret in GitHub (Settings > Secrets and variables > Actions).'
    );
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function tmdb(path, params = {}) {
  requireToken();
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }

  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after') || 0) * 1000 || attempt * 1500;
      await sleep(wait);
      continue;
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`TMDB ${res.status} on ${path}: ${body.slice(0, 300)}`);
    }
    return res.json();
  }
  throw new Error(`TMDB kept failing on ${path} after retries`);
}

// Free and ad supported services we care about. Matched by name against
// TMDB's live provider list, so IDs never have to be hardcoded.
export const FREE_SERVICES = [
  { key: 'tubi', label: 'Tubi', match: [/^tubi/i] },
  { key: 'pluto', label: 'Pluto TV', match: [/^pluto/i] },
  { key: 'roku', label: 'The Roku Channel', match: [/^the roku channel$/i] },
  { key: 'plex', label: 'Plex', match: [/^plex$/i] },
  { key: 'fandango', label: 'Fandango at Home', match: [/^fandango at home free$/i] },
  // Only the free tier. "Amazon Prime Video with Ads" is the paid Prime plan and must not match.
  { key: 'prime', label: 'Prime Video', requires: 'Free Amazon login', match: [/^amazon prime video free with ads$/i, /freevee/i] },
  { key: 'youtube', label: 'YouTube', match: [/^youtube free$/i] },
  { key: 'xumo', label: 'Xumo Play', match: [/^xumo play$/i] },
  { key: 'kanopy', label: 'Kanopy', requires: 'Library card', match: [/^kanopy$/i] },
  { key: 'hoopla', label: 'Hoopla', requires: 'Library card', match: [/^hoopla$/i] },
  { key: 'filmrise', label: 'FilmRise', match: [/^filmrise/i] },
  { key: 'shout', label: 'Shout! TV', match: [/^shout! factory tv$/i, /^shout! tv$/i] },
];

export function serviceFor(providerName) {
  return FREE_SERVICES.find((s) => s.match.some((re) => re.test(providerName))) || null;
}

// All US providers TMDB knows about, for movies and TV combined.
export async function listProviders() {
  const [movie, tv] = await Promise.all([
    tmdb('/watch/providers/movie', { watch_region: REGION }),
    tmdb('/watch/providers/tv', { watch_region: REGION }),
  ]);
  const byId = new Map();
  for (const p of [...movie.results, ...tv.results]) byId.set(p.provider_id, p);
  return [...byId.values()].sort((a, b) => a.provider_name.localeCompare(b.provider_name));
}

// Resolve a service key (like "tubi") to TMDB provider IDs.
export async function providerIdsFor(serviceKey) {
  const svc = FREE_SERVICES.find((s) => s.key === serviceKey);
  if (!svc) throw new Error(`Unknown service "${serviceKey}". Options: ${FREE_SERVICES.map((s) => s.key).join(', ')}`);
  const all = await listProviders();
  const ids = all.filter((p) => svc.match.some((re) => re.test(p.provider_name))).map((p) => p.provider_id);
  return { svc, ids, names: all.filter((p) => ids.includes(p.provider_id)).map((p) => p.provider_name) };
}

export async function genreMap(type) {
  const res = await tmdb(`/genre/${type}/list`);
  return new Map(res.genres.map((g) => [g.name.toLowerCase(), g.id]));
}
