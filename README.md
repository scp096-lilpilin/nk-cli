# nk-cli

A professional Node.js + **Puppeteer** scraper that targets the
`/hentai` category of `https://nekopoi.care/`. The site sits behind a
WAF, so plain HTTP requests cannot return the real DOM — this CLI drives
a real Chromium instance with stealth hardening to render pages exactly
as a normal browser would.

## Highlights

- **`rebrowser-puppeteer` + stealth** browser context. The `puppeteer`
  dependency is aliased to
  [`rebrowser-puppeteer`](https://www.npmjs.com/package/rebrowser-puppeteer)
  in `package.json`, which patches the
  [`Runtime.Enable` CDP leak](https://rebrowser.net/blog/how-to-fix-runtime-enable-cdp-detection-of-puppeteer-playwright-and-other-automation-libraries)
  exploited by SafeLine WAF, Cloudflare, DataDome and similar
  anti-bot stacks. `puppeteer-extra-plugin-stealth` is layered on top
  for the standard `webdriver`/`navigator` fingerprint scrubs, with a
  graceful fallback to bare `puppeteer` if the plugin is unavailable.
- ES Module project (`"type": "module"`), 2-space indentation, JSDoc on
  every exported function.
- **Bandwidth-efficient navigation**: Puppeteer request interception
  aborts `image | media | font` requests by default
  (`NK_BLOCK_RESOURCES`), so each page loads only the HTML/CSS/JS the
  parsers actually need.
- **WAF-aware waits**: the homepage `goto` uses `networkidle2` and a
  separate `NK_WAF_TIMEOUT_MS` (default 120s) gates the
  `Hentai`-link / listing / detail DOM checks. The wait resolves the
  moment the challenge clears, so steady-state navigation is unaffected.
- **Coloured local-time logs** via [`chalk`](https://www.npmjs.com/package/chalk).
  Terminal output uses local-clock timestamps
  (`YYYY-MM-DD HH:mm:ss.SSS`) and per-level colours; file logs stay
  plain text.
- Resume-friendly: every page checkpoint is written atomically; SIGINT,
  SIGTERM, uncaught exceptions and unhandled rejections all flush
  in-flight progress before exit.
- Deduplicated listing collection (by `slug`).
- Retry/backoff around every navigation and DOM extraction.
- Pretty-formatted JSON output.

## Project Layout

```
.
├─ main.js
├─ package.json
├─ src/
│  ├─ browser/
│  │  └─ launcher.js          # Puppeteer launch + stealth + page setup
│  ├─ config/
│  │  └─ index.js             # Env-driven configuration
│  ├─ parsers/
│  │  ├─ pageItems.js         # /category/hentai listing parser
│  │  ├─ contentBody.js       # .konten metadata parser
│  │  ├─ nkPlayer.js          # #nk-player streaming parser
│  │  └─ downloadSection.js   # .nk-download-section parser
│  ├─ services/
│  │  ├─ listingScraper.js    # End-to-end listing pipeline
│  │  └─ detailScraper.js     # End-to-end detail pipeline
│  └─ utils/
│     ├─ logger.js            # Stdout + daily file logger
│     ├─ storage.js           # Atomic JSON read/write
│     ├─ retry.js             # Exponential backoff helper
│     └─ shutdown.js          # Graceful shutdown registry
├─ output/                    # JSON outputs are written here
└─ logs/                      # Daily log files are written here
```

## Install

```bash
npm install
```

This downloads a matching Chromium build (Puppeteer's default
behaviour). If you are on a corporate network or air-gapped host you may
need to set `PUPPETEER_DOWNLOAD_BASE_URL` or pre-stage the Chromium
binary.

## Run

Full pipeline (listing + details):

```bash
npm run scrape
# or
node main.js
```

Phase-only runs:

```bash
node main.js --only=list      # only the /category/hentai pagination
node main.js --only=detail    # only the per-slug detail extraction
```

## Configuration

Every value can be overridden via environment variables. The CLI loads a
project-local `.env` file automatically at startup (powered by
[`dotenv`](https://www.npmjs.com/package/dotenv)). To customise a run,
copy the example file and edit it:

```bash
cp .env.example .env
```

Available variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `NK_BASE_URL` | `https://nekopoi.care` | Site root used to build detail URLs. |
| `NK_HOME_URL` | `https://nekopoi.care/` | Homepage used to find the Hentai menu. |
| `NK_USER_AGENT` | Realistic Chrome UA | Override the user-agent string. |
| `NK_HEADLESS` | `true` | Set `false` to watch the browser. |
| `NK_VIEWPORT_WIDTH` | `1366` | Default viewport width. |
| `NK_VIEWPORT_HEIGHT` | `768` | Default viewport height. |
| `NK_NAV_TIMEOUT_MS` | `60000` | Navigation/selector timeout. |
| `NK_WAF_TIMEOUT_MS` | `120000` | Generous wait for the SafeLine WAF challenge gate (homepage entry, Hentai-link wait, listing/detail DOM). Resolves immediately once the gate clears. |
| `NK_BLOCK_RESOURCES` | `image,media,font` | Comma-separated resource types aborted at the request layer (allowed: `document`, `stylesheet`, `image`, `media`, `font`, `script`, `texttrack`, `xhr`, `fetch`, `eventsource`, `websocket`, `manifest`, `other`). Set to `none` to disable. |
| `NK_MAX_LIST_PAGES` | `9999` | Hard cap on listing pages. |
| `NK_MAX_DETAIL_ITEMS` | `0` (no cap) | Hard cap on detail pages per run. |
| `NK_RETRY_ATTEMPTS` | `3` | Retries per page before skipping. |
| `NK_RETRY_BASE_DELAY_MS` | `2500` | Base backoff delay (doubled each retry). |
| `NK_POLITE_DELAY_MS` | `800` | Pause between successful requests. |
| `NK_LOG_LEVEL` | `info` | One of `debug`, `info`, `warn`, `error`. |
| `NK_LOG_COLOR` | _(auto)_ | Force ANSI colour on/off in terminal output. Defaults to on when stdout is a TTY. File logs are always plain text. |
| `NK_OUTPUT_DIR` | `output` | Where `hanimeLists.json` / `hanimeDetails.json` are written. |
| `NK_LOGS_DIR` | `logs` | Where the daily logger writes log files. |
| `NK_USER_DATA_DIR` | `.browser_data` | Persistent Puppeteer profile directory. |
| `NK_CHROME_EXECUTABLE_PATH` | _(unset)_ | Path to a real Chrome/Chromium binary. Bundled Chromium has fingerprint quirks; a real Chrome is harder for WAFs to flag. |
| `NK_CHROME_CHANNEL` | _(unset)_ | Puppeteer browser channel hint (e.g. `chrome`). |
| `REBROWSER_PATCHES_RUNTIME_FIX_MODE` | `addBinding` | rebrowser-patches `Runtime.Enable` fix mode. Other values: `alwaysIsolated`, `0` (disabled). |
| `REBROWSER_PATCHES_SOURCE_URL` | `app.js` | Replace the telltale `pptr:` script URL on injected sources. |
| `REBROWSER_PATCHES_UTILITY_WORLD_NAME` | `1` | Generic name for the Puppeteer utility world. |

## Outputs

- `output/hanimeLists.json` — full listing (deduped by `slug`).
- `output/hanimeDetails.json` — final merged detail records.
- `output/hanimeDetails.progress.json` — per-slug checkpoint file used
  to resume an interrupted detail run.

## Tests

The repository ships with a `node:test`-based suite that covers the
four DOM parsers and runs the listing + detail scrapers end-to-end
against a local fixture HTTP server (no live network required):

```bash
npm test
```

The integration test uses `NK_OUTPUT_DIR` to redirect output into a
temp directory, so it does not touch the real `output/` JSON files.
It asserts that:

- `output/hanimeLists.json` contains **at least 10** listing entries.
- `output/hanimeDetails.json` contains **at least 10** detail records,
  each merging the parsed `content`, `player` and `downloads` blocks.

Fixtures live under `test/fixtures/`. To validate a parser change
against a real captured page, drop the page's HTML into a fixture and
add an assertion in `test/parsers.test.js`.

## Reliability Notes

- The listing scraper saves after **every** page so a crash or `Ctrl+C`
  loses at most the page currently in flight.
- The detail scraper checkpoints after **every** slug.
- A SIGINT/SIGTERM (or uncaught exception) flushes the in-memory state
  to disk synchronously before the process exits.
- Every navigation is wrapped in `withRetry(...)` with exponential
  backoff so transient WAF challenges don't abort the run.
