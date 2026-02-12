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
        function extractJobTitle() {
          const h1 = document.querySelector("h1");
          if (h1 && h1.textContent.trim().length > 2) return h1.textContent.trim();
          const ogTitle = document.querySelector('meta[property="og:title"]');
          if (ogTitle && ogTitle.content) return ogTitle.content.trim();
          const title = document.title || "";
          return title.split(/\s*[|\-\u2013\u2014]\s*/)[0].trim();
        }

        function formatCompanyName(slug) {
          return slug.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        }

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

        function extractLocation() {
          const bodyText = document.body.innerText || "";
          const locationPatterns = [
            /(?:Location|Office|Based in|Work Location)[:\s]*([^\n]{3,60})/i,
            /(?:\u{1F4CD}|\u{1F30D}|\u{1F3E2})\s*([^\n]{3,60})/u,
          ];
          for (const pattern of locationPatterns) {
            const match = bodyText.match(pattern);
            if (match) {
              const loc = match[1].trim().replace(/[;].*$/, "").trim();
              if (loc.length > 2 && loc.length < 80) return loc;
            }
          }
          const cityStatePattern = /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*))\b/;
          const cityMatch = bodyText.match(cityStatePattern);
          if (cityMatch) {
            const candidate = cityMatch[1].trim();
            const surrounding = bodyText.substring(Math.max(0, cityMatch.index - 20), cityMatch.index + candidate.length + 30);
            const workType = surrounding.match(/\b(Remote|Hybrid|On[- ]?site|In[- ]?office)\b/i);
            if (workType) return `${candidate}, ${workType[1]}`;
            return candidate;
          }
          const remoteMatch = bodyText.match(/\b(Fully Remote|Remote|Hybrid|On[- ]?site|In[- ]?office)\b/i);
          if (remoteMatch) return remoteMatch[1];
          return "";
        }

        function extractSalary() {
          const bodyText = document.body.innerText || "";
          const fullRange = bodyText.match(/\$[\d,]+(?:\.\d{2})?\s*[-\u2013\u2014to]+\s*\$[\d,]+(?:\.\d{2})?(?:\s*(?:per\s+(?:year|annum|month|hour)|\/\s*(?:yr|year|mo|month|hr|hour)|a\s+year|annually|USD))?/i);
          if (fullRange) return fullRange[0].trim();
          const kRange = bodyText.match(/\$\d+[Kk]\s*[-\u2013\u2014to]+\s*\$\d+[Kk](?:\s*(?:per\s+year|\/yr|annually))?/i);
          if (kRange) return kRange[0].trim();
          const single = bodyText.match(/(?:salary|compensation|pay|base)[:\s]*\$[\d,]+(?:\.\d{2})?(?:\s*[-\u2013\u2014]\s*\$[\d,]+(?:\.\d{2})?)?/i);
          if (single) return single[0].replace(/^(?:salary|compensation|pay|base)[:\s]*/i, "").trim();
          return "";
        }

        function elementToAirtableRichText(element) {
          const richText = [];
          function processNode(node) {
            if (node.nodeType === 3) {
              const text = node.textContent;
              if (text && text.trim().length > 0) {
                richText.push({ text: text });
              }
              return;
            }
            if (node.nodeType === 1) {
              const tag = node.tagName.toLowerCase();
              if (['script', 'style', 'noscript', 'iframe', 'nav', 'header', 'footer'].includes(tag)) return;
              if (tag === 'br') {
                if (richText.length > 0) {
                  richText[richText.length - 1].text += '\n';
                } else {
                  richText.push({ text: '\n' });
                }
                return;
              }
              if (['p', 'div', 'li'].includes(tag)) {
                for (let child of node.childNodes) processNode(child);
                if (richText.length > 0 && !richText[richText.length - 1].text.endsWith('\n')) {
                  richText[richText.length - 1].text += '\n';
                }
                return;
              }
              if (['ul', 'ol'].includes(tag)) {
                for (let i = 0; i < node.childNodes.length; i++) {
                  const child = node.childNodes[i];
                  if (child.nodeType === 1 && child.tagName.toLowerCase() === 'li') {
                    richText.push({ text: (tag === 'ul' ? '• ' : (i + 1) + '. ') });
                    processNode(child);
                  }
                }
                return;
              }
              if (['strong', 'b'].includes(tag)) {
                const startIdx = richText.length;
                for (let child of node.childNodes) processNode(child);
                for (let i = startIdx; i < richText.length; i++) richText[i].bold = true;
                return;
              }
              if (['em', 'i'].includes(tag)) {
                const startIdx = richText.length;
                for (let child of node.childNodes) processNode(child);
                for (let i = startIdx; i < richText.length; i++) richText[i].italic = true;
                return;
              }
              if (tag === 'u') {
                const startIdx = richText.length;
                for (let child of node.childNodes) processNode(child);
                for (let i = startIdx; i < richText.length; i++) richText[i].underline = true;
                return;
              }
              if (['del', 's'].includes(tag)) {
                const startIdx = richText.length;
                for (let child of node.childNodes) processNode(child);
                for (let i = startIdx; i < richText.length; i++) richText[i].strikethrough = true;
                return;
              }
              if (tag.match(/^h[1-6]$/)) {
                richText.push({ text: '\n' });
                const startIdx = richText.length;
                for (let child of node.childNodes) processNode(child);
                for (let i = startIdx; i < richText.length; i++) richText[i].bold = true;
                if (richText.length > 0 && !richText[richText.length - 1].text.endsWith('\n')) {
                  richText[richText.length - 1].text += '\n';
                }
                return;
              }
              for (let child of node.childNodes) processNode(child);
            }
          }
          processNode(element);
          const merged = [];
          for (let item of richText) {
            if (merged.length > 0) {
              const last = merged[merged.length - 1];
              if (last.bold === item.bold && last.italic === item.italic && last.underline === item.underline && last.strikethrough === item.strikethrough) {
                last.text += item.text;
                continue;
              }
            }
            merged.push(item);
          }
          return merged.map(item => {
            const cleaned = { text: item.text };
            if (item.bold) cleaned.bold = true;
            if (item.italic) cleaned.italic = true;
            if (item.underline) cleaned.underline = true;
            if (item.strikethrough) cleaned.strikethrough = true;
            return cleaned;
          });
        }

        function airtableRichTextToPlainText(richText) {
          if (!Array.isArray(richText)) return '';
          return richText.map(item => item.text).join('');
        }

        function extractDescription() {
          const contentSelectors = ['[class*="job-description"]', '[class*="jobDescription"]', '[class*="job_description"]', '[id*="job-description"]', '[id*="jobDescription"]', '.posting-page', '.content-wrapper .posting', '[data-qa="job-description"]', '.job-details', '.job-content', '.description', 'article', 'main', '[role="main"]'];
          let contentEl = null;
          for (const sel of contentSelectors) {
            contentEl = document.querySelector(sel);
            if (contentEl) break;
          }
          if (!contentEl) contentEl = document.body;
          const clone = contentEl.cloneNode(true);
          const removeSelectors = ['nav', 'header', 'footer', '.nav', '.header', '.footer', '.sidebar', '.cookie-banner', '.social-share', '[class*="apply-button"]', '[class*="similar-jobs"]', 'script', 'style', 'noscript', 'iframe'];
          for (const sel of removeSelectors) {
            clone.querySelectorAll(sel).forEach((el) => el.remove());
          }
          const richText = elementToAirtableRichText(clone);
          let plainText = airtableRichTextToPlainText(richText);
          plainText = plainText.replace(/\t/g, " ").replace(/ {2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
          if (plainText.length > 50000) {
            plainText = plainText.substring(0, 50000) + "\n\n[Truncated]";
            return plainText;
          }
          if (richText.some(item => item.bold || item.italic || item.underline || item.strikethrough)) {
            return richText;
          }
          return plainText;
        }

        return {
          jobTitle: extractJobTitle(),
          company: extractCompany(),
          location: extractLocation(),
          salary: extractSalary(),
          description: extractDescription(),
          url: window.location.href,
        };
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
  
  // Handle description which might be plain text or rich text
  if (Array.isArray(data.description)) {
    // It's rich text format - convert to plain text for display
    elements.description.value = data.description.map(item => item.text).join('');
    // Store the rich text in a data attribute for later use
    elements.description.dataset.richText = JSON.stringify(data.description);
  } else {
    // It's plain text
    elements.description.value = data.description || "";
    delete elements.description.dataset.richText;
  }
  
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

  // Prepare description - use rich text if available
  let description = elements.description.value.trim();
  if (elements.description.dataset.richText) {
    try {
      description = JSON.parse(elements.description.dataset.richText);
    } catch {
      // Fall back to plain text if parsing fails
    }
  }

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
