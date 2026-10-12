// Connection test: confirms the TMDB token works, finds the free services in
// TMDB's US provider list, and counts how many free titles each one has.
// Usage: node scripts/check-connection.js

import { appendFileSync } from 'node:fs';
import { tmdb, listProviders, FREE_SERVICES, REGION } from './lib/tmdb.js';

const lines = [];
const out = (s = '') => { console.log(s); lines.push(s); };

await tmdb('/configuration'); // throws if the token is bad
out('## TMDB connection: OK');
out();

const providers = await listProviders();
out(`TMDB lists **${providers.length}** streaming providers in the ${REGION}.`);
out();
out('| Service | TMDB provider name(s) | Free movies | Free series |');
out('|---|---|---:|---:|');

for (const svc of FREE_SERVICES) {
  const matches = providers.filter((p) => svc.match.some((re) => re.test(p.provider_name)));
  if (!matches.length) {
    out(`| ${svc.label} | not found | | |`);
    continue;
  }
  const ids = matches.map((p) => p.provider_id).join('|');
  const query = {
    watch_region: REGION,
    with_watch_providers: ids,
    with_watch_monetization_types: 'free|ads',
  };
  const [m, t] = await Promise.all([
    tmdb('/discover/movie', query),
    tmdb('/discover/tv', query),
  ]);
  const names = matches.map((p) => `${p.provider_name} (${p.provider_id})`).join(', ');
  out(`| ${svc.label} | ${names} | ${m.total_results.toLocaleString()} | ${t.total_results.toLocaleString()} |`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n');
}
