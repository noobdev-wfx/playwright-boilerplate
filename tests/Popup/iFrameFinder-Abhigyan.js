import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import launchBrowserWithExtension from "../../utils/browser.js";
import createLogger from "../../utils/logger.js";
import { getPathHelpers } from "../../utils/paths.js";
import createHtmlReporter from "../../utils/htmlReporter.js";

dotenv.config();

(async () => {
  const { __dirname } = getPathHelpers(import.meta.url);
  const logger = createLogger("iFrame_Finder");
  const reporter = createHtmlReporter("iFrame_Finder");

  let context, page;

  try {
    const username = process.env.COUPA_USERNAME;
    const password = process.env.COUPA_PASSWORD;
    const loginUrl = process.env.COUPA_LOGIN_URL;

    context = await launchBrowserWithExtension();
    page = context.pages()[0] || (await context.newPage());

    // 1. Perform Login
    logger.log(`[INFO] Navigating to login page: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });

    logger.log("[INFO] Logging in with environment credentials...");
    await page.fill('#user_login, input[name="user[login]"], #type_User_login', username);
    await page.fill('#user_password, input[name="user[password]"], #type_User_password', password);
    await page.click('button[type="submit"], input[type="submit"], #login_button');

    await page.waitForNavigation({ waitUntil: "domcontentloaded" });
    logger.log("[INFO] Login complete!");

    // Save state for future scripts
    const storageDir = path.resolve(__dirname, "../../storage");
    if (!fs.existsSync(storageDir)) fs.mkdirSync(storageDir, { recursive: true });
    await context.storageState({ path: path.join(storageDir, "login.json") });

    // 2. Go to the Coupa write-request page
    const writeRequestUrl =
      "https://whatfix-usa-coupalink.coupacloud.com/user/home#currentState=write_request&currentContext=%7B%22selectedSuggestedOption%22%3A%7B%7D%2C%22item%22%3A%7B%22description%22%3A%22%22%7D%2C%22contentGroups%22%3A%5B%7B%22id%22%3A1%2C%22name%22%3A%22Everyone%22%7D%5D%2C%22selectedContentGroup%22%3A1%2C%22showWriteRequest%22%3Atrue%2C%22otherFields%22%3A%7B%7D%7D";

    logger.log("[INFO] Navigating to the write-request URL...");
    await page.goto(writeRequestUrl, { waitUntil: "domcontentloaded" });

    // 3. Wait for dynamic content & popups to render
    await page.waitForTimeout(4000);

    // 4. Log all frames
    const frames = page.frames();
    console.log(`\n========================================`);
    console.log(`TOTAL FRAMES FOUND: ${frames.length}`);
    console.log(`========================================\n`);

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i];
      const title = await frame.title().catch(() => "No Title");
      const name = frame.name() || "No Name";
      const url = frame.url();

      const logMsg = `[FRAME ${i}] Name: "${name}" | Title: "${title}" | URL: ${url}`;
      logger.log(logMsg);
      reporter.log("INFO", logMsg);
      console.log(logMsg);
    }
  } catch (err) {
    logger.log(`[FAILED] Error finding frames: ${err.message}`);
    console.error(`[ERROR] ${err.message}`);
  } finally {
    logger.close();
    reporter.generateHtmlReport();
    if (page) await page.close();
    if (context) await context.close();
  }
})();