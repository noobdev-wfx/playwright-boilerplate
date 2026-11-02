import highlight from "./highlight.js";

export async function waitForVisibleLocator(locator, timeout, page) {
  const pollInterval = 500;
  const maxRetries = Math.ceil(timeout / pollInterval);
  for (let i = 0; i < maxRetries; i++) {
    try {
      if (await locator.isVisible()) {
        return true;
      }
    } catch (e) {}
    await page.waitForTimeout(pollInterval);
  }
  return false;
}

export async function clickWhenReady(locator, name, timeout, page, logger) {
  const ready = await waitForVisibleLocator(locator, timeout, page);
  if (ready) {
    await highlight(page, locator);
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
    if (logger) logger.log(`[INFO] Clicked: '${name}'`);
    return true;
  } else {
    if (logger) logger.log(`[FAILED] '${name}' not visible in time.`);
    return false;
  }
}
