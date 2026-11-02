import launchBrowserWithExtension from "../../utils/browser.js";
import createLogger from "../../utils/logger.js";
import renameVideoFile from "../../utils/videoHelper.js";
import highlight from "../../utils/highlight.js";
import createHtmlReporter from "../../utils/htmlReporter.js";
import {
  coupaUrl,
  loginIfNeeded,
  waitForPopupFrame,
  closePopup,
  runFlow,
  clickFirstVisible,
  clickQuotedButton,
  catalogSearchSteps,
  commodityDropdownSteps,
} from "../../utils/whatfix.js";

// Home > Self Help widget > search flow by name > open it > run it end to end
// Run one flow only with: node tests/Flows/FlowsById.js <part of case name>
//   e.g. node tests/Flows/FlowsById.js expense

const homepageUrl = coupaUrl("/user/home");

const SELF_HELP_BUTTON =
  'div._wf_fab_expand_container[role="button"], [aria-label="Open Assistant"], [aria-label*="self help" i], [class*="_wf_fab"]';
const SELF_HELP_SEARCH =
  'textarea#_wf_explorer-search, input#_wf_explorer-search, [class*="_wf_"] input[type="search"], [class*="_wf_"] textarea, [class*="_wf_"] input[placeholder*="search" i]';
const CONTENT_CARD = '[data-testid^="content-card-box"]';
const CONTENT_CARD_TITLE = '[data-testid^="content-card-title"]';

const TEST_CASES = [
  {
    name: "Flow_Create_Expense_Report",
    flowId: "d8ddcaf6-3540-46c1-929b-524387204faf",
    flowName: "Create an Expense Report - Out of Pocket",
    stepActions: [
      {
        title: /click the travel & expenses/i,
        description: "opened Expenses in the top menu",
        run: (page) => clickFirstVisible(page, [page.getByRole("link", { name: /^\s*expenses\s*$/i })]),
      },
      clickQuotedButton,
    ],
  },
  {
    name: "Flow_View_Request_Approvers",
    flowId: "50670edf-16af-4d81-81e4-b8277367899a",
    flowName: "View approvers assigned to a request",
    stepActions: [clickQuotedButton],
  },
  {
    name: "Flow_Create_Catalog_Purchase_Request",
    flowId: "5d38311d-50a1-4fd2-b261-cbc1d16dc4d1",
    flowName: "Create Catalog Item Purchase Request",
    stepActions: [...catalogSearchSteps("laptop"), clickQuotedButton],
  },
  {
    name: "Flow_Change_Password_Manual",
    flowId: "unknown", // give me the real ID and I'll fill this in
    flowName: "How to Change your Password (Manual)",
    stepActions: [
      {
        title: /click on the user icon/i,
        description: "clicked the user avatar icon",
        run: (page) =>
          clickFirstVisible(page, [
            page.locator('[aria-label*="user" i] img, [class*="avatar" i], [class*="user-icon" i]'),
            page.getByText(/^\s*AM\s*$/), // initials shown in the avatar circle
          ]),
      },
      clickQuotedButton,
    ],
  },
  {
    name: "Flow_Request_Non_Catalog_Item",
    flowId: "unknown", // give me the real ID and I'll fill this in
    flowName: "How to Request a non catalogue item",
    stepActions: [
      {
        title: /click here\.?\s*let us guide you/i,
        description: 'clicked "Not sure? Let us guide you"',
        run: (page) => clickFirstVisible(page, [page.getByText(/let us guide you/i)]),
      },
      {
        title: /click here to skip writing a request/i,
        description: 'clicked "Skip to write a request"',
        run: (page) => clickFirstVisible(page, [page.getByText(/skip to write a request/i)]),
      },
      ...commodityDropdownSteps("Services"),
      clickQuotedButton,
    ],
  },
];

