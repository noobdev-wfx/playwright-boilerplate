import launchBrowserWithExtension from "../../utils/browser.js";
import createLogger from "../../utils/logger.js";
import renameVideoFile from "../../utils/videoHelper.js";
import highlight from "../../utils/highlight.js";
import createHtmlReporter from "../../utils/htmlReporter.js";
import {
  coupaUrl,
  loginIfNeeded,
  waitForPopupFrame,
  resetPopupFrequency,
  listPopupButtons,
  formatButtons,
  runFlow,
} from "../../utils/whatfix.js";

const TEST_NAME = "Welcome_Tour_Flow";
const homepageUrl = coupaUrl("/user/home"); //change home page path here
const EXPECTED_FLOW_ID = "eacecada-b542-4b43-a343-ab7863d58621"; // flow the welcome popup launches
const MAX_CAROUSEL_SLIDES = 10;

// Preferred call-to-action wording on the welcome popup
const CTA_TEXT = /yes|start|tour|begin|get started|explore|let'?s go|show me|take|launch|try/i;
const CLOSE_HINT = /close|dismiss|skip|don'?t show|do not show|^no$|no,? thanks|not now|later|popupClosePanel|^x$|×|✕/i;
// Carousel arrows are id="popupRightNavButton" / "popupLeftNavButton"
const NAV_HINT = /next|prev|previous|back|arrow|nav|slide|carousel|dot|indicator|chevron|^[<>‹›←→]$/i;
const NEXT_HINT = /next|right|forward|^[>›→]$/i;

(async () => {
  const logger = createLogger(TEST_NAME);
  const reporter = createHtmlReporter(TEST_NAME);
  const log = (status, message) => {
    logger.log(`[${status}] ${message}`);
    reporter.log(status, message);
  };

  let context, page;
  let testFailed = false;

  async function clickCtaOnPopup(popupFrame) {
    const popupText = (await popupFrame.evaluate(() => document.body.innerText))
      .replace(/\s+/g, " ")
      .trim();
    log("INFO", `Popup content: "${popupText.slice(0, 200)}"`);

    let isCarousel = false;
    for (let slide = 1; slide <= MAX_CAROUSEL_SLIDES; slide++) {
      const buttons = await listPopupButtons(popupFrame);
      log("INFO", `Slide ${slide} buttons: ${formatButtons(buttons)}`);

      const describe = (b) => `${b.id} ${b.cls} ${b.aria} ${b.text}`;
      const closeBtns = buttons.filter((b) => CLOSE_HINT.test(b.id) || CLOSE_HINT.test(b.aria) || CLOSE_HINT.test(b.text));
      const navBtns = buttons.filter((b) => !closeBtns.includes(b) && (NAV_HINT.test(describe(b)) || NAV_HINT.test(b.text)));
      const actionBtns = buttons.filter((b) => !closeBtns.includes(b) && !navBtns.includes(b) && b.text);
      if (navBtns.length) isCarousel = true;

      // The button configured in Whatfix to launch a flow is the real CTA,
      // whatever its label says.
      const flowBtn = buttons.find((b) => b.action.startsWith("flow"));
      if (flowBtn && !flowBtn.action.includes(EXPECTED_FLOW_ID)) {
        log("WARN", `CTA launches ${flowBtn.action}, expected flow ${EXPECTED_FLOW_ID}.`);
      }
      const cta =
        flowBtn ||
        actionBtns.find((b) => CTA_TEXT.test(b.text)) ||
        navBtns.find((b) => CTA_TEXT.test(b.text) && !NEXT_HINT.test(b.text)) ||
        actionBtns[0];

      if (cta) {
        const ctaLocator = popupFrame.locator(`[data-wfx-auto="${cta.index}"]`);
        await highlight(page, ctaLocator);
        await page.waitForTimeout(500);
        await ctaLocator.click();
        log(
          "PASSED",
          `${isCarousel ? "Carousel popup" : "Popup"}: clicked CTA "${cta.text}" on slide ${slide}.`
        );
        return true;
      }

      const nextBtn = navBtns.find((b) => NEXT_HINT.test(describe(b)));
      if (!nextBtn) break;
      await popupFrame.locator(`[data-wfx-auto="${nextBtn.index}"]`).click();
      log("INFO", `Carousel: moved to next slide.`);
      await page.waitForTimeout(1000);
    }

    log("FAILED", "No call-to-action button found on the welcome popup.");
    return false;
  }

  try {
    context = await launchBrowserWithExtension();
    page = context.pages()[0] || (await context.newPage());

    log("INFO", `Navigating to Coupa home page: ${homepageUrl}`);
    await page.goto(homepageUrl, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, context, homepageUrl, log);

    log("INFO", "Waiting for the welcome popup...");
    let popupFrame = await waitForPopupFrame(page);
    if (!popupFrame) {
      await resetPopupFrequency(page, log);
      popupFrame = await waitForPopupFrame(page);
    }

    if (!popupFrame) {
      log("FAILED", "Welcome popup did not appear on the home page.");
      testFailed = true;
    } else {
      log("PASSED", "Welcome popup appeared.");
      await page.waitForTimeout(1500);

      if (!(await clickCtaOnPopup(popupFrame))) {
        testFailed = true;
      } else if (!(await runFlow(page, log, { screenshotName: TEST_NAME }))) {
        testFailed = true;
      }
    }

    log(testFailed ? "FAILED" : "PASSED", `${TEST_NAME} ${testFailed ? "failed" : "completed successfully"}.`);
    await page.waitForTimeout(1000);
    const savedPath = await renameVideoFile(page, TEST_NAME);
    if (savedPath) log("INFO", `Video saved as: ${savedPath}`);
  } catch (err) {
    log("FAILED", `Test case failed with error: ${err.message}`);
    testFailed = true;
  } finally {
    logger.close();
    reporter.generateHtmlReport();
    if (page) await page.close();
    if (context) await context.close();
    if (testFailed) process.exitCode = 1;
  }
})();
