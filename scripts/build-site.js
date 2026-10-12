// Builds the home page from public/data/catalog.json.
//   node scripts/build-site.js                 -> public/index.html (the real site)
//   node scripts/build-site.js --embed out.html -> one-file preview with images embedded
//
// Colors and fonts live in the TOKENS block below. Change them there and the
// whole site follows.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { dirname } from 'node:path';

const embedIdx = process.argv.indexOf('--embed');
const EMBED = embedIdx > -1 ? process.argv[embedIdx + 1] : null;

const catalog = JSON.parse(readFileSync('public/data/catalog.json', 'utf8'));
const T = catalog.titles;
// Main services need no library card or login. Only those count for a pick.
const mains = (t) => t.where.filter((w) => w.main ?? !w.requires);
const extras = (t) => t.where.filter((w) => !(w.main ?? !w.requires));

const esc = (s = '') => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- images (URLs for the site, embedded data for previews) ----------
const cache = new Map();
async function img(url) {
  if (!url) return '';
  if (!EMBED) return url;
  if (cache.has(url)) return cache.get(url);
  const res = await fetch(url);
  if (!res.ok) { cache.set(url, ''); return ''; }
  const data = `data:${res.headers.get('content-type') || 'image/jpeg'};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  cache.set(url, data);
  return data;
}

// ---------- small helpers ----------
const freeOn = (t, max = 3) => {
  const names = mains(t).map((w) => w.label);
  if (!names.length) return 'Check availability';
  return names.length > max ? `${names.slice(0, max).join(', ')} +${names.length - max}` : names.join(', ');
};
const metaLine = (t) => [
  t.year,
  t.type === 'tv' ? (t.seasons ? `${t.seasons} season${t.seasons > 1 ? 's' : ''}` : 'Series') : t.runtime ? `${Math.floor(t.runtime / 60)}h ${t.runtime % 60}m` : null,
  t.genres.slice(0, 2).join(', '),
].filter(Boolean).join(' · ');

// ---------- sections ----------
async function hero(row) {
  const slides = [];
  const keys = row.items.filter((key) => T[key]?.available);
  for (const [i, key] of keys.entries()) {
    const t = T[key];
    slides.push(`
      <article class="slide${i === 0 ? ' is-active' : ''}" data-key="${t.key}" aria-roledescription="slide" aria-label="${i + 1} of ${keys.length}: ${esc(t.title)}"${i === 0 ? '' : ' aria-hidden="true"'}>
        <img class="slide-bg" src="${await img(t.backdrop)}" alt="" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy"'}>
        <div class="slide-shade"></div>
        <div class="slide-info">
          <span class="eyebrow">Featured pick</span>
          <p class="slide-meta">${esc(metaLine(t))}</p>
          ${t.note ? `<p class="slide-note">${esc(t.note)}</p>` : ''}
          <p class="slide-free">Free on ${esc(freeOn(t))}</p>
          <button class="btn" type="button" data-open="${t.key}">Where to watch</button>
        </div>
        ${t.logo
          ? `<img class="slide-logo" src="${await img(t.logo)}" alt="${esc(t.title)}">`
          : `<h2 class="slide-title">${esc(t.title)}</h2>`}
      </article>`);
  }
  return `
  <section class="hero" aria-roledescription="carousel" aria-label="Featured picks">
    <div class="slides">${slides.join('')}</div>
    <button class="hero-arrow prev" type="button" aria-label="Previous pick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
    <button class="hero-arrow next" type="button" aria-label="Next pick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
    <div class="hero-dots" role="tablist" aria-label="Choose a featured pick">
      ${slides.map((_, i) => `<button type="button" role="tab" aria-label="Pick ${i + 1}" aria-selected="${i === 0}"${i === 0 ? ' class="is-active"' : ''}><span></span></button>`).join('')}
    </div>
  </section>`;
}

// Short service names for the small line under posters.
const SHORT = { roku: 'Roku', fandango: 'Fandango', xumo: 'Xumo' };
async function posterTile(t, large, shown) {
  const count = mains(t).length;
  const svc = shown ? ` · ${SHORT[shown.service] || shown.label}${count > 1 ? ` +${count - 1}` : ''}` : '';
  const label = `${t.title}${t.year ? ` (${t.year})` : ''}`;
  return `
      <li><button class="tile poster${large ? ' large' : ''}" type="button" data-open="${t.key}" aria-label="${esc(label)}" title="${esc(label)}">
        <img src="${await img(large ? t.poster_large : t.poster)}" alt="" loading="lazy">
        <span class="tile-sub">${esc(t.year ?? '')}${esc(svc)}</span>
      </button></li>`;
}

async function backdropTile(t) {
  return `
      <li><button class="tile wide" type="button" data-open="${t.key}">
        <img class="wide-bg" src="${await img(t.backdrop_small)}" alt="" loading="lazy">
        <span class="wide-shade"></span>
        ${t.logo ? `<img class="wide-logo" src="${await img(t.logo)}" alt="${esc(t.title)}" loading="lazy">` : `<span class="wide-title">${esc(t.title)}</span>`}
      </button></li>`;
}

// Pick which service to show under each poster so a row isn't all one
// service: no service should repeat within 3 tiles. Searches the whole row for
// the best combination, preferring services without a library card or login,
// and keeps repeats only where a title is on a single service.
function spreadServices(titles) {
  const opts = titles.map((t) => mains(t).map((w, rank) => ({ w, cost: rank * 0.01 })));
  const memo = new Map();
  const best = (i, last) => {
    if (i === titles.length) return { cost: 0, picks: [] };
    const key = i + '|' + last.join(',');
    if (memo.has(key)) return memo.get(key);
    let result;
    const choices = opts[i].length ? opts[i] : [{ w: null, cost: 0 }];
    for (const o of choices) {
      const clash = o.w && last.includes(o.w.service) ? 100 : 0;
      const rest = best(i + 1, [...last, o.w?.service ?? '-'].slice(-3));
      const total = clash + o.cost + rest.cost;
      if (!result || total < result.cost) result = { cost: total, picks: [o.w, ...rest.picks] };
    }
    memo.set(key, result);
    return result;
  };
  return best(0, []).picks;
}

async function row(r) {
  const list = r.items.map((key) => T[key]).filter((t) => t && t.available);
  const shown = spreadServices(list);
  shown.forEach((p, n) => {
    const near = shown.slice(Math.max(0, n - 3), n).filter(Boolean).map((x) => x.service);
    if (p && r.style !== 'backdrop' && near.includes(p.service)) {
      repeats.push(`${r.title}: "${list[n].title}" is only free on ${p.label}, which also shows within 3 tiles of it. Moving it further along the row, or swapping it for a title on another service, would fix this.`);
    }
  });
  const tiles = [];
  for (const [n, t] of list.entries()) {
    tiles.push(r.style === 'backdrop' ? await backdropTile(t) : await posterTile(t, r.style === 'poster-large', shown[n]));
  }
  return `
  <section class="row row-${r.style}" aria-labelledby="h-${r.id}">
    <header class="row-head">
      <div>
        <h2 id="h-${r.id}">${esc(r.title)}</h2>
        ${r.subtitle ? `<p class="row-sub">${esc(r.subtitle)}</p>` : ''}
      </div>
      <div class="row-arrows">
        <button type="button" class="row-arrow" data-dir="-1" aria-label="Scroll ${esc(r.title)} left"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>
        <button type="button" class="row-arrow" data-dir="1" aria-label="Scroll ${esc(r.title)} right"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
    </header>
    <ul class="strip">${tiles.join('')}
    </ul>
  </section>`;
}

// Data the detail panel needs, keyed by title.
async function detailData() {
  const out = {};
  for (const t of Object.values(T)) {
    out[t.key] = {
      title: t.title, meta: metaLine(t), overview: t.overview, note: t.note,
      rating: t.rating, where: mains(t), extras: extras(t), link: t.watch_link,
      backdrop: await img(t.backdrop_small), logo: t.logo ? await img(t.logo) : '',
    };
  }
  return out;
}

const repeats = [];

// ---------- page ----------
const sections = [];
for (const r of catalog.rows) sections.push(r.style === 'hero' ? await hero(r) : await row(r));
const details = await detailData();

const CSS = `
/* Layout: a streaming home screen. Full-bleed carousel, then sideways-scrolling rows. */
/* TOKENS: change the look here. */
:root {
  --bg: #101114;
  --surface: #191a1f;
  --surface-2: #23252c;
  --line: #2e3038;
  --fg: #f0eee9;
  --muted: #9b9da6;
  --accent: #e9b872;
  --on-accent: #17130c;
  --display: 'Big Shoulders Display', 'Arial Narrow', Impact, sans-serif;
  --body: 'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, Menlo, monospace;
  --gutter: clamp(16px, 4vw, 48px);
  color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); -webkit-font-smoothing: antialiased; }
