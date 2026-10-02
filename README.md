# Script Runner

**Build browser automations by describing the steps, not by writing code.**

Script Runner is a desktop app for repeatable browser work. You describe each step in plain terms, such as *go to this link*, *click the button that says "Download"*, or *type into the search box*, and it runs the steps in a real Chromium browser with Playwright. It handles the interruptions that usually break automation: pop-up tabs, ads, downloads that open new pages, sites that close the tab you were on, and elements that load late.

[![CI](https://github.com/Ahmed-Yusuf-1/script-runner/actions/workflows/ci.yml/badge.svg)](https://github.com/Ahmed-Yusuf-1/script-runner/actions/workflows/ci.yml)

> **Status: beta (v0.2.0).** The engine and storage are covered by unit and smoke tests. See the [changelog](CHANGELOG.md) for what's new.

## Download

**[Releases](https://github.com/Ahmed-Yusuf-1/script-runner/releases)**

- The installer is about 290 MB because it bundles its own Chromium, so you don't need to install a browser or Node.js.
- The builds aren't code-signed yet. On Windows, SmartScreen may show a warning: choose **More info → Run anyway**.
- Linux (AppImage, deb) and macOS (dmg) targets are configured. You can build them yourself (see [Build the installer](#build-the-installer)).

## What it does

### Build a flow without code
A **flow** is an ordered list of steps. Pick each step's action from a searchable, grouped picker:

| Navigate | Interact | Wait & check | Tabs & pop-ups | Files |
|---|---|---|---|---|
| Go to link | Type into a field | Wait for element | Close ad | Screenshot |
| Go back | Click | Check page text | Close this tab | Download |
| Reload page | Hover | Save text as variable | Close other tabs | Download & wait |
| Search Google | Choose from dropdown | Wait | | Save a row to a file |
| | Press a key | Pause for me | | Choose a file |
| | Scroll | | | |

Steps can be dragged to reorder, duplicated, disabled without deleting, and given a note. Undo and redo cover every edit.

### Find elements the way a person would
You don't need CSS selectors. You can target an element by:
- **Its visible text.** Matching ignores case, so "Download MP3" also finds "Download Mp3". Choose whole-text or partial matching.
- **A field's placeholder or label**, such as "Email address", or a dropdown's label.
- **The page's main search box**, which is detected automatically on most sites.
- **A CSS selector**, if you want exact control.

When several elements match, pick the **Nth one**, or turn on **Next match each run** to click the 1st match on the first run, the 2nd on the next, and so on.

### Keep going when a page gets in the way
Real sites are messy, so the engine handles the usual obstacles by itself:
- **Elements inside iframes** are found like any other, so embedded players, forms and download widgets just work.
- **Cookie and consent banners** are dismissed after each navigation, preferring "Reject all" where it's offered.
- **The browser's own alert and confirm boxes** are answered, so a flow can't sit waiting on one.
- **A click swallowed by an overlay** is retried: scroll it into view, clear what's covering it, then force the click.
- **When something isn't found**, the error tells you which page you were on and lists the closest buttons that *are* there.

### Do part of it yourself
Some things shouldn't be automated: signing in, picking a payment method, or a site's "are you human?" check. Add a **Pause for me** step and the run stops there with a note of what you need to do, your computer notifies you, and the flow carries on when you press **Resume**. Logins and checks are remembered between runs, so most sites only ask once.

> Script Runner does not solve CAPTCHAs for you. Clicking a verification widget automatically is bypassing bot detection, so it's deliberately not included.

### Collect what you find
**Save text as variable** reads an element's text, its link, its value or any attribute into a `{{variable}}`. **Save a row to a file** then appends those values to a CSV, one row per pass, with column names taken from the template. Point a repeat loop at a list and you have a spreadsheet at the end.

### Reuse flows with variables
- **Inputs:** put `{{placeholders}}` in any step, for example searching for `{{query}}`, and fill them in the Inputs panel. One flow then works with different inputs.
- **Save text as variable:** read text from the page (a title, a price, an order number) into `{{name}}` and use it in later steps.
- **Built-ins:** `{{date}}`, `{{time}}`, `{{datetime}}` and `{{timestamp}}`, which are handy in file names.

### Repeat part of a flow
Choose a range of steps and a number of repetitions. Steps before the range run once, the range repeats, then the remaining steps run once. Each pass has a counter (`{{n}}` by default) with a configurable start and step size. You can add a pause between passes and wait for downloads to finish before the next one starts.

### Built for messy, real websites
- **Ad and tracker blocking** uses Ghostery's full filter lists, cached to disk. If they can't load, it falls back to a built-in list of ad networks.
- **Pop-up handling** closes ad pop-up windows and tabs, but follows real new pages, such as a download link that continues on another site. A **whitelist** lets chosen sites always open new tabs.
- **Download capture** saves downloads from any tab into your folder. Files with the same name are kept side by side (`report (1).pdf`), and the browser only closes once every download has finished. You can also **skip files you already have**, so a repeat run picks up where it left off, and group each run's files in their own sub-folder.
- **Retries** give flaky steps up to 10 more tries. **Wait for element** handles pages that load late.
- **Tab recovery:** if a site closes the tab mid-run, the flow continues on a live tab instead of failing.
- **Persistent sessions** remember cookies and logins between runs, so you only sign in once.

### Stay in control
- **Validation before running:** empty links, missing targets and empty inputs are flagged on the step itself.
- **Live progress:** each step's status, plus the current pass, step, files saved and elapsed time.
- **Pause, Resume and Stop.** Stop takes effect immediately, even in the middle of a long wait.
- **Run from here** or **Run only this step** while you build a flow.
- **Per-step error handling:** stop the run, or continue past a failing step. Each step can also set its own time limit and a pause after it finishes.
- **Screenshot on failure**, so a headless run that failed shows you what the page looked like.
- **Console:** a timestamped, colour-coded log you can filter, copy or save, plus the list of files the run saved.
- **Run history:** the last 200 runs, with their results, per-step outcomes, saved files and full logs, and a Run again button.
- **Unattended runs:** a time limit that stops a runaway flow, the computer kept awake while it works, and a notification when it finishes.
- **Nothing is lost:** unsaved edits are kept as a draft and offered back if the app or the computer stops unexpectedly.

### Presets
Group flows and settings into **preset profiles**, one per task or site. Switch, create, rename, **export** a preset to a JSON file or **import** one, so you can share or back up automations. Individual flows can be exported and imported too.

## Settings

Settings live with the active preset, so each preset can work differently.

| Section | What's there |
|---|---|
| General | Theme, download folder, step time limit, screenshot when a step fails |
| Browser | Show the browser or run hidden, slow motion, answer the page's pop-up boxes, don't load images or video, remember logins, clear saved logins |
| Pop-ups & ads | Dismiss cookie banners, block ads and trackers, close pop-up windows and tabs, the always-allow list |
| Downloads | Skip files you already have, a folder per flow or per run, when to give up on stuck downloads |
| Advanced | Stop a run after a time limit, keep the computer awake, notify when a run finishes, browser window size, user agent, proxy |
| Data & about | Where your data lives, version, check for updates |

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Save the flow | `Ctrl S` |
| Run | `Ctrl Enter` |
| Run from the selected step | `Ctrl Shift Enter` |
| Stop | `Ctrl .` |
| New flow | `Ctrl N` |
| Undo / Redo | `Ctrl Z` / `Ctrl Shift Z` |
| Duplicate the selected step | `Ctrl D` |
| Copy / paste a step | `Ctrl C` / `Ctrl V` |
| Move the selected step | `Alt ↑` / `Alt ↓` |
| Search flows | `Ctrl F` |
| Settings | `Ctrl ,` |
| All shortcuts | `?` |

On macOS, use `⌘` instead of `Ctrl`.

## Example flow

A flow that downloads a numbered series of files from a listing page:

```
1. Go to link          https://example.com/episodes/{{show}}
2. Wait for element    text "Episode list" appears
3. Download & wait     "Download MP3", item #{{n}}, up to 30 s, retry 2×
4. Close other tabs    (clears any pop-unders)
5. Screenshot          finished-{{date}}.png

Repeat steps 3–4 × 10 times, counter n starting at 1.
```

## How it's built

```
┌─────────────────── Electron app ───────────────────┐
│                                                    │
│  Renderer (React UI)                               │
│  sidebar · step editor · console · history         │
│          │  named IPC channels only                │
│          ▼                                         │
│  Preload bridge  (contextIsolation on)             │
│          │                                         │
│          ▼                                         │
│  Main process  ──►  Storage: flows, presets,       │
│   validates every     settings, run history        │
│   IPC payload         (atomic JSON in userData)    │
│          ▼                                         │
│  Engine  (no Electron imports)                     │
│  runner → actions → target resolution              │
│  browser · pages · adblock  ──►  Playwright        │
│                                                    │
└────────────────────────────────────────────────────┘
```

- **One shared data model.** [`src/shared/`](src/shared) defines flows, steps, settings and action metadata, plus validation and normalization. The UI and the engine both import it, so they can't drift apart.
- **Old files keep loading.** Everything read from disk or imported goes through [`normalize.ts`](src/shared/normalize.ts), which fills in defaults, migrates older fields and drops anything malformed.
- **The engine has no Electron dependency.** Everything in `src/main/engine/` is plain Node and Playwright, so each behavior is tested headlessly without starting the app.
- **The UI can't reach Node directly.** The renderer runs with `contextIsolation` on and `nodeIntegration` off, behind a strict Content Security Policy. Its only way to reach storage and the engine is a small set of named IPC channels, and the main process validates every payload. It will only open files the app saved itself.
- **Safe storage.** Writes are atomic (a temporary file, then a rename) and serialized per file, so a crash or two quick saves can't corrupt or lose data. Unreadable files are moved aside, not deleted.
- **Cancellation** uses an `AbortController` that reaches every wait. Pause is honored between steps.

### Project structure

```
src/
├── main/                    Electron main process
│   ├── index.ts             window, menu, single instance, app lifecycle
│   ├── ipc.ts               IPC handlers, payload validation, current run
│   ├── storage/             flows, presets, settings, history, atomic file helpers
│   └── engine/              Playwright automation engine (no Electron imports)
│       ├── runner.ts        runs a flow: repeat, retries, pause/stop, run record
│       ├── actions.ts       the 23 step actions
│       ├── target.ts        text / label / search box / selector → locator
│       ├── pages.ts         new tabs, pop-ups, download capture
│       ├── adblock.ts       Ghostery filter lists + fallback host list
│       ├── browser.ts       browser/context lifecycle, persistent profile
│       └── smoke-*.ts       headless smoke tests
├── preload/index.ts         the IPC bridge exposed to the UI
├── renderer/src/            React UI: components, hooks, styles
└── shared/                  types, action metadata, variables, repeat, validation
tests/                       unit tests (node:test)
```

## Development

**Requirements:** Node.js 20 or newer, and npm.

```bash
npm install          # also downloads Playwright's Chromium
npm run dev          # start the app with hot reload
npm run check        # typecheck + unit tests + production build
```

> **npm 11 blocks install scripts by default.** If `npm install` warns about skipped install scripts, Electron's binary and Playwright's Chromium won't be downloaded. Run `npm install-scripts approve electron`, or run `node node_modules/electron/install.js` and `npx playwright install chromium` yourself.

### Tests

```bash
npm test                 # unit tests: shared logic, storage helpers, editor helpers (no browser)
npm run smoke:offline    # engine smoke tests against local pages (headless Chromium; what CI runs)
```

Each smoke test prints `PASS` or `FAIL`. `smoke`, `smoke:adblock` and `smoke:profile` reach real websites, so they're run by hand:

```bash
npm run smoke:realworld  # iframes, consent banners, overlays, dialogs, lazy lists, uploads, CSV
npm run smoke:actions2   # hover, dropdowns, scroll, reload, wait, check text, save text
npm run smoke:control    # stop, pause/resume, retries, disabled steps, run from/only, error screenshots
npm run smoke:dlname     # same-named downloads are both kept; safe screenshot names
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
npm run smoke:adblock    # filter-list blocking (network)
npm run smoke:profile    # persistent session (network)
```

Set `SCRIPT_RUNNER_USER_DATA=/some/folder` to run the app with a separate data folder, for example to try things without touching your real flows.

### Build the installer

```bash
npm run dist:win     # Windows NSIS installer
npm run dist:linux   # AppImage and .deb
npm run dist:mac     # .dmg (build on a Mac)
```

Each command builds the app, bundles Chromium into `playwright-browsers/`, and writes the installer to `dist/`.

### Where your data lives

Flows, presets, settings, run history, the persistent browser profile and the ad-block cache are stored in Electron's per-user app data folder, not in this repository: `%APPDATA%\script-runner` on Windows, `~/.config/script-runner` on Linux, and `~/Library/Application Support/script-runner` on macOS. **Help → Open data folder** opens it.

## Responsible use

Script Runner drives a real browser on your behalf. Only automate sites and accounts you're allowed to, and respect each site's terms of service and rate limits.

## License

[MIT](LICENSE) © 2026 Ahmed Yusuf
