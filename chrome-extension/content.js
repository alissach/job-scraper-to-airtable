// Content script: runs in the context of the active tab to scrape job posting data

(() => {
  /**
   * Convert an HTML element to Airtable rich text format
   */
  function elementToAirtableRichText(element) {
    const richText = [];
    
    function processNode(node) {
      // Handle text nodes
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent;
        if (text && text.trim().length > 0) {
          richText.push({
            text: text,
          });
        }
        return;
      }

      // Handle element nodes
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();
        
        // Skip certain elements
        if (
          tag === 'script' ||
          tag === 'style' ||
          tag === 'noscript' ||
          tag === 'iframe' ||
          tag === 'nav' ||
          tag === 'header' ||
          tag === 'footer'
        ) {
          return;
        }

        // Handle line breaks and paragraphs
        if (tag === 'br') {
          // Add newline to last text element or create new one
          if (richText.length > 0) {
            const last = richText[richText.length - 1];
            last.text += '\n';
          } else {
            richText.push({ text: '\n' });
          }
          return;
        }

        if (tag === 'p' || tag === 'div' || tag === 'li') {
          // Recursively process children
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Add newline after paragraph/div/li
          if (richText.length > 0) {
            const last = richText[richText.length - 1];
            if (!last.text.endsWith('\n')) {
              last.text += '\n';
            }
          }
          return;
        }

        // Handle lists
        if (tag === 'ul' || tag === 'ol') {
          for (let i = 0; i < node.childNodes.length; i++) {
            const child = node.childNodes[i];
            if (child.nodeType === Node.ELEMENT_NODE && child.tagName.toLowerCase() === 'li') {
              // Add bullet or number
              if (tag === 'ul') {
                richText.push({ text: '• ' });
              } else {
                richText.push({ text: (i + 1) + '. ' });
              }
              processNode(child);
            }
          }
          return;
        }

        // Handle strong/bold
        if (tag === 'strong' || tag === 'b') {
          const startIdx = richText.length;
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Mark all added text as bold
          for (let i = startIdx; i < richText.length; i++) {
            richText[i].bold = true;
          }
          return;
        }

        // Handle italic
        if (tag === 'em' || tag === 'i') {
          const startIdx = richText.length;
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Mark all added text as italic
          for (let i = startIdx; i < richText.length; i++) {
            richText[i].italic = true;
          }
          return;
        }

        // Handle underline
        if (tag === 'u') {
          const startIdx = richText.length;
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Mark all added text as underlined
          for (let i = startIdx; i < richText.length; i++) {
            richText[i].underline = true;
          }
          return;
        }

        // Handle strikethrough
        if (tag === 'del' || tag === 's') {
          const startIdx = richText.length;
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Mark all added text as strikethrough
          for (let i = startIdx; i < richText.length; i++) {
            richText[i].strikethrough = true;
          }
          return;
        }

        // Handle headings
        if (tag.match(/^h[1-6]$/)) {
          richText.push({ text: '\n' });
          const startIdx = richText.length;
          for (let child of node.childNodes) {
            processNode(child);
          }
          // Mark as bold for headings
          for (let i = startIdx; i < richText.length; i++) {
            richText[i].bold = true;
          }
          if (richText.length > 0) {
            const last = richText[richText.length - 1];
            if (!last.text.endsWith('\n')) {
              last.text += '\n';
            }
          }
          return;
        }

        // Default: process children without special formatting
        for (let child of node.childNodes) {
          processNode(child);
        }
      }
    }

    processNode(element);
    
    // Merge consecutive text elements with the same formatting
    const merged = [];
    for (let item of richText) {
      if (merged.length > 0) {
        const last = merged[merged.length - 1];
        // Check if formatting is identical
        if (
          last.bold === item.bold &&
          last.italic === item.italic &&
          last.underline === item.underline &&
          last.strikethrough === item.strikethrough
        ) {
          last.text += item.text;
          continue;
        }
      }
      merged.push(item);
    }

    // Clean up formatting: only include formatting properties if they're true
    const cleaned = merged.map(item => {
      const cleaned = { text: item.text };
      if (item.bold) cleaned.bold = true;
      if (item.italic) cleaned.italic = true;
      if (item.underline) cleaned.underline = true;
      if (item.strikethrough) cleaned.strikethrough = true;
      return cleaned;
    });

    return cleaned;
  }

  /**
   * Convert Airtable rich text format to plain text (for display/fallback)
   */
  function airtableRichTextToPlainText(richText) {
    if (!Array.isArray(richText)) {
      return '';
    }
    return richText.map(item => item.text).join('');
  }

  /**
   * Extract job title from the page
   * Priority: h1 > og:title > document.title
   */
  function extractJobTitle() {
    // Try h1 first
    const h1 = document.querySelector("h1");
    if (h1 && h1.textContent.trim().length > 2) {
      return h1.textContent.trim();
    }

    // Try og:title meta tag
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle && ogTitle.content) {
      return ogTitle.content.trim();
    }

    // Fallback to page title, cleaned up
    const title = document.title || "";
    // Remove common suffixes like "| Company Name", "- Company Name"
    return title.split(/\s*[|\-–—]\s*/)[0].trim();
  }

  /**
   * Extract company name from the page
   * Checks URL patterns, og:site_name, page title patterns, and common selectors
   */
  function extractCompany() {
    // Greenhouse: boards.greenhouse.io/{company} or job-boards.greenhouse.io/{company}/jobs/{id}
    const hostname = window.location.hostname;
    if (hostname.includes("greenhouse.io")) {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        return formatCompanyName(parts[0]);
      }
    }

    // Lever pattern: jobs.lever.co/company
    if (hostname.includes("lever.co")) {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        return formatCompanyName(parts[0]);
      }
    }

    // Ashby pattern: jobs.ashbyhq.com/company
    if (hostname.includes("ashbyhq.com")) {
      const parts = window.location.pathname.split("/").filter(Boolean);
      if (parts.length > 0) {
        return formatCompanyName(parts[0]);
      }
    }

    // og:site_name
    const ogSiteName = document.querySelector('meta[property="og:site_name"]');
    if (ogSiteName && ogSiteName.content) {
      return ogSiteName.content.trim();
    }

    // LinkedIn pattern: "Job Title at Company"
    const title = document.title || "";
    const atMatch = title.match(/\bat\s+(.+?)(?:\s*[|\-–—]|$)/i);
    if (atMatch) {
      return atMatch[1].trim();
    }

    // Title pattern: "Company - Job Title" or "Job Title | Company"
    const titleParts = title.split(/\s*[|\-–—]\s*/);
    if (titleParts.length >= 2) {
      // Usually the company is the last segment
      return titleParts[titleParts.length - 1].trim();
    }

    // Look for common company name selectors
    const companySelectors = [
      '[data-company-name]',
      '.company-name',
      '.employer-name',
      '[class*="company"]',
      '[class*="employer"]',
    ];
    for (const sel of companySelectors) {
      const el = document.querySelector(sel);
      if (el && el.textContent.trim().length > 1) {
        return el.textContent.trim();
      }
    }

    return "";
  }

  function formatCompanyName(slug) {
    return slug
      .replace(/[-_]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  /**
   * Extract location from page text
   * Looks for common patterns: "City, State", "Remote", "Hybrid", etc.
   */
  function extractLocation() {
    const bodyText = document.body.innerText || "";

    // Look for explicit location labels
    const locationPatterns = [
      /(?:Location|Office|Based in|Work Location)[:\s]*([^\n]{3,60})/i,
      /(?:📍|🌍|🏢)\s*([^\n]{3,60})/,
    ];

    for (const pattern of locationPatterns) {
      const match = bodyText.match(pattern);
      if (match) {
        const loc = match[1].trim().replace(/[;].*$/, "").trim();
        if (loc.length > 2 && loc.length < 80) {
          return loc;
        }
      }
    }

    // Look for City, State patterns
    const cityStatePattern =
      /\b([A-Z][a-z]+(?:\s[A-Z][a-z]+)*,\s*(?:[A-Z]{2}|[A-Z][a-z]+(?:\s[A-Z][a-z]+)*))\b/;
    const cityMatch = bodyText.match(cityStatePattern);
    if (cityMatch) {
      const candidate = cityMatch[1].trim();
      // Check if it also mentions remote/hybrid nearby
      const surrounding = bodyText.substring(
        Math.max(0, cityMatch.index - 20),
        cityMatch.index + candidate.length + 30
      );
      const workType = surrounding.match(/\b(Remote|Hybrid|On[- ]?site|In[- ]?office)\b/i);
      if (workType) {
        return `${candidate}, ${workType[1]}`;
      }
      return candidate;
    }

    // Check for standalone Remote/Hybrid
    const remoteMatch = bodyText.match(
      /\b(Fully Remote|Remote|Hybrid|On[- ]?site|In[- ]?office)\b/i
    );
    if (remoteMatch) {
      return remoteMatch[1];
    }

    return "";
  }

  /**
   * Extract salary range
   * Matches patterns like $120,000 - $150,000, $120K-$150K, etc.
   */
  function extractSalary() {
    const bodyText = document.body.innerText || "";

    // Full dollar range: $120,000 - $180,000
    const fullRange = bodyText.match(
      /\$[\d,]+(?:\.\d{2})?\s*[-–—to]+\s*\$[\d,]+(?:\.\d{2})?(?:\s*(?:per\s+(?:year|annum|month|hour)|\/\s*(?:yr|year|mo|month|hr|hour)|a\s+year|annually|USD))?/i
    );
    if (fullRange) {
      return fullRange[0].trim();
    }

    // K-notation: $120K - $150K
    const kRange = bodyText.match(
      /\$\d+[Kk]\s*[-–—to]+\s*\$\d+[Kk](?:\s*(?:per\s+year|\/yr|annually))?/i
    );
    if (kRange) {
      return kRange[0].trim();
    }

    // Single salary mention
    const single = bodyText.match(
      /(?:salary|compensation|pay|base)[:\s]*\$[\d,]+(?:\.\d{2})?(?:\s*[-–—]\s*\$[\d,]+(?:\.\d{2})?)?/i
    );
    if (single) {
      return single[0].replace(/^(?:salary|compensation|pay|base)[:\s]*/i, "").trim();
    }

    return "";
  }

  /**
   * Extract the main job description with rich text formatting
   * Tries to isolate the content area and preserve formatting
   */
  function extractDescription() {
    // Common job posting content selectors (ordered by specificity)
    const contentSelectors = [
      '[class*="job-description"]',
      '[class*="jobDescription"]',
      '[class*="job_description"]',
      '[id*="job-description"]',
      '[id*="jobDescription"]',
      ".posting-page",
      ".content-wrapper .posting",
      '[data-qa="job-description"]',
      ".job-details",
      ".job-content",
      ".description",
      "article",
      "main",
      '[role="main"]',
    ];

    let contentEl = null;
    for (const sel of contentSelectors) {
      contentEl = document.querySelector(sel);
      if (contentEl) break;
    }

    if (!contentEl) {
      contentEl = document.body;
    }

    // Clone to avoid modifying the page
    const clone = contentEl.cloneNode(true);

    // Remove unwanted elements
    const removeSelectors = [
      "nav",
      "header",
      "footer",
      ".nav",
      ".header",
      ".footer",
      ".sidebar",
      ".cookie-banner",
      ".social-share",
      '[class*="apply-button"]',
      '[class*="similar-jobs"]',
      "script",
      "style",
      "noscript",
      "iframe",
    ];

    for (const sel of removeSelectors) {
      clone.querySelectorAll(sel).forEach((el) => el.remove());
    }

    // Convert to Airtable rich text format
    const richText = elementToAirtableRichText(clone);
    
    // Convert rich text to string for length checking and plain text fallback
    let plainText = airtableRichTextToPlainText(richText);

    // Normalize whitespace in plain text version
    plainText = plainText
      .replace(/\t/g, " ")
      .replace(/ {2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    // Truncate if extremely long (Airtable long text has a 100k char limit)
    if (plainText.length > 50000) {
      plainText = plainText.substring(0, 50000) + "\n\n[Truncated]";
      // Return as plain text when truncated
      return plainText;
    }

    // Return as rich text if we have formatting, otherwise as plain text
    if (richText.some(item => item.bold || item.italic || item.underline || item.strikethrough)) {
      return richText;
    }

    return plainText;
  }

  // Run all extractors and return the result
  const data = {
    jobTitle: extractJobTitle(),
    company: extractCompany(),
    location: extractLocation(),
    salary: extractSalary(),
    description: extractDescription(),
    url: window.location.href,
  };

  // Return data to whoever called this script
  data;
})();
