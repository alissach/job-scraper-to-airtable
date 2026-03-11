// Background service worker: handles Airtable API calls
// Keeps the API key out of content scripts for security

/* global chrome */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "saveToApps") {
    saveToApps(message.data)
      .then((result) => sendResponse({ success: true, data: result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

// Normalizes raw scraped location text to a readable label.
function mapLocation(location) {
  const loc = (location || "").toLowerCase();
  if (loc.includes("seattle")) return "Seattle";
  if (loc.includes("bellevue")) return "Bellevue";
  if (loc.includes("new york") || loc.includes("nyc")) return "NYC";
  if (loc.includes("remote-first") || loc.includes("remote first")) return "Remote-first";
  if (loc.includes("remote")) return "Remote";
  return location || "";
}

async function saveToApps(jobData) {
  const settings = await chrome.storage.sync.get([
    "airtableToken",
    "airtableBaseId",
    "airtableAppsTableName",
  ]);

  if (!settings.airtableToken || !settings.airtableBaseId || !settings.airtableAppsTableName) {
    throw new Error("Applications table not configured. Please set it in extension options.");
  }

  const { airtableToken, airtableBaseId, airtableAppsTableName } = settings;
  const url = `https://api.airtable.com/v0/${airtableBaseId}/${encodeURIComponent(airtableAppsTableName)}`;

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
            "Role or Job ID": jobData.jobTitle || "",
            "Employer": jobData.company || "",
            "Location": mapLocation(jobData.location),
            "Salary Range": jobData.salary || "",
            "Job Description": jobData.description || "",
            "URL": jobData.url || "",
            "Status": "Interested",
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
