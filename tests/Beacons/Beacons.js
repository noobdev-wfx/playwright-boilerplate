import fs from "fs";
import path from "path";
import launchBrowserWithExtension from "../../utils/browser.js";
import createLogger from "../../utils/logger.js";
import renameVideoFile from "../../utils/videoHelper.js";
import highlight from "../../utils/highlight.js";
import createHtmlReporter from "../../utils/htmlReporter.js";
import { getPathHelpers } from "../../utils/paths.js";
import { coupaUrl, loginIfNeeded, waitForPopupFrame, closePopup } from "../../utils/whatfix.js";

// Opens each page, hovers every Whatfix beacon on it and checks its tip text.
// Run one beacon only with: node tests/Beacons/Beacons.js <part of case name>
//   e.g. node tests/Beacons/Beacons.js po

const { __dirname } = getPathHelpers(import.meta.url);
const reportsDir = path.resolve(__dirname, "../../reports");

const BEACON_SELECTOR = '[id="wfx-beacon-inner"]';
const BEACON_TIP_SELECTOR = '[id="wfx-beacon-tip"]';

const TEST_CASES = [
  {
    name: "Beacon_Enter_PO_Number",
    beaconName: "Enter PO Number",
    url: coupaUrl("/invoices/63754/edit"),
    expectedText: /po number/i,
  },
  {
    name: "Beacon_Non_Catalog_Request",
    beaconName: "Non catalog request",
    url: coupaUrl(
      "/user/home#currentState=write_request&currentContext=%7B%22selectedSuggestedOption%22%3A%7B%7D%2C%22item%22%3A%7B%22description%22%3A%22%22%7D%2C%22contentGroups%22%3A%5B%7B%22id%22%3A1%2C%22name%22%3A%22Everyone%22%7D%5D%2C%22selectedContentGroup%22%3A1%2C%22showWriteRequest%22%3Atrue%2C%22otherFields%22%3A%7B%7D%7D"
    ),
    expectedText: /new line item|non[\s-]?catalog/i,
  },
];

// Hovers the beacon and returns its tip text, or null if no tip shows up
async function readBeaconTip(page, beacon) {
  await beacon.scrollIntoViewIfNeeded().catch(() => {});
  await highlight(page, beacon);
  await beacon.hover({ force: true });
  const tip = page.locator(BEACON_TIP_SELECTOR).first();
  try {
    await tip.waitFor({ state: "visible", timeout: 5000 });
  } catch {
    return null;
  }
  await highlight(page, tip);
  const text = ((await tip.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
  await page.waitForTimeout(1500);
  await page.mouse.move(5, 5); // move away so the next hover opens a fresh tip
  await page.waitForTimeout(1000);
  return text;
}

async function runCase({ name, beaconName, url, expectedText }) {
  const logger = createLogger(name);
  const reporter = createHtmlReporter(name);
  const log = (status, message) => {
    logger.log(`[${status}] ${message}`);
    reporter.log(status, message);
  };

  let context, page;
  let testFailed = false;

  try {
    log("INFO", `Beacon: "${beaconName}"`);
    context = await launchBrowserWithExtension();
    page = context.pages()[0] || (await context.newPage());

    log("INFO", `Navigating to: ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, context, url, log);
    log("INFO", `Page loaded: ${page.url()}`);

    // A Whatfix popup can cover the beacon. A direct goto to a write-request
    // hash URL causes a full SPA reload, so the popup can take a while to
    // trigger — give it more room than a normal in-app navigation would need.
    const popup = await waitForPopupFrame(page, { timeout: 20000 });
    if (popup) {
      if (await closePopup(popup, { page, waitMs: 3000 })) {
        log("INFO", "Closed a Whatfix popup covering the page.");
      } else {
        log("WARN", "Whatfix popup detected but its close button wasn't found.");
      }
      await page.waitForTimeout(1000);
    }

    try {
      await page.locator(BEACON_SELECTOR).first().waitFor({ state: "visible", timeout: 15000 });
    } catch {
      throw new Error("No Whatfix beacon appeared on the page.");
    }

    const beacons = page.locator(BEACON_SELECTOR);
    const count = await beacons.count();
    log("INFO", `Found ${count} beacon(s) on the page.`);

    const tips = [];
    let matched = null;
    for (let i = 0; i < count; i++) {
      const beacon = beacons.nth(i);
      if (!(await beacon.isVisible().catch(() => false))) continue;
      const text = await readBeaconTip(page, beacon);
      log("INFO", `Beacon ${i + 1} tip: ${text === null ? "(no tip on hover)" : `"${text}"`}`);
      if (text) tips.push(text);
      if (text && expectedText.test(text)) {
        matched = text;
        break;
      }
    }

    if (matched) {
      log("PASSED", `"${beaconName}" beacon tip appeared: "${matched}"`);
    } else {
      throw new Error(`No beacon tip matching "${beaconName}". Tips found: ${tips.map((t) => `"${t}"`).join(", ") || "none"}`);
    }
    await page.waitForTimeout(1000);
  } catch (err) {
    log("FAILED", `Test case failed with error: ${err.message}`);
    if (page) log("INFO", `URL at failure: ${page.url()}`);
    testFailed = true;
    if (page) {
      fs.mkdirSync(reportsDir, { recursive: true });
      const file = path.join(reportsDir, `${name}_failed.png`);
      await page.screenshot({ path: file }).catch(() => {});
      log("INFO", `Screenshot: ${file}`);
    }
  } finally {
    log(testFailed ? "FAILED" : "PASSED", `${name} ${testFailed ? "failed" : "completed successfully"}.`);
    if (page) {
      const savedPath = await renameVideoFile(page, name).catch(() => null);
      if (savedPath) log("INFO", `Video saved as: ${savedPath}`);
    }
    logger.close();
    reporter.generateHtmlReport();
    if (page) await page.close();
    if (context) await context.close();
  }
  return !testFailed;
}

(async () => {
  const only = process.argv[2]?.toLowerCase();
  const cases = TEST_CASES.filter((tc) => !only || tc.name.toLowerCase().includes(only));

  let anyFailed = false;
  for (const testCase of cases) {
    if (!(await runCase(testCase))) anyFailed = true;
  }
  if (anyFailed) process.exitCode = 1;
})();
