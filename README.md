# RTLM to Monday.com Sync Bot

Automated pipeline for Fox Media Cloud that replaces a manual copy-paste workflow. Scrapes live sporting-event listings from the RTLM portal (behind Okta SSO), filters out infomercials, maps network Call Signs to approved labels, and syncs the cleaned data to a Monday.com board through a MuleSoft integration layer. Includes an Electron desktop GUI and can be packaged as a standalone macOS app for non-technical users.

## Demo

<video src="demo.mov" controls width="100%"></video>

## System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                       FOX Corporate Network                      │
│                                                                  │
│  ┌──────────┐           ┌─────────────────────┐                 │
│  │   Okta   │◄─────────►│  Playwright Scraper │                 │
│  │   SSO    │  session   │  (Node.js)          │                 │
│  └──────────┘  cookies   │                     │                 │
│                          │  • Launch Chromium   │                 │
│  ┌──────────┐  headless  │  • SSO handling      │                 │
│  │   RTLM   │◄─────────►│  • Filter + scrape   │                 │
│  │  Portal  │  browser   │  • Dedup + export    │                 │
│  └──────────┘            └──────────┬──────────┘                 │
│                              CSV    │  POST /sync                │
│       ┌─────────────┐              │                             │
│       │  Electron   │              │                             │
│       │  Desktop GUI├──────────────┤                             │
│       │  (optional) │  triggers    │                             │
│       └─────────────┘              │                             │
│                                     ▼                            │
│                          ┌─────────────────────┐                 │
│                          │  MuleSoft Flow      │                 │
│                          │  (Mule 4 / DataWeave)│                 │
│                          │                     │                 │
│                          │  • Parse CSV        │                 │
│                          │  • Filter rows      │                 │
│                          │  • Map Call Signs   │                 │
│                          │  • Retry logic      │                 │
│                          └──────────┬──────────┘                 │
│                                     │  GraphQL                   │
└─────────────────────────────────────┼────────────────────────────┘
                                      ▼
                           ┌─────────────────────┐
                           │    Monday.com        │
                           │    Board             │
                           │                      │
                           │  Headline            │
                           │  Start / End Time    │
                           │  Call Sign           │
                           │  TMS ID              │
                           │  Foxipedia ID        │
                           └─────────────────────┘
```

**Data flow**: RTLM Portal → Playwright (headless Chromium) → CSV → MuleSoft HTTP listener (CloudHub) → DataWeave transform → Monday.com GraphQL API

## Project Structure

```
rtlm-monday-sync/
├── scraper-bot/
│   ├── auth.js                # Okta SSO authentication
│   ├── scraper.js             # RTLM scraper + MuleSoft sync
│   ├── electron/              # Desktop GUI (Electron)
│   │   ├── main.js            # App lifecycle, IPC handlers, process management
│   │   ├── preload.js         # Context bridge for renderer
│   │   ├── index.html         # Main window layout
│   │   ├── renderer.js        # UI logic, log display, button handlers
│   │   └── styles.css         # Dark/light theme, responsive layout
│   ├── scripts/
│   │   └── prepare-playwright-browsers.js  # Bundle Chromium for packaged app
│   ├── .env.example           # Copy to .env to override MuleSoft URL
│   ├── test-consistency.js    # Multi-run consistency test
│   ├── audit.js               # Monday.com item count verification
│   ├── package.json           # Node dependencies and npm scripts
│   ├── storageState.json      # Saved session cookies (git-ignored)
│   └── test-runs/             # Consistency test output (git-ignored)
├── src/
│   └── main/
│       ├── mule/
│       │   └── rtlm-monday-sync.xml   # MuleSoft flow: filters, maps, pushes to Monday.com
│       └── resources/
│           └── log4j2.xml
├── pom.xml                    # MuleSoft / Maven config
└── README.md
```

## Components

| Component | Role |
|---|---|
| `scraper-bot/auth.js` | **Run first.** Opens a browser for Okta SSO login and saves session cookies to `storageState.json`. |
| `scraper-bot/scraper.js` | Scrapes RTLM listings with SSO handling, popup dismissal, adaptive polling, deduplication, and date filtering. Saves CSV and POSTs to MuleSoft. |
| `scraper-bot/electron/` | Electron desktop GUI — buttons for auth, sync, and stop; live log output; optional success sound; dark/light theme. Can be packaged as a standalone macOS `.app`. |
| `scraper-bot/test-consistency.js` | Runs `scraper.js` N times (default 10), compares SHA-256 hashes to verify identical output across runs. |
| `scraper-bot/audit.js` | Fetches all items from the Monday.com board and reports the total count. |
| `src/main/mule/rtlm-monday-sync.xml` | MuleSoft flow that receives CSV from the scraper, filters infomercials, maps Call Signs to approved labels, and creates items on Monday.com. |

## Getting Started

### From Source (developers)

```bash
cd scraper-bot
npm install
npx playwright install chromium

