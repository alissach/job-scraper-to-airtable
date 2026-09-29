# CLAUDE.md

## Project Overview
Chrome Extension that scrapes job postings from various job boards and saves them to Airtable.

## Tech Stack
- **Chrome Extension:** Vanilla JavaScript, Manifest v3

## Key Files
- `chrome-extension/popup.js` — Main popup UI & scraping orchestration. Also handles opening `popup.html?standalone=1&tabId=<id>` as its own `chrome.windows.create` popup-type window (via the header's "open in window" button) so the UI can stay open past the toolbar popup's auto-close-on-blur behavior; `?standalone=1` removes the ~600px action-popup height cap via a `body.standalone` CSS class. The `tabId` param is required — in a standalone window, `chrome.tabs.query({currentWindow:true})` would resolve to the extension's own popup.html tab (not the job posting tab), which the extension has no host permission to script, throwing "Cannot access contents of the page." The job-posting tab's id is captured up front (while `activeTab`'s grant is still live from the original toolbar-popup invocation) and threaded through the URL so the standalone window scripts the right tab. Any in-progress edits in the popup are also carried over: clicking "open in window" stashes the current form state (`getFormData()`) in `chrome.storage.session` under `popupDraft`; the standalone window's `init()` picks it up (and clears it) instead of re-scraping, via `applyFormData()`.
- `chrome-extension/content.js` — DOM scraping (injected into active tab)
- `chrome-extension/background.js` — Service worker, handles Airtable API calls
- `chrome-extension/options.js` — Settings page for Airtable credentials
- `chrome-extension/richtext-utils.js` — Dead code (not loaded anywhere; old rich text array approach)

## Architecture
1. User clicks extension → `popup.js` runs `chrome.scripting.executeScript` with inline scraping functions
2. Inline functions in `popup.js` extract job data (JSON-LD first, then DOM selectors as fallback)
3. User reviews data in popup form
4. On save → `background.js` calls Airtable API (keeps token out of content script)

> Note: `content.js` exists but the active scraping logic is inline in `popup.js`. When fixing scraping bugs, look in `popup.js` first.

## Scraping Conventions
- **JSON-LD is primary** — schema.org JobPosting structured data is most reliable
- **Domain-based company detection** — Extract company from URL patterns (greenhouse.io, lever.co, ashbyhq.com), not hardcoded name checks
- **LinkedIn is a special case** — LinkedIn job pages don't reliably expose JSON-LD, so title/company/location/description each have dedicated `linkedin.com` branches (checked first). LinkedIn has two DOM generations: legacy classed DOM (`.job-details-jobs-unified-top-card__job-title`, `.topcard__org-name-link`) and a newer "SDUI" redesign with hashed, per-deploy CSS classes that must NOT be selected on directly — use its stable semantic hooks instead (`[id^="JobDetails_AboutTheJob_"]`, `[data-sdui-component*="aboutTheJob"]` for description; `document.title` "{Company} hiring {Job Title}..." pattern for company)
- **Boilerplate removal** — Strip "How to Apply", "About Company", EEO sections from descriptions
- **Job descriptions saved as Markdown** for Airtable rich text fields

## Airtable Integration
- Credentials stored in `chrome.storage.sync` (token, baseId, appsTableName)
- PAT requires only `data.records:write` scope
- One save destination: `saveToApps` → Applications table: Job Title, Company, Location (normalized via `mapLocation()`), RTO, Salary Range, Job Description, URL, Status, Date Applied
- Status field is a Single Select, editable in the popup (options: Interested, Applied); defaults to `"Interested"` on each scrape
- Date Applied is optional; it auto-fills with today's local date when Status is changed to Applied (only on a real `change` event, so restoring a standalone-window draft with a cleared date doesn't re-add it). `background.js` omits the field entirely when blank since Airtable date fields reject `""`
- RTO is an optional Single Select (On-site, Hybrid, Remote) shown to the left of Salary Range; blank by default and omitted from the record when blank. **The Hybrid choice is literally named `"Hybrid "` with a trailing space in Airtable** — the `<option value>` must keep it or Airtable rejects the write
- `mapLocation()` in background.js normalizes raw location text to readable labels: Remote, Seattle, NYC, Remote-first, Bellevue, or raw text as fallback
- No hardcoded credentials

## Rules
- Scraping logic lives inline in `popup.js`; API calls in `background.js`
- Prefer path-based extraction over subdomain for job board company names
- Greenhouse company is in the first path segment (not the subdomain)
- Always update CLAUDE.md when project structure or conventions change

## Accessibility
- **Accessibility is a priority** — all UI changes must meet WCAG AA minimum
- Link text color must have ≥4.5:1 contrast ratio against its background (dark surfaces need lighter blues — use `--link: #60a5fa`, not `--accent: #2563eb`)
- `--accent` (#2563eb) is for button backgrounds (white text on blue passes), not for text on dark backgrounds
- Always check contrast when adding new colors or UI elements
