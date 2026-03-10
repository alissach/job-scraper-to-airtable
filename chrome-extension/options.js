// Options page script: manages Airtable credentials

const elements = {
  token: document.getElementById("token"),
  baseId: document.getElementById("baseId"),
  tableName: document.getElementById("tableName"),
  appsTableName: document.getElementById("appsTableName"),
  saveBtn: document.getElementById("saveBtn"),
  testBtn: document.getElementById("testBtn"),
  status: document.getElementById("status"),
  statusText: document.getElementById("statusText"),
};

/* global chrome */

// Load saved settings
async function loadSettings() {
  const settings = await chrome.storage.sync.get([
    "airtableToken",
    "airtableBaseId",
    "airtableTableName",
    "airtableAppsTableName",
  ]);

  if (settings.airtableToken) {
    elements.token.value = settings.airtableToken;
  }
  if (settings.airtableBaseId) {
    elements.baseId.value = settings.airtableBaseId;
  }
  if (settings.airtableTableName) {
    elements.tableName.value = settings.airtableTableName;
  }
  if (settings.airtableAppsTableName) {
    elements.appsTableName.value = settings.airtableAppsTableName;
  }
}

// Save settings
async function saveSettings() {
  const token = elements.token.value.trim();
  const baseId = elements.baseId.value.trim();
  const tableName = elements.tableName.value.trim();
  const appsTableName = elements.appsTableName.value.trim();

  if (!token || !baseId || !tableName) {
    showStatus("error", "Token, Base ID, and Job Scraper Table Name are required.");
    return;
  }

  if (!token.startsWith("pat")) {
    showStatus("error", "Token should start with 'pat'. Check your Personal Access Token.");
    return;
  }

  if (!baseId.startsWith("app")) {
    showStatus("error", "Base ID should start with 'app'. Check your Airtable URL.");
    return;
  }

  await chrome.storage.sync.set({
    airtableToken: token,
    airtableBaseId: baseId,
    airtableTableName: tableName,
    airtableAppsTableName: appsTableName,
  });

  showStatus("success", "Settings saved.");
}

// Test the Airtable connection
async function testConnection() {
  const token = elements.token.value.trim();
  const baseId = elements.baseId.value.trim();
  const tableName = elements.tableName.value.trim();

  if (!token || !baseId || !tableName) {
    showStatus("error", "Fill in all fields before testing.");
    return;
  }

  elements.testBtn.textContent = "Testing...";
  elements.testBtn.disabled = true;

  try {
    // Try to list records (limit 1) to verify credentials and table access
    const url = `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}?maxRecords=1`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.ok) {
      showStatus("success", "Connection successful! Your Airtable base is accessible.");
    } else if (response.status === 401) {
      showStatus("error", "Invalid token. Check your Personal Access Token.");
    } else if (response.status === 403) {
      showStatus(
        "success",
        "Token is valid. If saving jobs works, you're all set."
      );
    } else if (response.status === 404) {
      showStatus(
        "error",
        "Table not found. Check your Base ID and Table Name (case-sensitive)."
      );
    } else {
      const body = await response.text();
      showStatus("error", `Airtable returned status ${response.status}: ${body}`);
    }
  } catch (error) {
    showStatus("error", `Network error: ${error.message}`);
  }

  elements.testBtn.textContent = "Test Connection";
  elements.testBtn.disabled = false;
}

function showStatus(type, message) {
  elements.status.className = `status active ${type}`;
  elements.statusText.textContent = message;
}

// Event listeners
elements.saveBtn.addEventListener("click", saveSettings);
elements.testBtn.addEventListener("click", testConnection);

// Load on init
loadSettings();
