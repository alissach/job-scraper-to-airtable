// Popup script: orchestrates scraping and saving

const elements = {
  noConfigState: document.getElementById("noConfigState"),
  loadingState: document.getElementById("loadingState"),
  formState: document.getElementById("formState"),
  buttonRow: document.getElementById("buttonRow"),
  statusBanner: document.getElementById("statusBanner"),
  statusIcon: document.getElementById("statusIcon"),
  statusText: document.getElementById("statusText"),
  jobTitle: document.getElementById("jobTitle"),
  company: document.getElementById("company"),
  location: document.getElementById("location"),
  salary: document.getElementById("salary"),
  description: document.getElementById("description"),
  descCharCount: document.getElementById("descCharCount"),
  url: document.getElementById("url"),
  saveBtn: document.getElementById("saveBtn"),
  rescanBtn: document.getElementById("rescanBtn"),
  openSettings: document.getElementById("openSettings"),
  openSettingsFromConfig: document.getElementById("openSettingsFromConfig"),
};

// State
let isSaving = false;

// Initialize popup
async function init() {
  const settings = await chrome.storage.sync.get([
    "airtableToken",
    "airtableBaseId",
    "airtableTableName",
  ]);

  const isConfigured =
    settings.airtableToken &&
    settings.airtableBaseId &&
    settings.airtableTableName;

  if (!isConfigured) {
    showState("noConfig");
    return;
  }

  await scrapeCurrentTab();
}

// Show different UI states
function showState(state) {
  elements.noConfigState.classList.toggle("active", state === "noConfig");
  elements.loadingState.classList.toggle("active", state === "loading");
  elements.formState.classList.toggle("active", state === "form");
  elements.buttonRow.style.display = state === "form" ? "flex" : "none";
}

