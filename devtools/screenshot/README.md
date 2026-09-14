# DEVLOG screenshot tool

Dev-only utility for screenshotting the extension popup (toolbar and standalone
window views) with sample data, for embedding in DEVLOG.md entries. Not part
of the shipped extension — the extension itself still has no build step.

## Setup (one-time)

```bash
cd devtools/screenshot
npm install
npx playwright install chromium
```

## Usage

```bash
node capture.js --out=../../screenshots/<descriptive-name>.png [options]
```

Always pass `--out` with a unique, descriptive filename — never reuse a name
already referenced from an existing DEVLOG.md entry, since that would silently
change what that entry's screenshot shows.

Options:
- `--view=popup|standalone` — which surface to capture (default `popup`)
- `--status=Interested|Applied` — default `Interested`
- `--dateApplied=YYYY-MM-DD` — only applies when `--status=Applied`
- `--jobTitle`, `--company`, `--location`, `--salary`, `--description`, `--url` — override the sample job data
- `--width`, `--height` — viewport size (defaults: popup 400x640, standalone 420x720)

Examples:

```bash
node capture.js --view=popup --status=Interested --out=../../screenshots/popup-default.png
node capture.js --view=popup --status=Applied --dateApplied=2026-09-10 --out=../../screenshots/popup-applied.png
node capture.js --view=standalone --status=Applied --dateApplied=2026-09-10 --out=../../screenshots/standalone-window.png
```