# Optional: configure MuleSoft endpoint
cp .env.example .env
# Edit .env with your deployment URL

# Authenticate (opens browser — log in via Okta, then confirm)
npm run auth

# Run via GUI or CLI
npm run gui        # Electron desktop app
npm run scrape     # CLI — headless scrape + sync
```

In the GUI, follow the on-screen steps: **Log in to RTLM** → **I'm logged in — save session** → **Run sync**, then watch the live log for results.

### Packaged macOS App

```bash
cd scraper-bot
npm install
npm run dist:mac
```

Produces `scraper-bot/dist/mac-arm64/RTLM Monday Sync.app` (drag to Applications). The packaged app bundles Chromium — recipients don't need Node.js installed.

## Usage

All npm scripts run from the `scraper-bot/` directory.

### Full Pipeline (Scrape + MuleSoft + Monday.com)

The MuleSoft app should be deployed to CloudHub (or another reachable URL). By default the scraper POSTs to the CloudHub HTTPS endpoint; override with `MULESOFT_URL` in `.env` or your shell.

For local Mule only, set `MULESOFT_URL=http://localhost:8081/sync` in `.env` and run the Mule app via Anypoint Code Builder.

```bash
npm run scrape
```

### Headless mode (no browser window)

```bash
npm run scrape:headless
```

### Scrape only (skip MuleSoft sync)

```bash
npm run scrape:only
```

### Custom output path

```bash
SCRAPER_OUTPUT_PATH=/path/to/output.csv node scraper.js
```

### Consistency test (10 consecutive headless runs)

```bash
npm run test:consistency
```

Runs 10 consecutive headless scrapes (with sync disabled), saves each to `test-runs/run-N.csv`, and compares SHA-256 hashes to verify all runs produce identical output. Reports timing, row counts, and diffs for any inconsistencies.

### Audit Monday.com

```bash
npm run audit
```

## What the Scraper Does

`scraper.js` performs the following automated steps:

1. **Launches Chromium** with saved session cookies
2. **Navigates to RTLM** at `mam.mediacloud.fox/tools/rtlm/listings`
3. **Handles SSO redirects** -- if the session has expired, detects the Okta redirect and waits up to 5 minutes for manual login
4. **Dismisses popups** -- automatically removes Aspera Connect overlays and any dialog elements on the parent page
5. **Persists the refreshed session** -- saves updated cookies to `storageState.json` so the next run won't need re-authentication
6. **Enters the RTLM iframe** -- the listing table lives inside a cross-origin `mclive-iframe`
7. **Enables the "Is Sporting Event" column** via the table settings panel
8. **Applies callsign filters** -- selects FS1, FS2, BTN, FSCPL, FOXD, FBCS, and BTNP001-BTNP040
9. **Applies "Is Live" filter** from the "More Filters" dropdown
10. **Scrapes all pages** of results, collecting only rows where "Is Sporting Event" has a check icon and the start time is within the next 7 days
11. **Deduplicates rows** and **excludes** "Series Name" and "Traffic Code" columns
12. **Exports to CSV** with BOM encoding (Excel-compatible)
13. **POSTs CSV to MuleSoft** at the configured `/sync` endpoint (unless `SKIP_SYNC=true`)

## Configuration

### Scraper Constants (`scraper.js`)

| Constant | Default | Description |
|---|---|---|
| `RTLM_URL` | `https://mam.mediacloud.fox/tools/rtlm/listings` | Target URL |
| `MULESOFT_URL` | CloudHub HTTPS endpoint (see `.env.example`) | MuleSoft listener; override via `.env` |
| `SCRAPE_TIMEOUT_MS` | 5 minutes | Maximum time for the scraping operation |
| `AUTH_TIMEOUT_MS` | 5 minutes | Maximum wait for manual SSO login |
| `NAV_TIMEOUT_MS` | 60 seconds | Timeout for page navigation and selector waits |
| `SSO_SETTLE_MS` | 3 seconds | Wait time to detect client-side SSO redirects |

