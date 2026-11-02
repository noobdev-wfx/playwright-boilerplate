import launchBrowserWithExtension from "../../utils/browser.js";
import createLogger from "../../utils/logger.js";
import renameVideoFile from "../../utils/videoHelper.js";
import highlight from "../../utils/highlight.js";
import createHtmlReporter from "../../utils/htmlReporter.js";
import {
  coupaUrl,
  loginIfNeeded,
  waitForPopupFrame,
  waitForPopupGone,
  closePopup,
  resetPopupFrequency,
  listPopupButtons,
  formatButtons,
  runFlow,
  catalogSearchSteps,
  commodityDropdownSteps,
  clickQuotedButton,
} from "../../utils/whatfix.js";

// Home > "Not Sure? Let us guide you" > "Skip to write a request" > Whatfix popup > CTA
// Run one case only with: node tests/Popup/WriteRequestPopup.js <part of case name>
//   e.g. node tests/Popup/WriteRequestPopup.js search

const homepageUrl = coupaUrl("/user/home");
const writeRequestUrl = coupaUrl(
  "/user/home#currentState=write_request&currentContext=%7B%22selectedSuggestedOption%22%3A%7B%7D%2C%22item%22%3A%7B%22description%22%3A%22%22%7D%2C%22contentGroups%22%3A%5B%7B%22id%22%3A1%2C%22name%22%3A%22Everyone%22%7D%5D%2C%22selectedContentGroup%22%3A1%2C%22showWriteRequest%22%3Atrue%2C%22otherFields%22%3A%7B%7D%7D"
);
const WRITE_REQUEST_POPUP_TEXT = /search catalog|non[\s-]?catalog/i;
const SEARCH_ITEM = "laptop"; // catalog item typed during the Search Catalog flow

const TEST_CASES = [
  {
    name: "Write_Request_Search_Catalog",
    ctaName: "Search catalog",
    cta: /search catalog/i,
    // Flow 5c986b03-668e-4a02-95e3-225ccb895743
    stepActions: [...catalogSearchSteps(SEARCH_ITEM), clickQuotedButton],
  },
  {
    name: "Write_Request_Non_Catalog",
    ctaName: "Continue with Non-Catalogue",
    cta: /continue with non[\s-]?catalog/i,
    stepActions: [...commodityDropdownSteps("Services"), clickQuotedButton],
  },
];

// Clicks a Coupa button/link by its visible text, in the page or any frame.
async function clickByText(page, text, timeout = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const frame of page.frames()) {
      for (const locator of [
        frame.getByRole("button", { name: text }),
        frame.getByRole("link", { name: text }),
        frame.getByText(text),
      ]) {
        const target = locator.first();
        if (await target.isVisible().catch(() => false)) {
          await highlight(page, target);
          await page.waitForTimeout(500);
          await target.click();
          return true;
        }
      }
    }
    await page.waitForTimeout(500);
  }
  return false;
}

async function waitForWriteRequestUrl(page, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (new URL(page.url()).hash.includes("currentState=write_request")) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

async function runCase({ name, ctaName, cta, stepActions }) {
  const logger = createLogger(name);
  const reporter = createHtmlReporter(name);
  const log = (status, message) => {
    logger.log(`[${status}] ${message}`);
    reporter.log(status, message);
  };

  let context, page;
  let testFailed = false;

  try {
    context = await launchBrowserWithExtension();
    page = context.pages()[0] || (await context.newPage());

    log("INFO", `Navigating to Coupa home page: ${homepageUrl}`);
    await page.goto(homepageUrl, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, context, homepageUrl, log);

    // Make sure the write-request popup isn't suppressed by an earlier run
    await resetPopupFrequency(page, log);

    // The home page welcome popup can cover the Coupa buttons
    const homePopup = await waitForPopupFrame(page, { timeout: 8000 });
    if (homePopup && (await closePopup(homePopup))) {
      log("INFO", "Closed the home page Whatfix popup.");
      await page.waitForTimeout(1000);
    }

    if (!(await clickByText(page, /let us guide you/i))) {
      throw new Error('"Not Sure? Let us guide you" button not found.');
    }
    log("PASSED", 'Clicked "Not Sure? Let us guide you".');

    if (!(await clickByText(page, /skip to write a request/i))) {
      throw new Error('"Skip to write a request" not found.');
    }
    log("PASSED", 'Clicked "Skip to write a request".');

    if (!(await waitForWriteRequestUrl(page))) {
      throw new Error(`Did not land on the write-request page. Current URL: ${page.url()}`);
    }
    if (page.url() === writeRequestUrl) {
      log("PASSED", "Landed on the expected write-request URL.");
    } else {
      log("PASSED", `Landed on the write-request page (URL differs from expected): ${page.url()}`);
    }

    log("INFO", "Waiting for the write-request Whatfix popup...");
    const popupFrame = await waitForPopupFrame(page, {
      timeout: 20000,
      hasText: WRITE_REQUEST_POPUP_TEXT,
      dismissOthers: true,
      log,
    });
    if (!popupFrame) {
      throw new Error("Write-request Whatfix popup did not appear.");
    }
    const popupText = await popupFrame.evaluate(() =>
      document.body.innerText.replace(/\s+/g, " ").trim()
    );
    log("PASSED", `Popup appeared: "${popupText.slice(0, 200)}"`);
    await page.waitForTimeout(1500);

    const buttons = await listPopupButtons(popupFrame);
    log("INFO", `Popup buttons: ${formatButtons(buttons)}`);

    const ctaBtn = buttons.find((b) => cta.test(b.text) || cta.test(b.aria));
    if (!ctaBtn) {
      throw new Error(`"${ctaName}" button not found on the popup.`);
    }
    const ctaLocator = popupFrame.locator(`[data-wfx-auto="${ctaBtn.index}"]`);
    await highlight(page, ctaLocator);
    await page.waitForTimeout(500);
    await ctaLocator.click();
    log(
      "PASSED",
      `Clicked "${ctaBtn.text}"${ctaBtn.action ? ` (configured action: ${ctaBtn.action})` : ""}.`
    );

    if (await waitForPopupGone(page, WRITE_REQUEST_POPUP_TEXT)) {
      log("PASSED", "Popup closed after the CTA click.");
    } else {
      log("FAILED", "Popup is still open after the CTA click.");
      testFailed = true;
    }

    if (!(await runFlow(page, log, { stepActions, screenshotName: name }))) {
      testFailed = true;
    }
    log("INFO", `Page URL at the end: ${page.url()}`);

    await page.waitForTimeout(2000);
  } catch (err) {
    log("FAILED", `Test case failed with error: ${err.message}`);
    testFailed = true;
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
