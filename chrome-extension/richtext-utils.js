/**
 * Utility functions to convert HTML/DOM to Airtable rich text format
 * 
 * Airtable rich text format: 
 * [
 *   {
 *     "text": "content",
 *     "bold": true/false,
 *     "italic": true/false,
 *     "underline": true/false,
 *     "strikethrough": true/false
 *   }
 * ]
 */

/**
 * Convert an HTML element to Airtable rich text format
 * @param {HTMLElement} element - The DOM element to convert
 * @returns {Array} Airtable rich text array
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

      // Handle line breaks in content
      if (tag === 'hr') {
        richText.push({ text: '\n—\n' });
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
 * Convert a plain text string to simple Airtable rich text format
 * @param {string} text - Plain text to convert
 * @returns {Array} Airtable rich text array
 */
function plainTextToAirtableRichText(text) {
  if (!text || text.trim().length === 0) {
    return [];
  }
  return [{ text: text }];
}

/**
 * Convert Airtable rich text format to plain text (for display/fallback)
 * @param {Array} richText - Airtable rich text array
 * @returns {string} Plain text
 */
function airtableRichTextToPlainText(richText) {
  if (!Array.isArray(richText)) {
    return '';
  }
  return richText.map(item => item.text).join('');
}

/**
 * Check if a value is already in Airtable rich text format
 * @param {*} value - Value to check
 * @returns {boolean} True if it's Airtable rich text
 */
function isAirtableRichText(value) {
  if (!Array.isArray(value)) {
    return false;
  }
  return value.every(item => 
    typeof item === 'object' && 
    item !== null && 
    'text' in item
  );
}
