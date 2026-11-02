import { chromium } from "playwright";
import path from "path";
import fs from "fs";
import { getPathHelpers } from "./paths.js";
import { coupaUrl } from "./whatfix.js";

async function launchBrowserWithExtension() {
  const { __dirname } = getPathHelpers(import.meta.url);
  const extensionPath = path.resolve(__dirname, "../whatfix-extension");
  const userDataDir = path.resolve(__dirname, "../loginConfig/tmp-user");
  const videoDir = path.resolve(__dirname, "../videos");

  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }

  // HEADLESS=true npm run <script> runs with no visible window and no
  // slowMo delay. Defaults to headed, as before, for local debugging.
  const headless = process.env.HEADLESS === "true";

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless,
    args: [
      ...(headless ? [] : ["--start-maximized"]),
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--no-default-browser-check",
      "--disable-popup-blocking",
      "--disable-infobars",
      // Look like a normal Chrome session so Whatfix runs automated flow steps
      "--disable-blink-features=AutomationControlled",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
    viewport: headless ? { width: 1920, height: 1080 } : null,
    recordVideo: {
      dir: videoDir,
      size: { width: 1280, height: 720 },
    },
    slowMo: headless ? 0 : 1000,
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
  });

  await context.grantPermissions(["notifications"], {
    origin: coupaUrl(""),
  });

  return context;
}

export default launchBrowserWithExtension;