Inside the `frame.evaluate()` block:

| Constant | Default | Description |
|---|---|---|
| `CALLSIGNS` | FS1, FS2, BTN, FSCPL, FOXD, FBCS, BTNP001-040 | Network callsigns to filter |
| `MORE_FILTERS` | `['Is Live']` | Toggle filters from the "More Filters" dropdown |
| `EXCLUDE_COLUMNS` | Series Name, Traffic Code | Columns omitted from the CSV output |
| `DAYS_AHEAD` | 7 | Only include events within this many days |

### Environment Variables

Variables can be set in the shell or in `scraper-bot/.env` (loaded automatically by `scraper.js` and the Electron app via `dotenv`). Packaged macOS apps read `~/Library/Application Support/RTLM Monday Sync/.env`.

| Variable | Description |
|---|---|
| `HEADLESS` | Set to `"true"` for headless mode (no browser window) |
| `SKIP_SYNC` | Set to `"true"` to skip the MuleSoft POST (scrape and save CSV only) |
| `MULESOFT_URL` | MuleSoft `/sync` URL (CloudHub HTTPS in production; `http://localhost:8081/sync` for local Mule) |
| `SCRAPER_OUTPUT_PATH` | Override the default CSV output location |
| `PLAYWRIGHT_BROWSERS_PATH` | Override Playwright's browser installation path |
| `MONDAY_API_KEY` | Monday.com API token (used by `audit.js` and MuleSoft config) |

## Output Format

The CSV file includes:

- **BOM prefix** (`\ufeff`) for Excel auto-detection of UTF-8
- **Header row** with all visible columns (excluding Series Name and Traffic Code), prepended with "Row #"
- **Data rows** with sequential row numbers, all values quoted and double-quote escaped
- **"Is Sporting Event" column** normalized to the text `TRUE`

Default output location: `scraper-bot/rtlm_upload_YYYY-MM-DD.csv`

## Authentication

### Initial setup

```bash
cd scraper-bot
npm run auth
```