// Scrape the current tab
async function scrapeCurrentTab() {
  showState("loading");
  hideStatus();

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab || !tab.id) {
      throw new Error("No active tab found.");
    }

    // Inject and execute the content script in one call using func:
    // This avoids isolated world issues with files: + func: two-step approach
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // ── Utility: format URL slug to title case ──
        function formatCompanyName(slug) {
          return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }

        // ── HTML to Markdown conversion (Airtable rich text uses Markdown) ──
        function elementToMarkdown(element) {
          let result = '';

          function getInlineText(node) {
            if (node.nodeType === 3) return node.textContent;
            if (node.nodeType !== 1) return '';
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'iframe'].includes(tag)) return '';
            let inner = '';
            for (const child of node.childNodes) inner += getInlineText(child);
            if (!inner.trim()) return inner;
            if (['strong', 'b'].includes(tag)) return `**${inner.trim()}** `;
            if (['em', 'i'].includes(tag)) return `*${inner.trim()}* `;
            if (['del', 's'].includes(tag)) return `~~${inner.trim()}~~ `;
            if (tag === 'code') return `\`${inner.trim()}\` `;
            if (tag === 'a' && node.href) return `[${inner.trim()}](${node.href})`;
            if (tag === 'br') return '\n';
            return inner;
          }

          function processNode(node) {
            if (node.nodeType === 3) {
              const text = node.textContent;
              if (text && text.trim().length > 0) {
                result += text;
              }
              return;
            }
            if (node.nodeType !== 1) return;
            const tag = node.tagName.toLowerCase();
            if (['script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer'].includes(tag)) return;

            if (tag === 'br') {
              result += '\n';
              return;
            }
            if (tag.match(/^h([1-3])$/)) {
              const level = parseInt(tag[1]);
              const prefix = '#'.repeat(level) + ' ';
              const text = getInlineText(node).trim();
              if (text) {
                result += '\n' + prefix + text + '\n';
              }
              return;
            }
            if (tag.match(/^h[4-6]$/)) {
              const text = getInlineText(node).trim();
              if (text) {
                result += '\n**' + text + '**\n';
              }
              return;
            }
            if (tag === 'ul') {
              result += '\n';
              for (const child of node.children) {
                if (child.tagName && child.tagName.toLowerCase() === 'li') {
                  const text = getInlineText(child).trim();
                  if (text) result += '- ' + text + '\n';
                }
              }
              return;
            }
            if (tag === 'ol') {
              result += '\n';
              let num = 1;
              for (const child of node.children) {
                if (child.tagName && child.tagName.toLowerCase() === 'li') {
                  const text = getInlineText(child).trim();
                  if (text) result += num++ + '. ' + text + '\n';
                }
              }
              return;
            }
            if (['strong', 'b'].includes(tag)) {
              const inner = getInlineText(node).trim();
              if (inner) result += '**' + inner + '**';
              return;
            }
            if (['em', 'i'].includes(tag)) {
              const inner = getInlineText(node).trim();
              if (inner) result += '*' + inner + '*';
              return;
            }
            if (['del', 's'].includes(tag)) {
              const inner = getInlineText(node).trim();
              if (inner) result += '~~' + inner + '~~';
              return;
            }
            if (tag === 'blockquote') {
              const inner = getInlineText(node).trim();
              if (inner) {
                result += '\n' + inner.split('\n').map(l => '> ' + l).join('\n') + '\n';
              }
              return;
            }
            if (tag === 'p' || tag === 'div') {
              for (const child of node.childNodes) processNode(child);
              if (!result.endsWith('\n')) result += '\n';
              return;
            }
            if (tag === 'li') {
              for (const child of node.childNodes) processNode(child);
              if (!result.endsWith('\n')) result += '\n';
              return;
            }
            for (const child of node.childNodes) processNode(child);
          }

          processNode(element);
          return result;
        }

        // ── JSON-LD structured data extraction (highest priority) ──
        function parseJsonLdLocation(jobLocation) {
          const locations = Array.isArray(jobLocation) ? jobLocation : [jobLocation];
          const parts = [];
          for (const loc of locations) {
            if (typeof loc === 'string') { parts.push(loc.trim()); continue; }
            const address = loc.address;
            if (!address) continue;
            if (typeof address === 'string') { parts.push(address.trim()); continue; }
            const addrParts = [];
            if (address.addressLocality) addrParts.push(address.addressLocality);
            if (address.addressRegion) addrParts.push(address.addressRegion);
            if (address.addressCountry) {
              const country = typeof address.addressCountry === 'string'
                ? address.addressCountry
                : address.addressCountry.name || '';
              if (country && !['US', 'USA', 'United States'].includes(country)) {
                addrParts.push(country);
              }
            }
            if (addrParts.length > 0) parts.push(addrParts.join(', '));
          }
          return parts.length > 0 ? parts.join(' / ') : null;
        }

        function parseJsonLdSalary(baseSalary) {
          if (typeof baseSalary === 'string') return baseSalary.trim() || null;
          const value = baseSalary.value;
          const currency = baseSalary.currency || 'USD';
          const symbol = currency === 'USD' ? '$' : currency + ' ';
          if (!value && baseSalary.minValue == null) return null;
          let unitText = '';
          const unit = (baseSalary.unitText || '').toUpperCase();
          if (unit === 'YEAR' || unit === 'ANNUAL') unitText = '/yr';
          else if (unit === 'MONTH') unitText = '/mo';
          else if (unit === 'HOUR') unitText = '/hr';
          if (typeof value === 'number') {
            return symbol + value.toLocaleString('en-US') + unitText;
          }
          if (typeof value === 'object' && value !== null) {
            const min = value.minValue;
            const max = value.maxValue;
            if (min != null && max != null) return symbol + Number(min).toLocaleString('en-US') + ' - ' + symbol + Number(max).toLocaleString('en-US') + unitText;
            if (min != null) return symbol + Number(min).toLocaleString('en-US') + '+' + unitText;
            if (max != null) return 'Up to ' + symbol + Number(max).toLocaleString('en-US') + unitText;
          }
          // Some schemas put minValue/maxValue directly on baseSalary
          if (baseSalary.minValue != null && baseSalary.maxValue != null) {
            return symbol + Number(baseSalary.minValue).toLocaleString('en-US') + ' - ' + symbol + Number(baseSalary.maxValue).toLocaleString('en-US') + unitText;
          }
          return null;
        }

        function extractFromJsonLd() {
          const result = { jobTitle: null, company: null, location: null, salary: null, descriptionHtml: null };
          const scripts = document.querySelectorAll('script[type="application/ld+json"]');
          for (const script of scripts) {
            try {
              let data = JSON.parse(script.textContent);
              if (data['@graph'] && Array.isArray(data['@graph'])) data = data['@graph'];
              const items = Array.isArray(data) ? data : [data];
              for (const item of items) {
                const itemType = item['@type'];
                const isJobPosting = itemType === 'JobPosting' || (Array.isArray(itemType) && itemType.includes('JobPosting'));
                if (!isJobPosting) continue;
                if (item.title) result.jobTitle = item.title.trim();
                if (item.hiringOrganization) {
                  const org = item.hiringOrganization;
                  if (typeof org === 'string') result.company = org.trim();
                  else if (org.name) result.company = org.name.trim();
                }
                if (item.jobLocation) result.location = parseJsonLdLocation(item.jobLocation);
                if (item.jobLocationType) {
                  const remoteLabel = item.jobLocationType === 'TELECOMMUTE' ? 'Remote' : item.jobLocationType;
                  result.location = result.location ? result.location + ', ' + remoteLabel : remoteLabel;
                }
                if (!result.location && item.applicantLocationRequirements) {
                  const reqs = Array.isArray(item.applicantLocationRequirements) ? item.applicantLocationRequirements : [item.applicantLocationRequirements];
                  const names = reqs.map(r => r.name || '').filter(Boolean);
                  if (names.length > 0) result.location = names.join(', ');
                }
                if (item.baseSalary) result.salary = parseJsonLdSalary(item.baseSalary);
                if (!result.salary && item.estimatedSalary) {
                  const est = Array.isArray(item.estimatedSalary) ? item.estimatedSalary[0] : item.estimatedSalary;
                  if (est) result.salary = parseJsonLdSalary(est);
                }
                if (item.description) result.descriptionHtml = item.description;
                return result;
              }
            } catch (e) { continue; }
          }
          return result;
        }

        // ── Boilerplate stripping for descriptions ──
        function stripBoilerplateFromHtml(container) {
          // Phase 1: Remove elements by selector
          const removeSelectors = [
            'nav', 'header', 'footer',
            '.nav', '.header', '.footer', '.sidebar',
            '.cookie-banner', '.social-share',
            '[class*="apply-button"]', '[class*="apply-now"]',
            '[class*="similar-jobs"]', '[class*="related-jobs"]', '[class*="related-positions"]',
            '[class*="cookie"]', '[class*="privacy"]',
            'script', 'style', 'noscript', 'iframe',
          ];
          for (const sel of removeSelectors) {
            container.querySelectorAll(sel).forEach(el => el.remove());
          }

          // Phase 2: Remove sections by heading text content
          const boilerplateHeadings = [
            /equal\s+(?:opportunity|employment)/i,
            /\beeo\b/i,
            /(?:we\s+(?:do\s+not|don.t)\s+discriminate)/i,
            /non[- ]?discrimination/i,
            /affirmative\s+action/i,
            /privacy\s+(?:policy|notice|statement)/i,
            /cookie\s+(?:policy|notice)/i,
            /similar\s+(?:jobs|roles)/i,
            /related\s+(?:jobs|positions|roles)/i,
            /how\s+to\s+apply/i,
            /application\s+(?:instructions|process|deadline)/i,
            /about\s+(?:us|the\s+company)/i,
            /who\s+we\s+are/i,
            /our\s+(?:company|mission|values|culture|story)/i,
            /benefits\s+(?:&|and)\s+perks/i,
            /what\s+we\s+offer/i,
            /perks\s+(?:&|and)\s+benefits/i,
            /diversity\s+(?:&|and)\s+inclusion/i,
            /work\s+authorization/i,
            /physical\s+(?:requirements|demands)/i,
            /(?:our\s+)?commitment\s+to\s+(?:diversity|inclusion|equity)/i,
            /\baccommodations?\b/i,
            /\bdisclaimer\b/i,
          ];

          const headings = container.querySelectorAll('h1, h2, h3, h4, h5, h6');
          for (const heading of headings) {
            const text = heading.textContent.trim();
            const isBoilerplate = boilerplateHeadings.some(p => p.test(text));
            if (!isBoilerplate) continue;
            // If inside a dedicated section/div, remove the container
            const section = heading.closest('section, [class*="section"], [class*="block"]');
            if (section && section !== container) { section.remove(); continue; }
            // Otherwise remove heading + following siblings until next same-or-higher heading
            const headingLevel = heading.tagName.match(/^H(\d)$/i);
            const level = headingLevel ? parseInt(headingLevel[1]) : 99;
            let sibling = heading.nextElementSibling;
            const toRemove = [heading];
            while (sibling) {
              const sibTag = sibling.tagName.match(/^H(\d)$/i);
              if (sibTag && parseInt(sibTag[1]) <= level) break;
              toRemove.push(sibling);
              sibling = sibling.nextElementSibling;
            }
            toRemove.forEach(el => el.remove());
          }

          // Phase 3: Remove standalone EEO/legal paragraphs by text content
          const eeoPatterns = [
            /equal\s+opportunity\s+employer/i,
            /we\s+(?:are\s+an?\s+)?(?:equal\s+opportunity|affirmative\s+action)/i,
            /(?:we\s+)?(?:do\s+not|don.t)\s+discriminate/i,
            /race,?\s+color,?\s+religion/i,
            /protected\s+(?:class|characteristic|status|veteran)/i,
            /reasonable\s+accommodation/i,
            /\be-verify\b/i,
            /background\s+check\s+(?:will|may)\s+be\s+(?:conducted|required)/i,
            /all\s+qualified\s+applicants\s+will\s+receive\s+consideration/i,
            /without\s+regard\s+to\s+(?:race|age|sex|gender|national\s+origin|disability)/i,
            /pursuant\s+to\s+(?:applicable|state|local|federal)/i,
            /(?:will\s+not|does\s+not)\s+(?:provide|sponsor)\s+(?:work\s+authorization|visa|immigration)/i,
            /visa\s+sponsorship\s+(?:is\s+not\s+)?(?:available|provided|offered)/i,
            /above\s+statements?\s+(?:are\s+)?intended\s+to\s+describe/i,
            /this\s+(?:job\s+)?description\s+is\s+not\s+designed/i,
            /is\s+(?:an?\s+)?(?:equal[\s-]opportunity|eeo|affirmative\s+action)\s+employer/i,
            /is\s+committed\s+to\s+(?:equal|diversity|inclusion|creating\s+a\s+diverse)/i,
            /we\s+celebrate\s+diversity/i,
            /employment\s+is\s+contingent\s+(?:upon|on)/i,
            /\bdrug\s+(?:screen|test|free\s+workplace)\b/i,
            /must\s+be\s+able\s+to\s+(?:lift|stand|sit|walk|bend|stoop)/i,
            /your\s+(?:personal\s+)?information\s+will\s+be\s+kept\s+confidential/i,
            /pay\s+(?:range|scale|transparency)[:\s]/i,
          ];
          const allParagraphs = container.querySelectorAll('p, li, div > span');
          for (let i = allParagraphs.length - 1; i >= 0; i--) {
            const p = allParagraphs[i];
            const text = p.textContent.trim();
            if (text.length === 0) continue;
            if (eeoPatterns.some(pattern => pattern.test(text))) p.remove();
          }

          // Phase 4: Remove trailing legal/boilerplate blocks from the bottom up
          const trailingPatterns = [
            /equal\s+opportunity/i,
            /all\s+qualified\s+applicants/i,
            /without\s+regard\s+to/i,
            /pursuant\s+to/i,
            /visa\s+sponsorship/i,
            /work\s+authorization/i,
            /background\s+check/i,
            /reasonable\s+accommodation/i,
            /is\s+committed\s+to\s+(?:diversity|equal|inclusion)/i,
            /employment\s+is\s+contingent/i,
            /drug\s+(?:screen|test)/i,
            /above\s+statements?\s+(?:are\s+)?intended/i,
            /this\s+(?:job\s+)?description\s+is\s+not\s+designed/i,
            /pay\s+(?:range|scale)[:\s]/i,
            /salary\s+range[:\s]+\$/i,
          ];
          const topChildren = Array.from(container.children);
          for (let i = topChildren.length - 1; i >= 0; i--) {
            const text = topChildren[i].textContent.trim();
            if (!text) { topChildren[i].remove(); continue; }
            if (trailingPatterns.some(p => p.test(text))) {
              topChildren[i].remove();
            } else {
              break;
            }
          }

          return container;
        }

        // ── Fallback: Job title extraction ──
        function extractJobTitle(companyName) {
          // 1. og:title (often more accurate than h1 on job boards)
          const ogTitle = document.querySelector('meta[property="og:title"]');
          if (ogTitle && ogTitle.content) {
            let title = ogTitle.content.trim().replace(/\s+at\s+.+$/i, '').trim();
            if (title.length > 2) return title;
          }

          // 2. Elements with job-title-related classes/attributes
          const titleSelectors = [
            '[data-qa="job-title"]',
            '[class*="job-title"]', '[class*="jobTitle"]', '[class*="job_title"]',
            '[class*="posting-headline"] h2',
            '.app-title',
            '.posting-headline h2',
            '.ashby-job-posting-brief-title',
          ];
          for (const sel of titleSelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 2) return el.textContent.trim();
          }

          // 3. h1 elements, filtered for common non-title headings
          const skipPatterns = /^(careers?|open\s+positions?|jobs?|join\s+us|join\s+our\s+team|work\s+with\s+us|we.re\s+hiring|opportunities)/i;
          const h1s = document.querySelectorAll('h1');
          for (const h1 of h1s) {
            const text = h1.textContent.trim();
            if (text.length <= 2) continue;
            if (skipPatterns.test(text)) continue;
            if (companyName && text.toLowerCase() === companyName.toLowerCase()) continue;
            return text;
          }

          // 4. document.title fallback
          const title = document.title || '';
          return title.split(/\s*[|\-\u2013\u2014]\s*/)[0].replace(/\s+at\s+.+$/i, '').trim();
        }

        // ── Fallback: Company extraction (unchanged) ──
        function extractCompany() {
          const hostname = window.location.hostname;
          if (hostname.includes("greenhouse.io")) {
            const sub = hostname.split(".greenhouse.io")[0].replace("boards.", "");
            if (sub && sub !== "www") return formatCompanyName(sub);
          }
          if (hostname.includes("lever.co")) {
            const parts = window.location.pathname.split("/").filter(Boolean);
            if (parts.length > 0) return formatCompanyName(parts[0]);
          }
          if (hostname.includes("ashbyhq.com")) {
            const parts = window.location.pathname.split("/").filter(Boolean);
            if (parts.length > 0) return formatCompanyName(parts[0]);
          }
          const ogSiteName = document.querySelector('meta[property="og:site_name"]');
          if (ogSiteName && ogSiteName.content) return ogSiteName.content.trim();
          const title = document.title || "";
          const atMatch = title.match(/\bat\s+(.+?)(?:\s*[|\-\u2013\u2014]|$)/i);
          if (atMatch) return atMatch[1].trim();
          const titleParts = title.split(/\s*[|\-\u2013\u2014]\s*/);
          if (titleParts.length >= 2) return titleParts[titleParts.length - 1].trim();
          const companySelectors = ['[data-company-name]', '.company-name', '.employer-name', '[class*="company"]', '[class*="employer"]'];
          for (const sel of companySelectors) {
            const el = document.querySelector(sel);
            if (el && el.textContent.trim().length > 1) return el.textContent.trim();
          }
          return "";
        }

        // ── Fallback: Location extraction ──
        function extractLocation() {
          // 1. Platform-specific DOM selectors
          const locationSelectors = [
            '[data-qa="job-location"]',
            '[class*="job-location"]', '[class*="jobLocation"]', '[class*="job_location"]',
            '[class*="location-display"]',
            '.posting-categories .sort-by-commit',
            '.ashby-job-posting-brief-location',
            '[class*="workplaceType"]',
            '[itemprop="jobLocation"]',
            '[data-automation="jobLocation"]',
            '[data-testid*="location"]',
          ];
          for (const sel of locationSelectors) {
            const el = document.querySelector(sel);
            if (el) {
              const text = el.textContent.trim();
              if (text.length > 1 && text.length < 100) return text;
            }
          }

          // US state abbreviations for validating City, ST matches
          const US_STATES = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']);
          const SKIP_ABBR = new Set(['Inc','LLC','Corp','Ltd','Co','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec','Mon','Tue','Wed','Thu','Fri','Sat','Sun','US','USA','CEO','CTO','CFO','VP','HR','IT','UI','UX','AI','ML','PM','QA','BA','No','St']);

          function cleanLoc(text) {
            return text.trim().replace(/\s*[|;].*$/, '').trim();
          }

          // 2. Meta description tag often contains location
          const metaDesc = document.querySelector('meta[name="description"], meta[property="og:description"]');
          if (metaDesc && metaDesc.content) {
            const m = metaDesc.content.match(/\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*),\s*([A-Z]{2})\b/);
            if (m && US_STATES.has(m[2]) && !SKIP_ABBR.has(m[1])) return m[1] + ', ' + m[2];
            const r = metaDesc.content.match(/\b(Fully Remote|Remote(?:\s*[-–]\s*\w+)?|Hybrid|On[- ]?site)\b/i);
            if (r) return r[1].trim();
          }

          // 3. Job header/meta area — labeled patterns
          const headerArea = document.querySelector(
            '.posting-headline, .job-header, .job-info, ' +
            '[class*="job-header"], [class*="jobHeader"], [class*="job-info"], ' +
            '[class*="posting-header"], [class*="job-meta"]'
          );
          if (headerArea) {
            const ht = headerArea.innerText || '';
            for (const re of [
              /(?:Location|Office|Based in|Work Location|Workplace)[:\s]+([^\n]{3,80})/i,
              /(?:\u{1F4CD}|\u{1F30D}|\u{1F3E2})\s*([^\n]{3,60})/u,
            ]) {
              const m = ht.match(re);
              if (m) { const loc = cleanLoc(m[1]); if (loc.length > 2 && loc.length < 80) return loc; }
            }
          }

          // 4. Labeled patterns anywhere in body text
          const bodyText = document.body.innerText || "";
          for (const re of [
            /^Location[:\s]+(.+)$/im,
            /(?:Location|Office|Based in|Work Location|Workplace Type|Job Location)[:\s]+([^\n]{3,80})/i,
            /(?:\u{1F4CD}|\u{1F30D}|\u{1F3E2})\s*([^\n]{3,60})/u,
          ]) {
            const m = bodyText.match(re);
            if (m) { const loc = cleanLoc(m[1]); if (loc.length > 2 && loc.length < 80) return loc; }
          }

          // 5. City, ST (validated against US state abbreviations) — scan top 8000 chars
          const topText = bodyText.substring(0, 8000);
          const cityStateRe = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*),\s*([A-Z]{2})\b/g;
          let cm;
          while ((cm = cityStateRe.exec(topText)) !== null) {
            if (!US_STATES.has(cm[2]) || SKIP_ABBR.has(cm[1])) continue;
            const result = cm[1] + ', ' + cm[2];
            const ctx = topText.substring(Math.max(0, cm.index - 30), cm.index + result.length + 50);
            const wt = ctx.match(/\b(Remote|Hybrid|On[- ]?site|In[- ]?office)\b/i);
            return wt ? result + ' (' + wt[1] + ')' : result;
          }

          // 6. City, full state name
          const fullStateRe = /\b([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)*),\s*(Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|Florida|Georgia|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|West Virginia|Wisconsin|Wyoming|District of Columbia)\b/i;
          const fsm = topText.match(fullStateRe);
          if (fsm) return fsm[1].trim() + ', ' + fsm[2].trim();

          // 7. Standalone Remote / Hybrid with optional qualifier
          const rm = topText.match(/\b(Fully Remote|Remote(?:\s*[-–(]\s*[\w\s]+\)?)?|Hybrid(?:\s*[-–(]\s*[\w\s]+\)?)?|On[- ]?site|In[- ]?office)\b/i);
          if (rm) return rm[1].trim();

          return "";
        }

        // ── Fallback: Salary extraction ──
        function extractSalary() {
          const bodyText = document.body.innerText || "";

          // 1. Search labeled salary section in header area first (more reliable)
          const headerArea = document.querySelector(
            '.posting-headline, .job-header, .job-info, ' +
            '[class*="job-header"], [class*="jobHeader"], [class*="salary"], [class*="compensation"], ' +
            '[class*="pay-range"], [class*="payRange"], [data-testid*="salary"]'
          );
          if (headerArea) {
            const ht = headerArea.innerText || '';
            const m = ht.match(/\$[\d,]+(?:\.\d{2})?[Kk]?\s*[-\u2013\u2014to]+\s*\$[\d,]+(?:\.\d{2})?[Kk]?(?:\s*(?:per\s+(?:year|annum|month|hour)|\/\s*(?:yr|year|mo|month|hr|hour)|annually))?/i);
            if (m) return m[0].trim();
          }

          // 2. $ range: "$120,000 - $160,000 /yr" or "$120K - $160K"
          const fullRange = bodyText.match(/\$[\d,]+(?:\.\d{2})?[Kk]?\s*[-\u2013\u2014to]+\s*\$[\d,]+(?:\.\d{2})?[Kk]?(?:\s*(?:per\s+(?:year|annum|month|hour)|\/\s*(?:yr|year|mo|month|hr|hour)|a\s+year|annually|USD))?/i);
          if (fullRange) return fullRange[0].trim();

          // 3. Labeled salary with number range (no $ required): "Salary: 120,000 - 160,000"
          const labeledRange = bodyText.match(/(?:salary|compensation|pay|base pay|total pay|pay range|salary range)[:\s]+\$?([\d,]+[Kk]?)\s*[-\u2013\u2014to]+\s*\$?([\d,]+[Kk]?)(?:\s*(?:per\s+(?:year|annum|month|hour)|\/\s*(?:yr|year|mo|month|hr|hour)|annually|USD))?/i);
          if (labeledRange) {
            const raw = labeledRange[0].replace(/^(?:salary|compensation|pay|base pay|total pay|pay range|salary range)[:\s]*/i, '').trim();
            return raw;
          }

          // 4. Hourly rate: "$45/hr" or "$45 - $55 per hour"
          const hourly = bodyText.match(/\$[\d,]+(?:\.\d{2})?\s*[-\u2013\u2014to]*\s*\$?[\d,]*(?:\.\d{2})?\s*(?:per\s+hour|\/\s*hr|\/\s*hour|an\s+hour)/i);
          if (hourly) return hourly[0].trim();

          // 5. Plain number range near salary keyword: "150,000 – 200,000 annually"
          const plainRange = bodyText.match(/(?:salary|compensation|pay)[^\n]{0,30}?([\d,]{5,})\s*[-\u2013\u2014to]+\s*([\d,]{5,})(?:\s*(?:per\s+(?:year|annum)|annually|USD|a\s+year))?/i);
          if (plainRange) {
            const unit = plainRange[0].match(/(?:per\s+(?:year|annum)|annually|USD|a\s+year)/i);
            return '$' + plainRange[1] + ' - $' + plainRange[2] + (unit ? ' ' + unit[0] : '');
          }

          // 6. Single labeled value: "Salary: $120,000"
          const single = bodyText.match(/(?:salary|compensation|pay|base)[:\s]*\$[\d,]+(?:\.\d{2})?(?:[Kk])?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{2})?[Kk]?)?/i);
          if (single) return single[0].replace(/^(?:salary|compensation|pay|base)[:\s]*/i, "").trim();

          return "";
        }

        // ── Description extraction (improved with boilerplate stripping) ──
        function extractDescription(jsonLdHtml) {
          let clone;
          if (jsonLdHtml) {
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = jsonLdHtml;
            clone = tempDiv;
          } else {
            const contentSelectors = [
              '[class*="job-description"]', '[class*="jobDescription"]', '[class*="job_description"]',
              '[id*="job-description"]', '[id*="jobDescription"]',
              '.posting-page', '.content-wrapper .posting', '[data-qa="job-description"]',
              '.job-details', '.job-content', '.description',
              'article', 'main', '[role="main"]',
            ];
            let contentEl = null;
            for (const sel of contentSelectors) {
              contentEl = document.querySelector(sel);
              if (contentEl) break;
            }
            if (!contentEl) contentEl = document.body;
            clone = contentEl.cloneNode(true);
          }

          stripBoilerplateFromHtml(clone);

          let markdown = elementToMarkdown(clone);
          // Clean up whitespace
          markdown = markdown.replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          if (markdown.length > 50000) {
            return markdown.substring(0, 50000) + "\n\n[Truncated]";
          }
          return markdown;
        }

        // ── Orchestrator: JSON-LD first, then fallbacks ──
        function extractAll() {
          const jsonLd = extractFromJsonLd();
          const company = jsonLd.company || extractCompany();
          const jobTitle = jsonLd.jobTitle || extractJobTitle(company);
          const location = jsonLd.location || extractLocation();
          const salary = jsonLd.salary || extractSalary();
          const description = extractDescription(jsonLd.descriptionHtml);
          return { jobTitle, company, location, salary, description, url: window.location.href };
        }

        return extractAll();
      },
    });

    if (!results || !results[0] || !results[0].result) {
      throw new Error("Could not scrape this page. Try a different job posting.");
    }

    const data = results[0].result;
    populateForm(data);
    showState("form");
  } catch (error) {
    showState("form");
    showStatus("error", error.message || "Failed to scrape page.");
  }
}