// First visible element for a selector, in the page or any frame
async function findVisible(page, selector, timeout = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const frame of page.frames()) {
      const locator = frame.locator(selector);
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        if (await locator.nth(i).isVisible().catch(() => false)) return locator.nth(i);
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

// Lists Whatfix Self Help elements on screen, for the log when something is missing
async function selfHelpInventory(page) {
  const items = [];
  for (const frame of page.frames()) {
    const found = await frame
      .evaluate(() =>
        [...document.querySelectorAll('[class*="_wf_"], [id^="_wf_"], [data-testid]')]
          .filter((el) => el.getBoundingClientRect().width)
          .slice(0, 25)
          .map((el) => `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${el.dataset.testid ? `[data-testid=${el.dataset.testid}]` : ""} ${(el.getAttribute("aria-label") || "").slice(0, 30)}`)
      )
      .catch(() => []);
    items.push(...found);
  }
  return items.join(" | ") || "none";
}

async function openFlowFromSelfHelp(page, flowName, log) {
  const selfHelpBtn = await findVisible(page, SELF_HELP_BUTTON);
  if (!selfHelpBtn) {
    log("INFO", `Whatfix elements on screen: ${await selfHelpInventory(page)}`);
    throw new Error("Self Help button not found.");
  }
  await highlight(page, selfHelpBtn);
  await selfHelpBtn.click();
  log("PASSED", "Opened the Self Help widget.");
  await page.waitForTimeout(2000);

  const search = await findVisible(page, SELF_HELP_SEARCH);
  if (!search) {
    log("INFO", `Whatfix elements on screen: ${await selfHelpInventory(page)}`);
    throw new Error("Self Help search box not found.");
  }
  await search.click();
  await search.fill("");
  await search.type(flowName, { delay: 50 });
  log("PASSED", `Typed "${flowName}" into the Self Help search.`);
  await page.waitForTimeout(3000);

  // Pick the card whose title matches the flow name
  const wanted = flowName.toLowerCase().replace(/[?]/g, "").trim();
  let lastListed = "";
  const start = Date.now();
  while (Date.now() - start < 15000) {
    for (const frame of page.frames()) {
      const cards = frame.locator(CONTENT_CARD);
      const count = await cards.count().catch(() => 0);
      const titles = [];
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        if (!(await card.isVisible().catch(() => false))) continue;
        const title = ((await card.locator(CONTENT_CARD_TITLE).first().innerText().catch(() => "")) || (await card.innerText())).trim();
        titles.push(title);
        if (title.toLowerCase().replace(/[?]/g, "").trim() === wanted) {
          await highlight(page, card);
          await card.click();
          log("PASSED", `Clicked Self Help result "${title}".`);
          return;
        }
      }
      const listed = titles.map((t) => `"${t}"`).join(", ");
      if (titles.length && listed !== lastListed) {
        log("INFO", `Self Help results: ${listed}`);
        lastListed = listed;
      }
    }
    // The results list can be longer than what's rendered; scroll it to load more
    await page.mouse.move(960, 600);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(1000);
  }
  await page.screenshot({ path: `reports/${flowName.replace(/\W+/g, "_")}_selfhelp.png` }).catch(() => {});
  throw new Error(`"${flowName}" not found in Self Help results.`);
}

async function runCase({ name, flowId, flowName, stepActions }) {
  const logger = createLogger(name);
  const reporter = createHtmlReporter(name);
  const log = (status, message) => {
    logger.log(`[${status}] ${message}`);
    reporter.log(status, message);
  };

  let context, page;
  let testFailed = false;

  try {
    log("INFO", `Flow: "${flowName}" (${flowId})`);
    context = await launchBrowserWithExtension();
    page = context.pages()[0] || (await context.newPage());

    log("INFO", `Navigating to Coupa home page: ${homepageUrl}`);
    await page.goto(homepageUrl, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, context, homepageUrl, log);

    // The home page welcome popup can cover the Self Help button
    const homePopup = await waitForPopupFrame(page, { timeout: 8000 });
    if (homePopup && (await closePopup(homePopup))) {
      log("INFO", "Closed the home page Whatfix popup.");
      await page.waitForTimeout(1000);
    }

    await openFlowFromSelfHelp(page, flowName, log);

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