This opens a browser at the RTLM URL. Log in through Okta SSO. When the dashboard is visible, press **Enter** in the terminal (or in the desktop app, click **I'm logged in — save session**). Your session cookies are saved to `storageState.json`.

### Session expiration

When the session expires, the scraper detects the SSO redirect and prints:

```
[AUTH] Login required. Please log in via the browser window...
```

Log in through the browser window that appeared. The scraper automatically:
- Waits for login to complete (up to 5 minutes)
- Re-navigates to the RTLM listings page
- Dismisses any popups
- Saves the refreshed session for future runs

## Architecture

### Scraper (`scraper.js`)

```
┌─────────────────────────────────────────┐
│  Configuration                          │  URLs, timeouts, dotenv
├─────────────────────────────────────────┤
│  Browser Setup                          │  Launch, context, dialog handler
├─────────────────────────────────────────┤
│  Navigation + SSO                       │  goto, redirect detection, re-nav
├─────────────────────────────────────────┤
│  Iframe + Popups                        │  Wait, dismiss, access, stabilize
├─────────────────────────────────────────┤
│  frame.evaluate()                       │  All in-iframe logic:
│    ├── Filter Config                    │    Callsigns, filters, cutoff
│    ├── DOM Selectors + Utilities        │    pollFor, setNativeValue, etc.
│    ├── Wait Utilities                   │    waitForAppReady, table, page
│    ├── Filter: Column                   │    ensureColumn with retry
│    ├── Filter: Callsign                 │    Two-phase selection
│    ├── Filter: More Filters             │    Menu toggle with state check
│    ├── Apply All Filters                │    Sequential execution + timing
│    ├── Read Table Structure             │    Header indexing
│    └── Paginated Scraping               │    Row extraction + pagination
├─────────────────────────────────────────┤
│  Output                                 │  CSV write
├─────────────────────────────────────────┤
│  MuleSoft Sync                          │  POST to /sync (unless SKIP_SYNC)
├─────────────────────────────────────────┤
│  Cleanup                                │  Browser close, exit code
└─────────────────────────────────────────┘
```

### Electron Desktop App (`electron/`)

The GUI wraps the same `auth.js` and `scraper.js` scripts in an Electron shell:

- **`main.js`** — App lifecycle, native menu with keyboard shortcuts (Cmd+Enter to sync, Cmd+. to stop), IPC handlers that spawn Node scripts as child processes with stdout/stderr piped to the renderer
- **`renderer.js`** — Button state management, live log display with auto-scroll, optional success chime, about dialog
- **`preload.js`** — Context bridge exposing a safe `window.api` surface (no `nodeIntegration`)
- Dark and light theme via `prefers-color-scheme`, with `nativeTheme` sync for the window chrome

Packaging uses `electron-builder` with `extraResources` to bundle Playwright's Chromium alongside the `.app` so end users don't need Node or npm.

### Key Design Decisions

- **`frame.evaluate()` for all iframe interaction**: The RTLM app runs in a cross-origin iframe. Playwright's `frame.evaluate()` executes JavaScript directly in the iframe's browser context, bypassing Same-Origin Policy restrictions.

- **Adaptive polling over fixed delays**: Functions like `waitForAppReady`, `waitForTableReady`, and `waitForPageChange` poll the DOM state instead of using fixed `setTimeout` delays. This reduced average execution time from ~44s to ~28s while improving reliability.

- **Two-phase callsign selection**: Phase 1 fast-scans visible dropdown options. Phase 2 types and searches for any remaining callsigns. This handles MUI Autocomplete's virtualized list efficiently.

- **Playwright-level iframe stabilization**: Before entering `frame.evaluate()`, the script uses `frame.waitForSelector()` at the Playwright level. This survives execution context destruction if the iframe's app navigates during initial load, preventing the "Execution context was destroyed" error.

### MuleSoft Flow (`rtlm-monday-sync.xml`)

Receives CSV data via HTTP POST at `/sync`, then:

1. Parses CSV with DataWeave
2. Filters out infomercial rows
3. Maps Call Signs to approved labels (e.g. `BTNP*` → `B1G+`, `FOXD` → `Fox-Digital`)
4. Creates each item on Monday.com via the Monday GraphQL API with retry logic (up to 5 retries)

## Testing & Validation

### Consistency Test

`test-consistency.js` runs the scraper 10 times in headless mode, saves each output to `test-runs/run-N.csv`, and compares SHA-256 hashes to verify deterministic output. Any hash mismatch triggers a line-by-line diff.

Sample output (10 consecutive runs, 2026-03-30):

```
============================================================
RESULTS SUMMARY
============================================================
  Run 1:  1610 rows, hash=a3f7b2c91d4e (27.3s)
  Run 2:  1610 rows, hash=a3f7b2c91d4e (26.8s)
  Run 3:  1610 rows, hash=a3f7b2c91d4e (28.4s)
  Run 4:  1610 rows, hash=a3f7b2c91d4e (27.1s)
  Run 5:  1610 rows, hash=a3f7b2c91d4e (26.5s)
  Run 6:  1610 rows, hash=a3f7b2c91d4e (27.9s)
  Run 7:  1610 rows, hash=a3f7b2c91d4e (28.0s)
  Run 8:  1610 rows, hash=a3f7b2c91d4e (27.6s)
  Run 9:  1610 rows, hash=a3f7b2c91d4e (26.9s)
  Run 10: 1610 rows, hash=a3f7b2c91d4e (27.4s)

CONSISTENCY: PASS -- All 10 successful runs produced identical output.

Output files saved in: test-runs/
```

All 10 runs produced the same 1610-row CSV with identical SHA-256 hashes. Average execution time: ~27.4s per run.

### Audit Verification

`audit.js` queries the Monday.com board via cursor-based pagination and reports total item count, confirming every scraped row was created:

```
🔍 Fetching all items from Monday (Target: 1610)...
📦 Retrieved 500 items so far...
📦 Retrieved 1000 items so far...
📦 Retrieved 1500 items so far...
📦 Retrieved 1610 items so far...
✅ Final Audit: Found 1610 items on Monday.
```

### What's Validated

| Check | Method | Result |
|---|---|---|
| Output determinism | SHA-256 hash comparison across 10 runs | PASS |
| Row count accuracy | Audit script vs. CSV line count | 1610/1610 match |
| Data integrity | MuleSoft retry logic (5 retries per item) | 0 failed items |
| Filter correctness | Manual spot-check of CSV vs. RTLM UI | Confirmed |

## Sample Execution Log

Full pipeline run (scrape → MuleSoft → Monday.com):

```
[NAV] Navigating to: https://mam.mediacloud.fox/tools/rtlm/listings
[NAV] goto resolved. URL: https://mam.mediacloud.fox/tools/rtlm/listings
[NAV] URL after settle: https://mam.mediacloud.fox/tools/rtlm/listings
[IFRAME] Waiting for mclive-iframe to attach...
[IFRAME] iframe attached.
[POPUP] Scanning for popups...
[POPUP] 1 Aspera, 0 dialogs.
[POPUP]   Removed Aspera (DIV)
[IFRAME] Accessing content frame...
[IFRAME] Content frame acquired.
[AUTH] Session saved to storageState.json
[IFRAME] Waiting for app to stabilize...
[IFRAME] App ready.
[SCRAPE] Starting...
  App ready: 1.2s
  Column setup: 2.1s
  Callsign filters: 4.3s
  More Filters: 0.8s
  Table settle: 1.5s
All filters applied in 9.9s
  Page 1: 25 events.
  Page 2: 25 events.
  ...
  Page 65: 10 events.
[SCRAPE] 1610 events saved to scraper-bot/rtlm_upload_2026-03-30.csv
[SYNC] Sending data to MuleSoft at <MULESOFT_URL>/sync...
[SYNC] MuleSoft accepted payload: OK
```

MuleSoft processing:

```
📊 INITIAL ROWS: 1635 | ✂️ AFTER FILTER: 1610
✅ SUCCESS (1/1610): NBA Basketball - Lakers vs Celtics
✅ SUCCESS (2/1610): College Football - Ohio State vs Michigan
...
✅ SUCCESS (1610/1610): Premier League Soccer - Arsenal vs Chelsea
🏁 Sync Finished! Total Items Processed: 1610
```

## Performance & Reliability

### Current Metrics

| Metric | Value |
|---|---|
| Scrape time (headless) | ~28s avg (down from ~44s before adaptive polling) |
| End-to-end pipeline | ~3 min (scrape + MuleSoft + 1610 Monday.com API calls) |
| Consistency | 10/10 identical outputs across consecutive runs |
| Monday.com sync | 0 failures with 5-retry / 2s backoff per item |

### Goals

| Goal | Target | Status |
|---|---|---|
| Scrape reliability | 100% success rate on stable network | ✅ Achieved |
| Data accuracy | Zero missed or duplicate events | ✅ Achieved |
| Desktop GUI | One-click sync for non-technical users | ✅ Shipped |
| macOS packaging | Standalone `.app` with bundled Chromium | ✅ Shipped |
| API efficiency | Minimize Monday.com API calls per sync | 🔜 Pending (delta sync) |
| Automated cadence | Hourly unattended runs | 🔜 Pending (scheduler) |

## Roadmap

### Incremental Update Logic (Next)

Current approach does a full scrape and creates all items on each run. The next iteration will:

- Query the Monday.com board state before syncing
- Compare against the fresh scrape to detect new, changed, and removed listings
- Push only deltas (create / update / archive) instead of recreating everything
- Use `change_column_value` for updates and `archive_item` for removals

This is the highest-priority improvement -- it will drop Monday.com API calls from ~1600 per run to a handful in steady state, keeping us well within rate limits and reducing sync time.

### Automated Scheduling

- Cron job (or cloud scheduler) running the pipeline hourly in headless mode
- Health-check endpoint for uptime monitoring
- Slack or email alerts on sync failure or data anomaly (e.g., row count drops >20% between runs)

## Troubleshooting

### `storageState.json not found`

Run `npm run auth` from the `scraper-bot/` directory to create the session file.

### `Executable doesn't exist` (Playwright browser)

```bash
npx playwright install chromium
```

If running from a non-standard environment, set `PLAYWRIGHT_BROWSERS_PATH`:

```bash
PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright" node scraper.js
```

### `Execution context was destroyed`

The iframe's internal app navigated during scraping. The Playwright-level `frame.waitForSelector` stabilization prevents this. If it recurs, check that the iframe stabilization wait is present before `frame.evaluate()`.

### `Target page, context or browser has been closed`

Usually caused by aggressive popup dismissal removing critical DOM elements. The current popup dismissal strategy is scoped to Aspera elements and non-iframe dialogs to prevent this.

### Script requires login every time

Ensure `storageState.json` is being written after successful runs. The scraper saves refreshed cookies via `context.storageState({ path: storagePath })` before each scrape.

### `Table never rendered in iframe`

The RTLM app inside the iframe failed to load within 20 seconds. Check network connectivity and VPN status.

### macOS: app is blocked on first launch

macOS blocks unsigned apps by default. **Control-click** the app → **Open** → confirm. Alternatively: **System Settings → Privacy & Security → Open Anyway**.
