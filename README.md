# Job Scraper to Airtable

A Chrome extension that extracts job posting data from any job board and saves it to your Airtable base with a single click.

Note: this is still in development and may not work for all job postings. Feel free to create an issue and share the site URL for testing. 

## Features

- **One-click scraping** — Click the extension icon on any job posting to extract structured data
- **Smart extraction** — Uses JSON-LD structured data when available, with DOM-based fallbacks
- **Multi-platform support** — Optimized for Greenhouse, Lever, Ashby, and LinkedIn, with generic fallback heuristics for any job board
- **Intelligent field parsing** — Detects locations (including Remote/Hybrid/On-site), salary ranges (annual, hourly, K-notation), and company names from URLs and page metadata
- **Markdown formatting** — Converts HTML job descriptions to clean Markdown for Airtable rich text fields
- **Boilerplate removal** — Strips navigation, footers, cookie banners, EEO statements, and "How to Apply" sections
- **Editable before saving** — Review and adjust all extracted fields before sending to Airtable

## How It Works

1. Navigate to a job posting on any supported site
2. Click the extension icon in your toolbar
3. The extension scrapes the page — first checking for JSON-LD structured data (`schema.org/JobPosting`), then falling back to platform-specific DOM selectors and heuristic scoring
4. Review the extracted fields (Job Title, Company, Location, Salary Range, Description, URL)
5. Click **Save for later** to save to your Job Scraper table, or **Add to apps** to log it directly to your Applications table

## Installation

1. Clone this repository:
   ```bash
   git clone https://github.com/alissach/job-scraper-to-airtable.git
   ```
2. Open Chrome and go to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked**
5. Select the `chrome-extension/` folder from the cloned repo
6. The extension icon appears in your toolbar

## Airtable Setup

### 1. Create a Personal Access Token

1. Go to [airtable.com/create/tokens](https://airtable.com/create/tokens)
2. Click **Create new token**
3. Give it a name (e.g., "Job Scraper")
4. Under **Scopes**, add `data.records:write`
5. Under **Access**, add the base you want to use
6. Copy the token (starts with `pat`)

### 2. Get Your Base ID

1. Open your Airtable base in the browser
2. The Base ID is in the URL: `https://airtable.com/appXXXXXXXXXXXXXX/...`
3. Copy the part starting with `app`

### 3. Create Your Tables

The extension supports two save destinations, each configured separately in settings.

#### Job Scraper table — "Save for later"

A lightweight table for bookmarking postings to review later.

| Column Name     | Field Type       | Notes                           |
|-----------------|------------------|---------------------------------|
| Job Title       | Single line text |                                 |
| Company         | Single line text |                                 |
| Location        | Single line text | e.g., "Austin, TX (Remote)"    |
| Salary Range    | Single line text | e.g., "$120,000 - $160,000/yr" |
| Job Description | Long text        | Enable Markdown/rich text       |
| URL             | URL              | Link to the original posting    |

#### Applications table — "Add to apps"

A tracking table for jobs you're actively applying to. The Location field is automatically mapped from the raw scraped text to a predefined option.

| Column Name    | Field Type                | Notes                                                        |
|----------------|---------------------------|--------------------------------------------------------------|
| Role or Job ID | Single line text          |                                                              |
| Employer       | Single line text          |                                                              |
| Location       | Single select             | Options: Remote, Seattle, NYC, Remote-first, Bellevue, Other/Unknown |
| Salary Range   | Single line text          |                                                              |
| Job Description| Long text                 | Enable Markdown/rich text                                    |
| URL            | URL                       | Link to the original posting                                 |

> Column names are **case-sensitive** — they must match exactly as shown above.

## Configuration

1. Right-click the extension icon and select **Options** (or click the gear icon in the popup)
2. Enter your **Personal Access Token**, **Base ID**, **Job Scraper Table Name**, and optionally **Applications Table Name**
3. Click **Test Connection** to verify your credentials
4. Save your settings

## Data Extraction Details

Each field uses a layered extraction strategy:

**Job Title** — `og:title` meta tag → job-title CSS classes → first `<h1>` → document title

**Company** — ATS URL patterns (Greenhouse, Lever, Ashby) → `og:site_name` → "at Company" in page title → domain name

**Location** — Meta description patterns → labeled fields ("Location:", "Based in:") → US state abbreviation validation → workplace type detection (Remote/Hybrid/On-site) → emoji indicators

**Salary Range** — Dollar range patterns (`$120,000 - $160,000`) → K-notation (`$120K - $160K`) → hourly rates (`$45/hr`) → labeled salary sections

**Job Description** — Platform-specific selectors → heuristic element scoring (depth, structure, word count) → boilerplate section removal → HTML-to-Markdown conversion → whitespace normalization → truncation at 50,000 characters

## Tech Stack

- **Chrome Extension** — Manifest V3 with `activeTab`, `storage`, and `scripting` permissions
- **Vanilla JavaScript** — No frameworks or build step required
- **Airtable REST API** — Direct API calls from the background service worker
- **HTML-to-Markdown** — Custom converter preserving bold, italic, lists, links, headings, and blockquotes

## Project Structure

```
chrome-extension/
├── manifest.json        # Extension configuration (Manifest V3)
├── popup.html           # Popup UI with form fields
├── popup.js             # Core scraping logic and UI orchestration
├── background.js        # Service worker handling Airtable API calls
├── options.html         # Settings page UI
├── options.js           # Settings management and credential validation
├── content.js           # Content script for DOM access
└── richtext-utils.js    # Unused (legacy rich text array approach)
```

## License

MIT