// Fill form fields with scraped data
function populateForm(data) {
  elements.jobTitle.value = data.jobTitle || "";
  elements.company.value = data.company || "";
  elements.location.value = data.location || "";
  elements.salary.value = data.salary || "";
  
  // Description is a Markdown string
  elements.description.value = data.description || "";
  
  elements.url.value = data.url || "";
  updateCharCount();
}

// Update description character count
function updateCharCount() {
  const len = elements.description.value.length;
  if (len > 0) {
    elements.descCharCount.textContent = `${len.toLocaleString()} chars`;
  } else {
    elements.descCharCount.textContent = "";
  }
}

// Show status banner
function showStatus(type, message) {
  elements.statusBanner.className = `status-banner active ${type}`;
  elements.statusText.textContent = message;

  if (type === "success") {
    elements.statusIcon.innerHTML =
      '<path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  } else {
    elements.statusIcon.innerHTML =
      '<path d="M12 9v4m0 4h.01M12 2a10 10 0 100 20 10 10 0 000-20z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>';
  }
}

function hideStatus() {
  elements.statusBanner.className = "status-banner";
}

// Save to Airtable via background script
async function saveToAirtable() {
  if (isSaving) return;
  isSaving = true;

  const originalText = elements.saveBtn.textContent;
  elements.saveBtn.textContent = "Saving...";
  elements.saveBtn.disabled = true;
  hideStatus();

  const description = elements.description.value.trim();

  const data = {
    jobTitle: elements.jobTitle.value.trim(),
    company: elements.company.value.trim(),
    location: elements.location.value.trim(),
    salary: elements.salary.value.trim(),
    description: description,
    url: elements.url.value.trim(),
  };

  try {
    const response = await chrome.runtime.sendMessage({
      action: "saveToAirtable",
      data,
    });

    if (response.success) {
      showStatus("success", "Saved to Airtable!");
      elements.saveBtn.textContent = "Saved";

      // Reset button after 2 seconds
      setTimeout(() => {
        elements.saveBtn.textContent = originalText;
        elements.saveBtn.disabled = false;
        isSaving = false;
      }, 2000);
    } else {
      throw new Error(response.error || "Unknown error");
    }
  } catch (error) {
    showStatus("error", error.message || "Failed to save. Check your settings.");
    elements.saveBtn.textContent = originalText;
    elements.saveBtn.disabled = false;
    isSaving = false;
  }
}

// Event listeners
elements.saveBtn.addEventListener("click", saveToAirtable);

elements.rescanBtn.addEventListener("click", () => {
  hideStatus();
  scrapeCurrentTab();
});

elements.openSettings.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

elements.openSettingsFromConfig.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

elements.description.addEventListener("input", updateCharCount);

// Start
init();