img { max-width: 100%; }
button { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }

/* header */
.top { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 18px var(--gutter); }
.brand { font: 800 30px/1 var(--display); letter-spacing: .01em; text-decoration: none; color: var(--fg); }
.brand b { color: var(--accent); font-weight: 800; }
.tagline { font: 12px var(--mono); letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.top nav a { color: var(--muted); text-decoration: none; font-size: 14px; }
.top nav a:hover { color: var(--fg); }

/* carousel */
.hero { position: relative; margin-inline: var(--gutter); border-radius: 10px; overflow: hidden; background: var(--surface); aspect-ratio: 16 / 7; min-height: 340px; max-height: 640px; }
.slides { position: absolute; inset: 0; }
.slide { position: absolute; inset: 0; opacity: 0; visibility: hidden; transition: opacity .7s ease, visibility 0s linear .7s; }
.slide.is-active { opacity: 1; visibility: visible; transition: opacity .7s ease; }
.slide-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.slide.is-active .slide-bg { animation: drift 9s ease-out both; }
@keyframes drift { from { transform: scale(1.06); } to { transform: scale(1); } }
.slide-shade { position: absolute; inset: 0; background:
  linear-gradient(to top, rgba(10,10,12,.92) 0%, rgba(10,10,12,.35) 45%, rgba(10,10,12,0) 70%),
  linear-gradient(to right, rgba(10,10,12,.7) 0%, rgba(10,10,12,0) 50%); }
.slide-logo { position: absolute; right: 6%; bottom: 13%; width: min(30%, 420px); max-height: 38%; object-fit: contain; object-position: right bottom; filter: drop-shadow(0 4px 18px rgba(0,0,0,.55)); }
.slide-title { position: absolute; right: 6%; bottom: 13%; width: 32%; margin: 0; text-align: right; font: 800 clamp(28px, 4.5vw, 64px)/.95 var(--display); text-transform: uppercase; text-wrap: balance; }
.slide-info { position: absolute; left: 5%; bottom: 12%; max-width: min(46%, 520px); display: grid; gap: 8px; justify-items: start; }
.eyebrow { font: 11px var(--mono); letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
.slide-meta { margin: 0; font-size: 15px; color: var(--fg); }
.slide-note { margin: 0; font-size: 16px; line-height: 1.45; }
.slide-free { margin: 0; font: 12px var(--mono); color: var(--muted); }
.btn { margin-top: 6px; border: 0; border-radius: 999px; padding: 10px 20px; background: var(--accent); color: var(--on-accent); font-weight: 500; cursor: pointer; }
.btn:hover { filter: brightness(1.08); }
.hero-arrow { position: absolute; top: 50%; translate: 0 -50%; width: 46px; height: 46px; border-radius: 50%; border: 1px solid rgba(255,255,255,.18); background: rgba(16,17,20,.55); backdrop-filter: blur(6px); display: grid; place-items: center; cursor: pointer; opacity: .85; }
.hero-arrow:hover { opacity: 1; background: rgba(16,17,20,.8); }
.hero-arrow svg, .row-arrow svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 2; }
.hero-arrow.prev { left: 14px; } .hero-arrow.next { right: 14px; }
.hero-dots { position: absolute; left: 50%; bottom: 14px; translate: -50% 0; display: flex; gap: 4px; }
.hero-dots button { border: 0; background: none; padding: 8px 2px; cursor: pointer; }
.hero-dots span { display: block; width: 26px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.3); overflow: hidden; }
.hero-dots .is-active span { background: rgba(255,255,255,.3); position: relative; }
.hero-dots .is-active span::after { content: ''; position: absolute; inset: 0; background: var(--fg); transform-origin: left; animation: fill var(--hero-delay, 7s) linear both; }
.hero.is-paused .hero-dots .is-active span::after { animation-play-state: paused; }
@keyframes fill { from { transform: scaleX(0); } to { transform: scaleX(1); } }

