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
    throw new Error("Airtable not configured. Open Settings to add your credentials.");
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
            "Job Title": jobData.jobTitle || "",
            "Company": jobData.company || "",
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
    let errorMessage = `Airtable error (${response.status}). Check Settings.`;
    try {
      const parsed = JSON.parse(errorBody);
      const type = parsed.error?.type;
      const msg = parsed.error?.message || "";

      if (response.status === 401 || type === "AUTHENTICATION_REQUIRED") {
        errorMessage = "Invalid API token. Check your token in Settings.";
      } else if (type === "UNKNOWN_FIELD_NAME") {
        const match = msg.match(/Unknown field name: "(.+?)"/);
        const field = match ? `"${match[1]}"` : "a field";
        errorMessage = `Field ${field} not found in Airtable. Field names are case-sensitive.`;
      } else if (response.status === 403) {
        errorMessage = "Permission denied. Ensure your token has data.records:write scope.";
      } else if (response.status === 404) {
        errorMessage = "Base or table not found. Check your Base ID and table name in Settings.";
      } else if (response.status === 422) {
        errorMessage = msg || "Invalid data — check your field names and types in Airtable.";
      } else if (response.status === 429) {
        errorMessage = "Rate limited. Wait a moment and try again.";
      } else if (msg) {
        errorMessage = msg;
      }
    } catch {
      // Use generic message
    }
    throw new Error(errorMessage);
  }

  return await response.json();
}
