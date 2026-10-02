# Changelog

All notable changes to Script Runner. The format follows [Keep a Changelog](https://keepachangelog.com/).

## [0.2.0] - 2026-10-02

A redesign and a large reliability upgrade. Flows, presets and settings saved by 0.1 load unchanged.

### Added
- **Ten new actions:** Hover, Choose from dropdown, Scroll, Reload page, Wait for element (appear or go away), Check page text, Save text as variable (read an element's text, link, value or attribute into a `{{variable}}`), **Save a row to a file** (append values to a CSV, so a repeat loop can collect results), **Choose a file** (attach a file to an upload field), and **Pause for me** (stop so you can sign in, pick something or pass a site's check yourself, then press Resume).
- **Run control:** Pause and Resume between steps, Run from a chosen step, and Run only one step.
- **Retries:** any step can retry up to 10 times, with a short back-off, before it counts as failed.
- **Disable a step** without deleting it.
- **Step notes**, and a per-step **time limit** (the setting existed in 0.1 but had no control).
- **Screenshot on failure**, saved to `Script Runner errors` in the download folder.
- **Built-in variables:** `{{date}}`, `{{time}}`, `{{datetime}}`, `{{timestamp}}`.
- **Handling of real pages:** elements are found inside iframes; cookie and consent banners are dismissed automatically (choosing "Reject all" where offered); the browser's own alert and confirm boxes are answered so a flow can't hang; and a click that gets swallowed by an overlay is retried by scrolling into view, clearing the overlay, then forcing it.
- **Helpful failures:** when a target isn't found, the error lists the closest buttons the page actually has, and says which page it was on.
- **Download sense:** optionally skip files already in the folder (so a repeat run resumes instead of making `file (1)`), group downloads per flow or per run, and stop waiting on a stalled download.
- **Click once, twice or right**; type key by key for sites that watch for real typing; choose how long "Go to link" waits; scroll until a lazy list stops growing; and retry a page load that fails on a flaky network.
- **Comfort and safety:** keep the computer awake during a run, a desktop notification when a run finishes in the background, an optional run time limit, and blocking images and video for faster runs.
- **Advanced browser settings:** window size, user agent and proxy.
- **Crash safety:** unsaved edits are kept as a draft and offered back the next time the app starts.
- **Copy and paste steps** (`Ctrl C` / `Ctrl V`), within a flow or between flows.
- **Check for updates** in Settings, which looks at the project's GitHub releases.
- **Run history:** the last 200 runs, each with its result, duration, per-step outcome, saved files and full log. Includes Run again.
- **Validation before running:** empty links, missing targets and empty inputs are flagged on the step, and a flow with errors won't start.
- **Undo and redo** for all editing, **drag-and-drop** step reordering, **duplicate** and **insert below**.
- **Unsaved-changes tracking:** a marker in the sidebar and top bar, and a prompt before switching flows, switching presets, or closing the window.
- **Flows:** search, duplicate, and export or import individual flows (a preset file can also be imported as flows).
- **Presets:** rename, and create one from the current flows and settings.
- **Settings:** folder picker, slow motion, theme (system, dark, light), and Clear saved logins.
- **Keyboard shortcuts:** save, run, run from the selected step, stop, new flow, undo, redo, duplicate, move step, settings, search. Press `?` to see them all.
- **Console:** timestamps, colour-coded levels, filters, copy, save to file, a list of saved files, and resizable and collapsible.
- Linux (AppImage, deb) and macOS (dmg) build targets, and an app icon.
- 41 unit tests, and smoke tests for the new actions, run control, download naming and real-world page handling (iframes, consent banners, overlays, dialogs, lazy lists, uploads, CSV output). CI runs the unit tests, a production build and every offline smoke test.

### Changed
- **New interface:** redesigned step cards, a searchable and grouped action picker, a live progress bar with pass, step, file and time counters, toasts in place of blocking pop-ups, dark and light themes, and bundled IBM Plex fonts.
- CSS-selector targets are now available in the editor for click, hover, download, wait for element and save text. They were supported by the engine but not exposed in 0.1.
- Download & wait now defaults to waiting 30 seconds for the file to start, up from 1 second.
- Storage writes are atomic and serialized, so a crash or two quick saves can't corrupt or lose a preset. Unreadable files are moved aside instead of breaking the app.
- Every flow and settings file is validated and normalized when loaded or imported.
- The app allows only one instance at a time, remembers its window size and position, and stops a run cleanly on quit.

### Not included
- **Solving CAPTCHAs.** Clicking a "verify you're human" widget for you is bypassing bot detection, so Script Runner doesn't do it. The "Pause for me" step is the supported path: the run waits, you click it yourself, and the saved browser profile means most sites only ask once.

### Fixed
- **Save As (new preset) did nothing:** Electron doesn't support `window.prompt()`. It now uses an in-app dialog.
- **Stop didn't interrupt waits:** a long Wait step, the pause between repeats, or waiting for downloads now ends immediately on Stop.
- **Downloads with the same name overwrote each other.** The second file is now saved as `name (1).ext`.
- **Screenshot names could write outside the download folder** (for example `../../x.png`). Names are now sanitized.
- **Failed or cancelled downloads were silently ignored.** They are now reported in the log.
- **A per-step time limit didn't apply** to element waits or to Download.
- **A retried auto-increment step skipped ahead** to the next match instead of retrying the same one.
- The app window could navigate away or open new windows, and it flashed a mismatched background colour on start.

## [0.1.0-alpha]

First release: a flow builder with 13 actions, repeat ranges with a counter, variables, ad and pop-up blocking, download capture, persistent sessions and presets.