/* rows */
main { display: grid; gap: clamp(28px, 4vw, 44px); padding-bottom: 56px; }
.row { display: grid; gap: 12px; min-width: 0; }
.row-head { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding-inline: var(--gutter); }
.row-head h2 { margin: 0; font: 800 clamp(24px, 3vw, 34px)/1 var(--display); text-transform: uppercase; letter-spacing: .01em; text-wrap: balance; }
.row-sub { margin: 4px 0 0; color: var(--muted); font-size: 14px; }
.row-arrows { display: flex; gap: 6px; }
.row-arrow { width: 36px; height: 36px; border-radius: 50%; border: 1px solid var(--line); background: var(--surface); display: grid; place-items: center; cursor: pointer; }
.row-arrow:hover { background: var(--surface-2); }
.strip { list-style: none; margin: 0; padding: 4px var(--gutter) 10px; display: flex; gap: 14px; overflow-x: auto; scroll-snap-type: x mandatory; scroll-padding-inline: var(--gutter); scrollbar-width: none; }
.strip::-webkit-scrollbar { display: none; }
.strip li { flex: none; scroll-snap-align: start; }

.tile { display: grid; gap: 7px; padding: 0; border: 0; background: none; text-align: left; cursor: pointer; }
.tile img { display: block; border-radius: 6px; background: var(--surface); transition: transform .25s ease, box-shadow .25s ease; }
.tile:hover img, .tile:focus-visible img { transform: translateY(-4px); box-shadow: 0 14px 30px rgba(0,0,0,.45); }
.poster img { width: clamp(128px, 14vw, 158px); aspect-ratio: 2 / 3; object-fit: cover; }
.poster.large img { width: clamp(200px, 24vw, 300px); }
.tile-sub { font: 11px/1.3 var(--mono); color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: clamp(128px, 14vw, 158px); }
.poster.large .tile-sub { font-size: 12px; max-width: clamp(200px, 24vw, 300px); }
.tile:hover .tile-sub, .tile:focus-visible .tile-sub { color: var(--fg); }

