# CLAUDE.md

## Project Overview
Chrome Extension that scrapes job postings from various job boards and saves them to Airtable.

## Tech Stack
- **Chrome Extension:** Vanilla JavaScript, Manifest v3

## Key Files
- `chrome-extension/popup.js` — Main popup UI & scraping orchestration
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
- **Boilerplate removal** — Strip "How to Apply", "About Company", EEO sections from descriptions
- **Job descriptions saved as Markdown** for Airtable rich text fields

## Airtable Integration
- Credentials stored in `chrome.storage.sync` (token, baseId, tableName, appsTableName)
- PAT requires only `data.records:write` scope
- Two save destinations, each with its own background function and message action:
  - `saveToAirtable` → Job Scraper table: Job Title, Company, Location, Salary Range, Job Description, URL
  - `saveToApps` → Applications table: Role or Job ID, Employer, Location (single select via `mapLocation()`), Salary Range, Job Description, URL
- `mapLocation()` in background.js normalizes raw location text to: Remote, Seattle, NYC, Remote-first, Bellevue, Other/Unknown
- No hardcoded credentials

## Rules
- Scraping logic lives inline in `popup.js`; API calls in `background.js`
- Prefer path-based extraction over subdomain for job board company names
- Greenhouse company is in the first path segment (not the subdomain)
- Always update CLAUDE.md when project structure or conventions change
