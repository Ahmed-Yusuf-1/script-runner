# Script Runner

**Build browser automations by describing the steps, not by writing code.**

Script Runner is a desktop app for repeatable browser work. You describe each step in plain terms, such as *go to this link*, *click the button that says "Download"*, or *type into the search box*, and it runs the steps in a real Chromium browser with Playwright. It handles the interruptions that usually break automation: pop-up tabs, ads, downloads that open new pages, and sites that close the tab you were on.

[![CI](https://github.com/Ahmed-Yusuf-1/script-runner/actions/workflows/ci.yml/badge.svg)](https://github.com/Ahmed-Yusuf-1/script-runner/actions/workflows/ci.yml)

> **Status: alpha (v0.1.0).** It works and is covered by engine smoke tests, but expect rough edges. Windows is the only packaged build so far.

## Download

**[Download the Windows installer (v0.1.0-alpha)](https://github.com/Ahmed-Yusuf-1/script-runner/releases/tag/v0.1.0-alpha)**

- The installer is about 290 MB because it bundles its own Chromium, so you don't need to install a browser or Node.js.
- The installer is not code-signed yet, so Windows SmartScreen may show a warning. Choose **More info → Run anyway**.
- On macOS or Linux, run it from source (see [Development](#development)).

## What it does

### Build a flow without code
A **flow** is an ordered list of steps. Each step is one of 13 actions, chosen from a dropdown:

| Navigate | Interact | Tabs and pop-ups | Files and timing |
|---|---|---|---|
| Go to a link | Click an element | Close an ad (best effort) | Download (click and save) |
| Go back | Type into a field | Close the current tab | Download and wait (custom time limit) |
| Search Google | Press a key | Close all other tabs | Wait |
| | | | Screenshot |

### Find elements the way a person would
You don't need CSS selectors. You can target an element by:
- **Its visible text.** Matching ignores case, so "Download MP3" also finds "Download Mp3". Choose whole-text or partial matching.
- **A field's placeholder or label**, such as "Email address".
- **The page's main search box**, which is detected automatically on most sites.
- **A CSS selector**, if you want exact control.

When several elements match, pick the **Nth one**. You can also turn on **auto-increment**, which clicks the 1st match on the first run, the 2nd on the next, and so on.

### Reuse flows with variables
Put `{{placeholders}}` in any step, for example searching for `{{query}}`. Before each run, the Run panel asks for their values, so one flow works with different inputs.

### Repeat part of a flow
Choose a range of steps and a number of repetitions. Steps before the range run once, the range repeats, then the remaining steps run once. Each pass has a counter (`{{n}}` by default) with a configurable start and step size. You can add a pause between passes, and Script Runner can wait for downloads to finish before starting the next one.

### Built for messy, real websites
- **Ad and tracker blocking** uses Ghostery's full filter lists, cached to disk. If they can't load, it falls back to a built-in list of ad networks.
- **Pop-up handling** closes ad pop-up windows and tabs, but follows real new pages, such as a download link that continues on another site. A **whitelist** lets chosen sites always open new tabs.
- **Download capture** saves downloads from any tab into your chosen folder. The browser only closes once every download has finished.
- **Tab recovery**: if a site closes the tab mid-run, the flow continues on a live tab instead of failing.
- **Persistent sessions** remember cookies and logins between runs, so you only sign in once.

### Stay in control
- A **live status indicator** (running, OK, warning, error, skipped) on every step, plus a streaming run log.
- **A Stop button** that cancels a run cleanly.
- **Per-step error handling**: stop the run, or continue past a failing step. Steps can also override the timeout and pause after finishing.
- **Visible or headless** runs. Watch the browser work, or run it in the background.

### Presets
Group flows and settings into **preset profiles**, one per task or site. Switch between them, and **export** a preset to a JSON file or **import** one from a file, so you can share or back up automations.

## Example flow

A flow that downloads a numbered series of files from a listing page:

```
1. Go to             https://example.com/episodes
2. Click             element that says "Download"   (item #{{n}})
3. Download & wait   click "Save file", allow up to 30 s for it to start
4. Close other tabs  (clears any pop-unders)

Repeat steps 2–4 × 10 times, counter n starting at 1.
```

## How it's built

```
┌─────────────────── Electron app ──────────────────┐
│                                                   │
│  Renderer (React UI)                              │
│  flow list · step builder · repeat · run log      │
│          │  named IPC channels only               │
│          ▼                                        │
│  Preload bridge  (contextIsolation on)            │
│          │                                        │
│          ▼                                        │
│  Main process  ──►  Storage: flows, presets,      │
│          │           settings (JSON in userData)  │
│          ▼                                        │
│  Engine  (no Electron imports)                    │
│  runner → actions → target resolution             │
│  browser · pages · adblock  ──►  Playwright       │
│                                                   │
└───────────────────────────────────────────────────┘
```

- **One shared data model.** [`src/shared/types.ts`](src/shared/types.ts) defines flows, steps, settings and presets. The UI and the engine both import it, so they can't drift apart.
- **The engine has no Electron dependency.** Everything in `src/main/engine/` is plain Node and Playwright, so each behavior can be tested headlessly without starting the desktop app.
- **The UI can't reach Node directly.** The renderer runs with `contextIsolation` on and `nodeIntegration` off. Its only way to reach storage and the engine is a small set of named IPC channels.
- **Cancellation uses an `AbortController`.** Stop aborts the current run, closes the browser, and marks the in-flight step as skipped.

### Project structure

```
src/
├── main/                 Electron main process
│   ├── index.ts          window + app lifecycle
│   ├── ipc.ts            IPC handlers (flows, settings, presets, run/stop)
│   ├── storage/flows.ts  JSON persistence, preset import/export
│   └── engine/           Playwright automation engine (no Electron imports)
│       ├── runner.ts     executes a flow, repeat ranges, stop, error policy
│       ├── actions.ts    the 13 step actions
│       ├── target.ts     text / label / search-box / selector → locator
│       ├── pages.ts      new tabs, pop-ups, download capture
│       ├── adblock.ts    Ghostery filter lists + fallback host list
│       ├── browser.ts    browser/context lifecycle, persistent profile
│       └── smoke-*.ts    headless smoke tests
├── preload/index.ts      the IPC bridge exposed to the UI
├── renderer/src/         React UI (App + components)
└── shared/               types, variable substitution, repeat logic
```

## Development

**Requirements:** Node.js 18 or newer, and npm.

```bash
npm install          # also downloads Playwright's Chromium
npm run dev          # start the app with hot reload
npm run typecheck    # TypeScript, strict mode
```

### Smoke tests

Each engine behavior has a headless smoke test that prints `PASS` or `FAIL`. Most run against local pages; `smoke`, `smoke:adblock` and `smoke:profile` need an internet connection.

```bash
npm run smoke:offline    # every test that runs against local pages (what CI runs)
npm run smoke            # type into a real site's search box
npm run smoke:repeat     # repeat ranges and the counter
npm run smoke:download   # download capture
npm run smoke:newtab     # follow real new tabs, close pop-ups
npm run smoke:whitelist  # pop-up whitelist
npm run smoke:tabfollow  # switch to the tab a click opened
npm run smoke:closetab   # close tab and return
npm run smoke:match      # case-insensitive exact / contains matching
npm run smoke:nth        # pick the Nth match
npm run smoke:autoinc    # auto-increment item number
npm run smoke:back       # go back
npm run smoke:waitafter  # pause after a step
npm run smoke:dlstart    # detect a download starting
npm run smoke:adblock    # filter-list blocking
npm run smoke:profile    # persistent session
```

### Build the installer

```bash
npm run dist
```

This builds the app, bundles Chromium into `playwright-browsers/`, and produces a Windows NSIS installer in `dist/`.

### Where your data lives

Flows, presets, settings, the persistent browser profile and the ad-block cache are stored in Electron's per-user app data folder (under `%APPDATA%` on Windows), not in this repository.

## Responsible use

Script Runner drives a real browser on your behalf. Only automate sites and accounts you're allowed to, and respect each site's terms of service and rate limits.

## License

[MIT](LICENSE) © 2026 Ahmed Yusuf