.wide { position: relative; width: clamp(280px, 30vw, 400px); aspect-ratio: 16 / 9; border-radius: 6px; overflow: hidden; display: block; }
.wide .wide-bg { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; border-radius: 0; }
.wide-shade { position: absolute; inset: 0; background: linear-gradient(to top, rgba(10,10,12,.88), rgba(10,10,12,.1) 60%); }
.wide .wide-logo { position: absolute; left: 6%; bottom: 10%; width: auto; max-width: 52%; max-height: 34%; object-fit: contain; object-position: left bottom; background: none; border-radius: 0; filter: drop-shadow(0 2px 10px rgba(0,0,0,.6)); }
.wide-title { position: absolute; left: 6%; bottom: 10%; width: 60%; font: 800 26px/1 var(--display); text-transform: uppercase; }
.wide:hover .wide-bg { transform: scale(1.04); box-shadow: none; }

/* detail panel */
dialog { width: min(680px, calc(100vw - 32px)); max-height: calc(100vh - 48px); padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); color: var(--fg); overflow: auto; }
dialog::backdrop { background: rgba(5,5,7,.72); backdrop-filter: blur(3px); }
.d-art { position: relative; aspect-ratio: 16 / 8; background: var(--surface-2); }
.d-art img.bg { width: 100%; height: 100%; object-fit: cover; display: block; }
.d-art::after { content: ''; position: absolute; inset: 0; background: linear-gradient(to top, var(--surface), transparent 60%); }
.d-art img.logo { position: absolute; left: 24px; bottom: 16px; max-width: 50%; max-height: 40%; object-fit: contain; z-index: 1; }
.d-body { display: grid; gap: 12px; padding: 4px 24px 24px; }
.d-body h3 { margin: 0; font: 800 32px/1 var(--display); text-transform: uppercase; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.d-meta { margin: 0; color: var(--muted); font-size: 14px; }
.d-note { margin: 0; padding: 12px 14px; border-left: 2px solid var(--accent); background: var(--surface-2); border-radius: 0 6px 6px 0; }
.d-note b { display: block; font: 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--accent); margin-bottom: 2px; font-weight: 400; }
.d-over { margin: 0; line-height: 1.6; }
.d-free h4 { margin: 0 0 8px; font: 11px var(--mono); letter-spacing: .12em; text-transform: uppercase; color: var(--muted); font-weight: 400; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { border: 1px solid var(--line); border-radius: 999px; padding: 4px 12px; font-size: 13px; background: var(--bg); }
.chip small { color: var(--muted); }
.d-actions { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.d-actions a { text-decoration: none; }
.close { position: absolute; top: 12px; right: 12px; z-index: 2; width: 36px; height: 36px; border-radius: 50%; border: 0; background: rgba(16,17,20,.7); cursor: pointer; font-size: 20px; line-height: 1; }

/* footer */
footer { border-top: 1px solid var(--line); padding: 28px var(--gutter) 40px; display: grid; gap: 14px; color: var(--muted); font-size: 13px; }
footer .about { color: var(--fg); font-size: 15px; max-width: 64ch; margin: 0; }
footer p { margin: 0; max-width: 80ch; }
footer .updated { font: 11px var(--mono); letter-spacing: .08em; text-transform: uppercase; }

@media (max-width: 720px) {
  .hero { aspect-ratio: 4 / 5; max-height: none; }
  .slide-shade { background: linear-gradient(to top, rgba(10,10,12,.95) 0%, rgba(10,10,12,.5) 50%, rgba(10,10,12,0) 75%); }
  .slide-logo, .slide-title { left: 6%; right: auto; bottom: auto; top: 40%; width: 70%; object-position: left bottom; text-align: left; }
  .slide-info { left: 6%; right: 6%; bottom: 48px; max-width: none; }
  .hero-arrow, .row-arrows { display: none; }
  .tagline { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .slide, .slide.is-active { transition: none; }
  .slide.is-active .slide-bg { animation: none; }
  .tile img, .wide .wide-bg { transition: none; }
}
`;

const JS = `
const DETAILS = ${JSON.stringify(details).replace(/</g, '\\u003c')};
const DELAY = 7000;

// Carousel
(() => {
  const hero = document.querySelector('.hero');
  if (!hero) return;
  const slides = [...hero.querySelectorAll('.slide')];
  const dots = [...hero.querySelectorAll('.hero-dots button')];
  let i = 0, timer = null, paused = false;
  hero.style.setProperty('--hero-delay', DELAY + 'ms');
  const show = (n) => {
    slides[i].classList.remove('is-active'); slides[i].setAttribute('aria-hidden', 'true');
    dots[i].classList.remove('is-active'); dots[i].setAttribute('aria-selected', 'false');
    i = (n + slides.length) % slides.length;
    slides[i].classList.add('is-active'); slides[i].removeAttribute('aria-hidden');
    dots[i].classList.add('is-active'); dots[i].setAttribute('aria-selected', 'true');
    const span = dots[i].querySelector('span'); span.style.animation = 'none'; span.offsetWidth; span.style.animation = '';
    restart();
  };
  const restart = () => { clearTimeout(timer); if (!paused) timer = setTimeout(() => show(i + 1), DELAY); };
  const pause = (p) => { paused = p; hero.classList.toggle('is-paused', p); if (p) clearTimeout(timer); else restart(); };
  hero.querySelector('.prev').addEventListener('click', () => show(i - 1));
  hero.querySelector('.next').addEventListener('click', () => show(i + 1));
  dots.forEach((d, n) => d.addEventListener('click', () => show(n)));
  hero.addEventListener('mouseenter', () => pause(true));
  hero.addEventListener('mouseleave', () => pause(false));
  hero.addEventListener('focusin', () => pause(true));
  hero.addEventListener('focusout', (e) => { if (!hero.contains(e.relatedTarget)) pause(false); });
  hero.addEventListener('keydown', (e) => { if (e.key === 'ArrowLeft') show(i - 1); if (e.key === 'ArrowRight') show(i + 1); });
  let x0 = null;
  hero.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  hero.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(i + (dx < 0 ? 1 : -1)); x0 = null; });
  document.addEventListener('visibilitychange', () => document.hidden ? clearTimeout(timer) : restart());
  restart();
})();

// Row arrows
document.querySelectorAll('.row').forEach((row) => {
  const strip = row.querySelector('.strip');
  row.querySelectorAll('.row-arrow').forEach((b) => b.addEventListener('click', () => {
    strip.scrollBy({ left: Number(b.dataset.dir) * strip.clientWidth * 0.85, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }));
});

// Detail panel
const dlg = document.getElementById('detail');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-open]');
  if (!btn) return;
  const d = DETAILS[btn.dataset.open];
  if (!d) return;
  dlg.querySelector('.d-content').innerHTML = \`
    <div class="d-art">\${d.backdrop ? \`<img class="bg" src="\${d.backdrop}" alt="">\` : ''}\${d.logo ? \`<img class="logo" src="\${d.logo}" alt="">\` : ''}</div>
    <div class="d-body">
      <h3\${d.logo ? ' class="sr"' : ''}>\${esc(d.title)}</h3>
      <p class="d-meta">\${esc(d.meta)}\${d.rating ? ' · TMDB ' + d.rating : ''}</p>
      \${d.note ? \`<p class="d-note"><b>Why I picked it</b>\${esc(d.note)}</p>\` : ''}
      <p class="d-over">\${esc(d.overview)}</p>
      <div class="d-free"><h4>Free to stream on</h4><div class="chips">\${d.where.map((w) => \`<span class="chip">\${esc(w.label)}</span>\`).join('')}</div></div>
      \${d.extras.length ? \`<div class="d-free"><h4>Also free with a library card or login</h4><div class="chips">\${d.extras.map((w) => \`<span class="chip">\${esc(w.label)} <small>· \${esc(w.requires)}</small></span>\`).join('')}</div></div>\` : ''}
      <div class="d-actions">\${d.link ? \`<a class="btn" href="\${d.link}" target="_blank" rel="noopener">See where to watch</a>\` : ''}</div>
    </div>\`;
  dlg.showModal();
});
dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('.close')) dlg.close(); });
`;

const year = new Date().getFullYear();
const content = `
<header class="top">
  <a class="brand" href="#">m<b>sugg</b>estions</a>
  <span class="tagline">Free to stream · Picked by Matt</span>
  <nav><a href="#about">About</a></nav>
</header>
<main>
${sections.join('\n')}
</main>
<footer id="about">
  <p class="about">msuggestions is a short, hand-picked list of movies and series you can stream free right now on services like Tubi, Pluto TV and The Roku Channel. Every pick links out to the official place to watch.</p>
  <p>This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability is provided by JustWatch. msuggestions is an independent guide and is not affiliated with any streaming service.</p>
  <p class="updated">Availability checked ${esc(catalog.updated)} · © ${year} msuggestions</p>
</footer>
<dialog id="detail" aria-label="Title details"><button class="close" type="button" aria-label="Close">×</button><div class="d-content"></div></dialog>
<script>${JS}</script>
`;

const fonts = `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@600;800&family=IBM+Plex+Mono&family=IBM+Plex+Sans:wght@400;500&display=swap">`;

if (EMBED) {
  // Preview: page content only (the viewer supplies the document wrapper).
  mkdirSync(dirname(EMBED), { recursive: true });
  writeFileSync(EMBED, `<title>msuggestions Home</title>\n${fonts}\n<style>${CSS}</style>\n${content}`);
  console.log(`Wrote preview ${EMBED}`);
} else {
  writeFileSync('public/index.html', `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>msuggestions · Free movies and series, hand picked</title>
<meta name="description" content="A short, hand-picked list of movies and series you can stream free right now on Tubi, Pluto TV, The Roku Channel and more.">
<meta name="theme-color" content="#101114">
${fonts}
<style>${CSS}</style>
</head>
<body>
${content}
</body>
</html>
`);
  console.log('Wrote public/index.html');
}

if (repeats.length) {
  const msg = ['### Service variety', '', ...repeats.map((x) => `- ${x}`)].join('\n');
  console.log(msg);
  if (process.env.GITHUB_STEP_SUMMARY && !EMBED) appendFileSync(process.env.GITHUB_STEP_SUMMARY, msg + '\n');
}
