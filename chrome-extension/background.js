// Background service worker: handles Airtable API calls
// Keeps the API key out of content scripts for security

/* global chrome */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "saveToAirtable") {
    saveToAirtable(message.data)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    // Return true to indicate async response
    return true;
  }
});

async function saveToAirtable(jobData) {
  // Retrieve settings from storage
  const settings = await chrome.storage.sync.get([
    "airtableToken",
    "airtableBaseId",
    "airtableTableName",
  ]);

  if (!settings.airtableToken || !settings.airtableBaseId || !settings.airtableTableName) {
    throw new Error("Airtable settings not configured. Please open extension options.");
  }

  const { airtableToken, airtableBaseId, airtableTableName } = settings;

  const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableTableName)}`;

  // Description is now a Markdown string (Airtable rich text fields use Markdown)
  const description = jobData.description || "";

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${airtableToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      records: [
        {
          fields: {
            "Job Title": jobData.jobTitle || "",
            "Company": jobData.company || "",
            "Location": jobData.location || "",
            "Salary Range": jobData.salary || "",
            "Job Description": description,
            "URL": jobData.url || "",
          },
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    let errorMessage = `Airtable API error (${response.status})`;
    try {
      const parsed = JSON.parse(errorBody);
      if (parsed.error && parsed.error.message) {
        errorMessage = parsed.error.message;
      }
    } catch {
      // Use generic message
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}
