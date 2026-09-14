// Dev-only tool: loads the unpacked extension in a real Chromium instance and
// screenshots the popup UI for DEVLOG.md entries. Not part of the shipped
// extension — see README.md in this folder for usage.
//
// Usage:
//   npm run capture -- --out=../../screenshots/<name>.png [options]
//
// Options (all optional except --out):
//   --view=popup|standalone   which surface to screenshot (default: popup)
//   --status=Interested|Applied
//   --dateApplied=YYYY-MM-DD  only shown/sent when --status=Applied
//   --jobTitle, --company, --location, --salary, --description, --url
//     override the sample job data used to fill the form
//   --width, --height         viewport size (defaults: popup 400x640, standalone 420x720)

const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const EXTENSION_PATH = path.resolve(__dirname, "..", "..", "chrome-extension");
const PROFILE_DIR = path.resolve(__dirname, ".profile");

const SAMPLE = {
  jobTitle: "Senior Product Designer",
  company: "Airtable",
  location: "Remote-first",
  salary: "$160,000 - $215,000 /yr",
  description:
    "## About the role\n\nWe're looking for a Senior Product Designer to join our growing design team...\n\n## What you'll do\n\n- Own end-to-end design for core workflows\n- Partner closely with PM and engineering\n- Mentor other designers on the team\n\n## What we're looking for\n\n- 5+ years of product design experience\n- A strong portfolio of shipped work\n- Excellent communication skills",
  url: "https://airtable.com/appIgLEKeqt104yfa/tblITBgUtXbdjJxnc/viwXXXXXXXXXXXXXX",
};

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) args[match[1]] = match[2];
  }
  return args;
}

async function fillForm(page, data) {
  await page.evaluate((data) => {
    document.getElementById("jobTitle").value = data.jobTitle;
    document.getElementById("company").value = data.company;
    document.getElementById("location").value = data.location;
    document.getElementById("salary").value = data.salary;
    document.getElementById("description").value = data.description;
    document.getElementById("url").value = data.url;
    document.getElementById("status").value = data.status;
    document.getElementById("status").dispatchEvent(new Event("change"));
    if (data.dateApplied) {
      document.getElementById("dateApplied").value = data.dateApplied;
    }
    document.getElementById("descCharCount").textContent = `${data.description.length.toLocaleString()} chars`;
    // Reveal the form state the way popup.js's showState("form") does
    document.getElementById("noConfigState").classList.remove("active");
    document.getElementById("loadingState").classList.remove("active");
    document.getElementById("formState").classList.add("active");
    document.getElementById("buttonRow").style.display = "flex";
  }, data);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.out) {
    console.error("Missing required --out=<path> (e.g. --out=../../screenshots/my-feature.png)");
    process.exit(1);
  }

  const view = args.view === "standalone" ? "standalone" : "popup";
  const data = {
    jobTitle: args.jobTitle ?? SAMPLE.jobTitle,
    company: args.company ?? SAMPLE.company,
    location: args.location ?? SAMPLE.location,
    salary: args.salary ?? SAMPLE.salary,
    description: args.description ?? SAMPLE.description,
    url: args.url ?? SAMPLE.url,
    status: args.status ?? "Interested",
    dateApplied: args.dateApplied ?? "",
  };

  const defaultSize = view === "standalone" ? { width: 420, height: 720 } : { width: 400, height: 640 };
  const width = Number(args.width) || defaultSize.width;
  const height = Number(args.height) || defaultSize.height;

  const outPath = path.resolve(__dirname, args.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, // MV3 extensions require a headed context (or Chrome's newer "--headless=new")
    args: [
      `--disable-extensions-except=${EXTENSION_PATH}`,
      `--load-extension=${EXTENSION_PATH}`,
    ],
  });

  try {
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker");
    const extensionId = worker.url().split("/")[2];

    const page = await context.newPage();
    await page.setViewportSize({ width, height });
    const query = view === "standalone" ? "?standalone=1" : "";
    await page.goto(`chrome-extension://${extensionId}/popup.html${query}`);
    await fillForm(page, data);
    await page.waitForTimeout(200);
    await page.screenshot({ path: outPath });
    console.log("Saved", outPath);
  } finally {
    await context.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
