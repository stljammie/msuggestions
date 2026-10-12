# msuggestions

A hand-picked guide to movies and series that are free to stream on services like Tubi, Pluto TV and The Roku Channel. Every pick links out to the official service.

## How it works

1. **`data/picks.json`** is the list of picks, grouped into rows. This is the only file you need to edit.
2. **Build catalog** (GitHub Action, nightly and whenever picks change) looks up each pick on TMDB: details, artwork, and where it's free in the US. It writes `public/data/catalog.json` and flags any pick that's no longer free.
3. The website (in `public/`) reads that file. Cloudflare Pages publishes it.

## Tools (GitHub > Actions tab)

- **1. Check TMDB connection**: confirms the API token works and counts free titles per service.
- **2. Explore free titles**: search what's free by service, genre and years, to find picks. Results show on the run's summary page, with a CSV download.
- **3. Build catalog**: rebuilds the site data from your picks.

## Setup

The TMDB API Read Access Token is stored as the repository secret `TMDB_TOKEN` (Settings > Secrets and variables > Actions). It is never stored in the code.

## Credits

This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming availability data is provided by JustWatch. msuggestions is an independent guide and is not affiliated with any streaming service.
