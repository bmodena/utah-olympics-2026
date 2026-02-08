# Park City at the 2026 Winter Olympics

A real-time tracker for Park City, Utah athletes competing in the Milano Cortina 2026 Winter Olympics. Built as a lightweight, static HTML/CSS/JS dashboard — no build tools, no frameworks, no Node.js required.

**Live site:** [utah2026.townlift.com](https://utah2026.townlift.com)

## What It Does

- Displays the Olympic medal event schedule filtered to events where Park City athletes are competing
- Three views: **Date** (default), **Sport**, and **Athlete**
- Shows broadcast info (NBC, USA Network, Peacock) with Mountain Time conversions
- "Add to Calendar" for each event (Google Calendar, Outlook, Yahoo, .ics download)
- Full-text search across athletes, sports, events, and TV networks
- Past event toggle with muted styling
- Auto-scrolls to today's events on load
- Embeddable via iframe with auto-height resizing
- Newsletter CTA banner for TownLift subscribers
- Social sharing (X, Facebook, Email, Copy Link)
- GA4 analytics tracking for all interactions

## Architecture

```
index.html              Single-page app shell
js/
  config.js             Global configuration (API keys, data paths)
  athletes.js           Athlete roster fetching + CSV parsing
  schedule.js           Schedule API fetching + normalization + athlete matching
  app.js                UI rendering, routing, filtering, search, calendar
css/
  styles.css            Mobile-first responsive styles (no preprocessor)
data/
  athletes-full.csv     Fallback athlete roster (42 athletes)
  athletes-seed.csv     Template for Google Sheets import
  broadcast.json        TV network rules per sport
  Park_City_Nation_Athletes.csv   Source data from YSA
embed-example.html      Three iframe embed options with code snippets
vercel.json             Deployment headers (allows iframe embedding)
site.webmanifest        PWA manifest for home screen install
```

### Data Flow

```
Google Sheets (CSV) ──→ athletes.js ──→ normalized athletes ──┐
                                                               │
RapidAPI ──→ schedule.js ──→ normalize ──→ broadcast rules ──→├──→ matchScheduleToAthletes()
                                                               │
broadcast.json ──→ applyBroadcastRules() ─────────────────────┘
                                                               │
                                                               ▼
                                                     app.js renders DOM
```

1. **Athletes** are fetched from a published Google Sheet (falls back to `data/athletes-full.csv`)
2. **Schedule** is fetched from the [Milano Cortina 2026 Olympics API](https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api) on RapidAPI
3. Schedule events are **normalized** (sport classification, venue extraction, discipline cleaning, gender detection)
4. **Broadcast rules** from `data/broadcast.json` assign TV networks to each event
5. Events are **matched to athletes** by sport, gender, and specific event discipline
6. Only events with at least one Park City athlete are displayed

### Caching Strategy

All data is cached in `localStorage` to minimize API calls:

| Data | Cache Key | TTL (during Olympics) | TTL (off-season) |
|------|-----------|----------------------|-------------------|
| Schedule | `utah_olympics_schedule_v1` | 4 hours | 24 hours |
| Broadcast | `utah_olympics_broadcast_v1` | 4 hours | 24 hours |
| Athletes | `utah_olympics_athletes_v5` | 1 hour | 1 hour |

Append `?refresh` to the URL to force a cache bypass.

## Setup

### Prerequisites

- A web server (even `python3 -m http.server` works)
- A [RapidAPI](https://rapidapi.com) account with a key for the Milano Cortina 2026 Olympics API

### Quick Start

```bash
# Clone and serve
cd html/
python3 -m http.server 8000
# Open http://localhost:8000
```

### Configuration

Edit `js/config.js`:

| Key | Description |
|-----|-------------|
| `RAPIDAPI_KEY` | Your RapidAPI key ([get one here](https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api)) |
| `RAPIDAPI_HOST` | API host (default: `milano-cortina-2026-olympics-api.p.rapidapi.com`) |
| `GOOGLE_SHEET_ID` | Published Google Sheet ID for athlete roster |
| `FALLBACK_ATHLETES` | Local CSV path for when Google Sheets is unavailable |
| `BROADCAST_DATA` | Path to broadcast rules JSON |
| `SITE_URL` | Canonical URL for share links |

### Updating the Athlete Roster

The athlete roster lives in a Google Sheet for easy editing by the content team:

1. Open the Google Sheet (ID in `config.js`)
2. Edit athlete rows — columns: `Sport, Athlete, Discipline, Country, Connection, isParkCity, Program, Status, Gender, Events`
3. The `Events` column is semicolon-delimited (e.g., `Downhill;Super-G`) and controls which schedule events the athlete appears under
4. Set `Status` to `inactive` to hide an athlete
5. Changes appear on the site within 1 hour (or immediately with `?refresh`)

To update the local fallback CSV, export the Google Sheet and save to `data/athletes-full.csv`.

### Updating Broadcast Rules

Edit `data/broadcast.json`:

```json
{
  "streaming": { "network": "Peacock", "type": "streaming" },
  "sportNetworks": {
    "Alpine Skiing": "NBC / USA Network",
    "Figure Skating": "NBC"
  },
  "medalPrimetime": { "network": "NBC", "time": "19:00" },
  "eventOverrides": {
    "event-id-here": [{ "network": "NBC", "type": "live", "time": "14:00" }]
  }
}
```

- `sportNetworks`: Maps sport display name to live TV network
- `medalPrimetime`: NBC primetime slot for all medal events (time in MT)
- `eventOverrides`: Override broadcast info for specific event IDs
- `streaming`: Applied to all events (Peacock)

## API Notes

### Milano Cortina 2026 Olympics API (RapidAPI)

**Host:** `milano-cortina-2026-olympics-api.p.rapidapi.com`

**Endpoints used:**
- `GET /events` — All events (filtered to medal events by the app)

**Available endpoints (for reference):**
- `/events/today` — Today's events
- `/events/upcoming` — Upcoming events
- `/events/medal-events` — Medal events only
- `/events/{id}` — Single event
- `/sports` — All sports with stats
- `/sports/{code}/events` — Events by sport
- `/countries` — All countries
- `/countries/{code}/events` — Events by country
- `/search?q=query` — Full-text search

**Known quirks:**
- ~38 events have `sport: "unknown"` — the app reclassifies them using venue and discipline text (see `classifyUnknownEvent()` in schedule.js)
- Some snowboard events are labeled `freestyle_skiing` — fixed by checking for `sbd`, `pgs`, `sbx` prefixes
- Venue info is sometimes null, with venue names concatenated into the discipline string
- Discipline text includes "Medal Event" and venue names without separators
- Returns 127 medal events vs 116 official (API counts sub-rounds like Big Final / Small Final separately)
- **Ski Mountaineering** (new for 2026) is completely absent from the API
- **Snowboard** only has 3 of 11 official events in the API

### Timezone Handling

- API times are in **CET (Central European Time, UTC+1)**
- The app converts to the user's local timezone using `Date` + `toLocaleTimeString()`
- Broadcast times in `broadcast.json` are in **Mountain Time**
- The `cetToMountain()` helper uses a -8 hour offset (safe because February has no DST in either timezone)

## Embedding

Three embed options are documented in `embed-example.html`:

**Option 1 — Fixed height:**
```html
<iframe src="https://utah2026.townlift.com/"
  style="width: 100%; height: 800px; border: none;"
  loading="lazy" title="Park City at the 2026 Winter Olympics">
</iframe>
```

**Option 2 — Viewport height (recommended):**
```html
<div style="width: 100%; height: 100vh; height: 100dvh; overflow: hidden;">
  <iframe src="https://utah2026.townlift.com/"
    style="width: 100%; height: 100%; border: none;"
    loading="lazy" title="Park City at the 2026 Winter Olympics">
  </iframe>
</div>
```

**Option 3 — Auto-resizing with JavaScript:**
The app broadcasts `postMessage({ type: 'pc-olympics-resize', height: N })` to the parent window on every render and resize. See `embed-example.html` for the listener code.

`vercel.json` sets `X-Frame-Options: ALLOWALL` and `Content-Security-Policy: frame-ancestors *` to allow embedding on any domain.

## Deployment

The site is deployed on **Vercel** as a static site.

```bash
# Install Vercel CLI (if needed)
npm i -g vercel

# Deploy
vercel --prod
```

No build step required — Vercel serves the static files directly.

### Cache Busting

CSS and JS files are loaded with a version query parameter (`?v=17`). Increment this number in `index.html` when deploying changes:

```html
<link rel="stylesheet" href="css/styles.css?v=18">
<script src="js/config.js?v=18"></script>
<script src="js/athletes.js?v=18"></script>
<script src="js/schedule.js?v=18"></script>
<script src="js/app.js?v=18"></script>
```

## File Reference

| File | Purpose |
|------|---------|
| `js/config.js` | API keys, data paths, site URL, timezone detection |
| `js/athletes.js` | Fetches athlete CSV from Google Sheets (or local fallback), parses and normalizes |
| `js/schedule.js` | Fetches events from RapidAPI, normalizes data, reclassifies unknown sports, applies broadcast rules, matches athletes to events |
| `js/app.js` | DOM rendering, hash routing, filtering/sorting/search, calendar integration, share buttons, newsletter CTA, GA4 tracking, iframe support |
| `css/styles.css` | Mobile-first responsive styles with 3 breakpoints (base, 641px, 961px) |
| `data/athletes-full.csv` | Local athlete roster fallback (42 Park City athletes across 10 sports) |
| `data/broadcast.json` | TV network assignments per sport + primetime/streaming rules |
| `index.html` | App shell with SEO meta tags, Open Graph, PWA manifest, GA4 snippet |
| `embed-example.html` | Three iframe embed options with copy-paste code |
| `vercel.json` | Deployment headers allowing iframe embedding |
| `site.webmanifest` | PWA manifest for mobile home screen install |

## Sports Covered

The app tracks 42 Park City athletes across these sports:

| Sport | Athletes | Example Events |
|-------|----------|----------------|
| Alpine Skiing | 6 | Downhill, Giant Slalom, Slalom, Super-G |
| Bobsleigh | 1 | Two-Man, Four-Man |
| Cross-Country Skiing | 1 | Sprint, Skiathlon, 10km |
| Freestyle Skiing | 22 | Aerials, Moguls, Dual Moguls, Slopestyle, Big Air, Halfpipe |
| Luge | 2 | Singles, Team Relay |
| Nordic Combined | 1 | Individual |
| Ski Jumping | 3 | NH Individual, LH Individual, Team |
| Snowboard | 3 | Snowboard Cross |
| Speed Skating | 2 | 5000m, 10000m, Team Pursuit, Mass Start |

## Credits

- **Data source:** [Park City Nation / YSA](https://ysausa.org/parkcitynation/)
- **Schedule API:** [Milano Cortina 2026 Olympics API](https://rapidapi.com/jxancestral17/api/milano-cortina-2026-olympics-api) on RapidAPI
- **Presented by:** [TownLift](https://townlift.com) — Park City's Community News
- **Developed by:** [TMBR Creative Agency](https://wearetmbr.com/) — Web Development, Branding & Custom Applications

Not affiliated with the IOC or any National Olympic Committee.
