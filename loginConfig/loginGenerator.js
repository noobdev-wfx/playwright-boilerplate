import path from "path";
import { chromium } from "playwright";
import createLogger from "../utils/logger.js";
import { getPathHelpers } from "../utils/paths.js";
import { coupaUrl, loginIfNeeded, saveSession } from "../utils/whatfix.js";

(async () => {
  const { __dirname } = getPathHelpers(import.meta.url);
  const extensionPath = path.resolve(__dirname, "../whatfix-extension");
  const userDataDir = path.resolve(__dirname, "tmp-user");
  const logger = createLogger("login");
  const log = (status, message) => logger.log(`[${status}] ${message}`);
  const homepageUrl = coupaUrl("/user/home");
  let context;

  try {
    log("INFO", "Launching browser with Whatfix extension...");
    context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    const page = context.pages()[0] || (await context.newPage());

    log("INFO", `Navigating to Coupa home page: ${homepageUrl}`);
    await page.goto(homepageUrl, { waitUntil: "domcontentloaded" });
    await loginIfNeeded(page, context, homepageUrl, log);

    if (new URL(page.url()).pathname.startsWith("/sessions")) {
      throw new Error("Still on the login page after logging in.");
    }
    const savedTo = await saveSession(context);
    log("PASSED", `Coupa session saved to ${savedTo}`);
  } catch (err) {
    log("FAILED", `Login failed: ${err.message}`);
    process.exitCode = 1;
  } finally {
    logger.close();
    if (context) await context.close();
  }
})();
