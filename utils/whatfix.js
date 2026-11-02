import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import highlight from "./highlight.js";
import { getPathHelpers } from "./paths.js";

const { __dirname } = getPathHelpers(import.meta.url);
dotenv.config({ path: path.resolve(__dirname, "../.env"), quiet: true });

export const POPUP_FRAME_SELECTOR =
  'iframe#wfx-frame-popup, iframe[title="Information popup"]';
export const TOOLTIP_TITLE_SELECTOR = "#wfx-tooltip-title";
export const TOOLTIP_NEXT_SELECTOR = "#wfx-tooltip-next";

const sessionPath = path.resolve(__dirname, "../storage/login.json");
const reportsDir = path.resolve(__dirname, "../reports");

// Builds a Coupa URL from the origin of COUPA_LOGIN_URL in .env
export function coupaUrl(pathAndHash = "/user/home") {
  return new URL(process.env.COUPA_LOGIN_URL).origin + pathAndHash;
}

// Saves the browser session to storage/login.json, keeping only Coupa data
export async function saveSession(context) {
  const state = await context.storageState();
  state.cookies = state.cookies.filter((c) => c.domain.includes("coupacloud.com"));
  state.origins = state.origins.filter((o) => o.origin.includes("coupacloud.com"));
  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, JSON.stringify(state, null, 2));
  return sessionPath;
}

export async function loginIfNeeded(page, context, returnUrl, log) {
  if (!new URL(page.url()).pathname.startsWith("/sessions")) return;

  log("INFO", "Session not active. Logging in with .env credentials...");
  await page
    .locator('#user_login, input[name="user[login]"], #type_User_login')
    .first()
    .fill(process.env.COUPA_USERNAME);
  await page
    .locator('#user_password, input[name="user[password]"], #type_User_password')
    .first()
    .fill(process.env.COUPA_PASSWORD);
  await page
    .locator('button[type="submit"], input[type="submit"], #login_button')
    .first()
    .click();
  await page.waitForURL((url) => !url.pathname.startsWith("/sessions"), {
    timeout: 60000,
  });
  log("PASSED", "Logged in to Coupa.");

  await saveSession(context);
  await page.goto(returnUrl, { waitUntil: "domcontentloaded" });
}

// Visible Whatfix popups on the page, with their text content
async function visiblePopups(page) {
  const popups = [];
  for (const handle of await page.$$(POPUP_FRAME_SELECTOR)) {
    if (!(await handle.isVisible().catch(() => false))) continue;
    const frame = await handle.contentFrame();
    if (!frame) continue;
    const text = await frame
      .evaluate(() => document.body?.innerText.replace(/\s+/g, " ").trim() || "")
      .catch(() => "");
    if (text) popups.push({ frame, text });
  }
  return popups;
}

/**
 * Waits for a visible Whatfix popup and returns its frame.
 * hasText: only accept a popup whose text matches this regex.
 * dismissOthers: close any other popup that shows up while waiting.
 */
export async function waitForPopupFrame(
  page,
  { timeout = 20000, hasText, dismissOthers = false, log } = {}
) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const popup of await visiblePopups(page)) {
      if (!hasText || hasText.test(popup.text)) return popup.frame;
      if (dismissOthers && (await closePopup(popup.frame))) {
        log?.("INFO", `Closed another Whatfix popup: "${popup.text.slice(0, 80)}"`);
      }
    }
    await page.waitForTimeout(500);
  }
  return null;
}

export async function waitForPopupGone(page, hasText, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const popups = await visiblePopups(page);
    if (!popups.some((p) => hasText.test(p.text))) return true;
    await page.waitForTimeout(500);
  }
  return false;
}

// Closes a Whatfix popup with its X icon. With `page`, waits `waitMs` first and
// highlights the X before clicking it.
export async function closePopup(popupFrame, { page, waitMs = 0 } = {}) {
  const closeBtn = popupFrame
    .locator(
      '#popupClosePanel, [aria-label*="close" i], [title*="close" i], button:has-text("✕"), button:has-text("×"), [class*="close" i]:visible'
    )
    .first();
  if (page && waitMs) await page.waitForTimeout(waitMs);
  if (await closeBtn.isVisible().catch(() => false)) {
    if (page) {
      await highlight(page, closeBtn);
      await page.waitForTimeout(500);
    }
    await closeBtn.click();
    return true;
  }
  // No close control matched. Many popup widgets still close on Escape.
  if (page) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(1000);
    return !(await popupFrame.locator("body").isVisible().catch(() => false));
  }
  return false;
}

// Popups are frequency-capped via localStorage (wfx_popup_*). Clear that so
// popups show again on every run.
export async function resetPopupFrequency(page, log) {
  const removed = await page.evaluate(() => {
    const keys = Object.keys(localStorage).filter((k) => k.startsWith("wfx_popup_"));
    keys.forEach((k) => localStorage.removeItem(k));
    return keys.length;
  });
  log("INFO", `Cleared ${removed} popup frequency key(s). Reloading page...`);
  await page.reload({ waitUntil: "domcontentloaded" });
}

// Tags every visible clickable in the popup with data-wfx-auto so it can be
// clicked by index. `action` is the button action configured in Whatfix.
export async function listPopupButtons(popupFrame) {
  return popupFrame.evaluate(() => {
    const isVisible = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
    };
    // Drop tags left over from a previous carousel slide
    document
      .querySelectorAll("[data-wfx-auto]")
      .forEach((el) => el.removeAttribute("data-wfx-auto"));
    return [
      ...document.querySelectorAll(
        'button, a, [role="button"], input[type="button"], input[type="submit"]'
      ),
    ]
      .filter(isVisible)
      .map((el, i) => {
        el.setAttribute("data-wfx-auto", String(i));
        let action = "";
        try {
          const details = JSON.parse(el.getAttribute("data-wfx-dnd-details") || "{}");
          action = [details.buttonAction, details.buttonTarget].filter(Boolean).join("→");
        } catch {}
        return {
          index: i,
          id: el.id,
          cls: String(el.className || ""),
          text: (el.innerText || el.value || "").trim(),
          aria: el.getAttribute("aria-label") || "",
          action,
        };
      });
  });
}

export function formatButtons(buttons) {
  return buttons
    .map((b) => `[${b.text || b.aria || b.id || b.cls.slice(0, 30)}${b.action ? ` (${b.action})` : ""}]`)
    .join(" ");
}

/**
 * Finds the current flow step tooltip and tags its title and Next button with
 * data-wfx-step. Smart tips reuse the same tooltip markup, so once a flow has
 * shown a "Step x/y" counter (requireCounter), tooltips without one are ignored.
 */
async function findStepTooltip(page, requireCounter) {
  return page
    .evaluate(
      ({ titleSel, nextSel, requireCounter }) => {
        document.querySelectorAll("[data-wfx-step]").forEach((el) => el.removeAttribute("data-wfx-step"));
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        const tips = [...document.querySelectorAll(titleSel)].filter(visible).map((title) => {
          let box = title;
          while (box.parentElement && !["fixed", "absolute"].includes(getComputedStyle(box).position)) {
            box = box.parentElement;
          }
          const match = box.innerText.match(/step\s+(\d+)\s*\/\s*(\d+)/i);
          return { title, box, progress: match ? { current: +match[1], total: +match[2] } : null };
        });
        const step = tips.find((t) => t.progress) || (requireCounter ? null : tips[0]);
        if (!step) return null;
        step.title.setAttribute("data-wfx-step", "title");
        step.box.setAttribute("data-wfx-step", "box");
        const next = step.box.querySelector(nextSel);
        const hasNext = !!next && visible(next);
        if (hasNext) next.setAttribute("data-wfx-step", "next");
        return {
          title: step.title.textContent.trim(),
          text: step.box.innerText.replace(/\s+/g, " ").trim(),
          progress: step.progress,
          hasNext,
        };
      },
      { titleSel: TOOLTIP_TITLE_SELECTOR, nextSel: TOOLTIP_NEXT_SELECTOR, requireCounter }
    )
    .catch(() => null);
}

const stepKey = (step) => (step ? `${step.title}|${step.progress?.current ?? ""}` : null);

// Waits for the next step tooltip. Returns null if none shows up, or if a
// Whatfix popup appears after the last step (the end-of-flow message). A popup
// that shows up mid-flow (e.g. a page popup) is closed so the flow can go on.
async function waitForStep(page, lastProgress, timeout, log) {
  const requireCounter = !!lastProgress;
  const atLastStep = lastProgress && lastProgress.current >= lastProgress.total;
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const step = await findStepTooltip(page, requireCounter);
    if (step) return step;
    const popups = requireCounter ? await visiblePopups(page) : [];
    if (popups.length && atLastStep) return null;
    for (const popup of popups) {
      log("INFO", `Whatfix popup appeared mid-flow: "${popup.text.slice(0, 80)}". Closing it in 3s...`);
      if (await closePopup(popup.frame, { page, waitMs: 3000 })) {
        log("PASSED", "Closed the mid-flow popup with its X icon.");
      }
    }
    await page.waitForTimeout(300);
  }
  return null;
}

async function waitForStepChange(page, oldStep, requireCounter, timeout = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (stepKey(await findStepTooltip(page, requireCounter)) !== stepKey(oldStep)) return true;
    await page.waitForTimeout(300);
  }
  return false;
}

// Logs what a step shows and which page elements sit next to its tooltip, and
// saves a screenshot, so a missing step action is easy to add.
async function describeStep(page, log, stepNo, screenshotName) {
  const info = await page.evaluate(() => {
    const tip = document.querySelector('[data-wfx-step="box"]');
    if (!tip) return null;
    const r = tip.getBoundingClientRect();
    const describe = (el) =>
      [
        el.tagName.toLowerCase() + (el.id ? `#${el.id}` : "") + (el.name ? `[name=${el.name}]` : ""),
        el.getAttribute("aria-label") || el.placeholder || (el.innerText || el.value || "").trim().slice(0, 40),
      ].filter(Boolean).join(" ");
    const nearest = [
      ...document.querySelectorAll(
        'input, textarea, select, button, a, [role="button"], [role="combobox"], [contenteditable="true"]'
      ),
    ]
      .filter((el) => !tip.contains(el) && !el.closest('[id^="wfx"]'))
      .map((el) => {
        const b = el.getBoundingClientRect();
        if (!b.width || !b.height) return null;
        const dx = Math.max(r.left - b.right, b.left - r.right, 0);
        const dy = Math.max(r.top - b.bottom, b.top - r.bottom, 0);
        return { distance: Math.round(Math.hypot(dx, dy)), label: describe(el) };
      })
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6);
    return {
      text: tip.innerText.replace(/\s+/g, " ").trim(),
      buttons: [...tip.querySelectorAll('button, a, [role="button"]')].map(describe),
      nearest: nearest.map((n) => `${n.distance}px ${n.label}`),
    };
  });

  if (info) {
    log("INFO", `Step ${stepNo} tooltip: "${info.text}" | tooltip buttons: ${info.buttons.join(", ") || "none"}`);
    log("INFO", `Step ${stepNo} nearest page elements: ${info.nearest.join(" | ")}`);
  }
  if (screenshotName) {
    fs.mkdirSync(reportsDir, { recursive: true });
    const file = path.join(reportsDir, `${screenshotName}_step${stepNo}.png`);
    await page.screenshot({ path: file });
    log("INFO", `Screenshot: ${file}`);
  }
}

/**
 * Walks a Whatfix flow until no more step tooltips appear.
 * stepActions: [{ title: /regex/, description, run: async (page, stepTitle) => {} }]
 * for steps that wait for an action on the page instead of offering Next.
 * description can be a string or a function of the step title.
 */
export async function runFlow(
  page,
  log,
  { stepActions = [], maxSteps = 40, screenshotName } = {}
) {
  let stepsDone = 0;
  let lastProgress = null;

  while (stepsDone < maxSteps) {
    const step = await waitForStep(page, lastProgress, 20000, log);

    if (!step) {
      if (stepsDone === 0) {
        await describeStep(page, log, "0_not_started", screenshotName);
        log("FAILED", "Flow did not start: no step tooltip appeared.");
        return false;
      }
      const endPopup = (await visiblePopups(page))[0];
      if (endPopup) log("INFO", `End-of-flow popup: "${endPopup.text.slice(0, 200)}"`);
      if (lastProgress && lastProgress.current < lastProgress.total) {
        await describeStep(page, log, `${stepsDone}_ended`, screenshotName);
        log("FAILED", `Flow ended early, at step ${lastProgress.current} of ${lastProgress.total}.`);
        return false;
      }
      log("PASSED", `Flow completed after ${stepsDone} step(s).`);
      return true;
    }

    stepsDone++;
    lastProgress = step.progress || lastProgress;
    const counter = step.progress ? ` (${step.progress.current}/${step.progress.total})` : "";
    log("INFO", `Step ${stepsDone}${counter}: "${step.title}"`);
    log("INFO", `Step ${stepsDone} tooltip text: "${step.text}"`);

    const action = stepActions.find((a) => a.title.test(step.title));
    if (action) {
      try {
        await action.run(page, step.title, log);
      } catch (err) {
        await describeStep(page, log, stepsDone, screenshotName);
        log("FAILED", `Step ${stepsDone}: ${err.message}`);
        return false;
      }
      const description =
        typeof action.description === "function" ? action.description(step.title) : action.description;
      log("PASSED", `Step ${stepsDone}: ${description}.`);
    } else if (step.hasNext) {
      const nextBtn = page.locator('[data-wfx-step="next"]');
      await highlight(page, nextBtn);
      await nextBtn.click();
      log("PASSED", `Step ${stepsDone}: clicked Next.`);
    } else {
      await describeStep(page, log, stepsDone, screenshotName);
      log("FAILED", `Step ${stepsDone} waits for an action on the page and no action is defined for it.`);
      return false;
    }

    let moved = await waitForStepChange(page, step, !!lastProgress, action ? 4000 : 10000);
    if (!moved && action && step.hasNext) {
      // The click was done but the flow still waits on its Next button
      const nextBtn = page.locator('[data-wfx-step="next"]');
      await highlight(page, nextBtn).catch(() => {});
      await nextBtn.click({ force: true }).catch(() => {});
      log("PASSED", `Step ${stepsDone}: clicked Next.`);
      moved = await waitForStepChange(page, step, !!lastProgress);
    }
    if (!moved) {
      await findStepTooltip(page, !!lastProgress);
      await describeStep(page, log, stepsDone, screenshotName);
      log("FAILED", `Flow did not move past step ${stepsDone} ("${step.title}").`);
      return false;
    }
    await page.waitForTimeout(1000);
  }

  log("WARN", `Reached the ${maxSteps}-step limit.`);
  return false;
}

export async function clickLocator(page, locator) {
  const target = locator.first();
  await target.waitFor({ state: "visible", timeout: 10000 });
  await highlight(page, target);
  await target.click();
}

// Clicks the first visible match across several candidate locators, skipping
// Whatfix's own elements.
export async function clickFirstVisible(page, locators) {
  for (const locator of locators) {
    const count = await locator.count();
    for (let i = 0; i < count; i++) {
      const target = locator.nth(i);
      if (!(await target.isVisible().catch(() => false))) continue;
      const isWhatfix = await target.evaluate((el) => !!el.closest('[id^="wfx"]'));
      if (isWhatfix) continue;
      await highlight(page, target);
      // A Whatfix spotlight overlay can intercept the pointer; force the click if so
      await target.click({ timeout: 5000 }).catch(() => target.click({ force: true, timeout: 5000 }));
      return;
    }
  }
  throw new Error("No visible element matched this step's target.");
}

// Generic step: "Click the 'Review Cart' button" clicks the Coupa button or
// link labelled exactly "Review Cart". Keep it last so specific steps win.
// Label named in a step title: "Click the 'Review Cart' button" -> "Review Cart",
// "Click Create Expense Report" -> "Create Expense Report".
function labelFromStepTitle(stepTitle) {
  const quoted = stepTitle.match(/'([^']+)'/);
  if (quoted) return quoted[1];
  return stepTitle
    .replace(/^\s*click\s+(on\s+)?(the\s+)?/i, "")
    .replace(/\s+(button|link|menu|tab|icon|option)\s*$/i, "")
    .trim();
}

// Like clickFirstVisible, but when several elements match (e.g. two "Create"
// controls) clicks the one closest to the step tooltip, since the tooltip is
// anchored to the element the flow wants clicked.
async function clickNearestToTooltip(page, locators) {
  const tip = await page.locator('[data-wfx-step="box"]').first().boundingBox().catch(() => null);
  const candidates = [];
  for (const locator of locators) {
    const count = await locator.count();
    for (let i = 0; i < count; i++) {
      const target = locator.nth(i);
      if (!(await target.isVisible().catch(() => false))) continue;
      if (await target.evaluate((el) => !!el.closest('[id^="wfx"]'))) continue;
      const box = await target.boundingBox().catch(() => null);
      if (!box) continue;
      const dist = tip
        ? Math.hypot(box.x + box.width / 2 - (tip.x + tip.width / 2), box.y + box.height / 2 - (tip.y + tip.height / 2))
        : 0;
      candidates.push({ target, dist });
    }
  }
  if (!candidates.length) throw new Error("No visible element matched this step's target.");
  candidates.sort((a, b) => a.dist - b.dist);
  const { target } = candidates[0];
  await highlight(page, target);
  await target.click({ timeout: 5000 }).catch(() => target.click({ force: true, timeout: 5000 }));
}

export const clickQuotedButton = {
  title: /^\s*click\b/i,
  description: (stepTitle) => `clicked the button named in "${labelFromStepTitle(stepTitle)}"`,
  // "Click Create to begin a new report…" names the "Create" button and then
  // explains it, so try the label and then shorter and shorter word prefixes.
  run: async (page, stepTitle) => {
    const words = labelFromStepTitle(stepTitle).split(/\s+/);
    // The target can still be loading when the tooltip appears, so retry for a while.
    const deadline = Date.now() + 15000;
    let lastErr = "";
    do {
      for (let n = words.length; n >= 1; n--) {
        const label = words.slice(0, n).join(" ").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const exact = new RegExp(`^\\s*${label}\\s*$`, "i");
        try {
          return await clickNearestToTooltip(
            page,
            page.frames().flatMap((f) => [
              f.getByRole("button", { name: exact }),
              f.getByRole("link", { name: exact }),
              f.getByText(exact),
            ])
          );
        } catch (e) {
          lastErr = e.message.split("\n")[0];
        }
      }
      await page.waitForTimeout(1000);
    } while (Date.now() < deadline);
    const frames = page.frames().map((f) => f.url().slice(0, 80)).join(" | ");
    const creates = await Promise.all(
      page.frames().map((f) =>
        f.evaluate(() =>
          [...document.querySelectorAll("*")]
            .filter((e) => e.children.length === 0 && /^\s*create\s*$/i.test(e.textContent))
            .map((e) => { const r = e.getBoundingClientRect(); return `${e.tagName}.${e.className} parent=${e.parentElement.tagName}#${e.parentElement.id}.${e.parentElement.className} at ${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`; })
            .join("; ")
        ).catch(() => "")
      )
    );
    throw new Error(`No visible button or link named in "${stepTitle}". Last error: ${lastErr}. Frames: ${frames}. "Create" elements: ${creates.join(" || ")}`);
  },
};

// The search results overlay closes with an unlabeled X to the right of the
// search box. Find the close control on that row (never a Whatfix element).
async function closeSearchResults(page, item) {
  const found = await page.evaluate((item) => {
    document.querySelectorAll("[data-coupa-auto]").forEach((el) => el.removeAttribute("data-coupa-auto"));
    const input = [...document.querySelectorAll("input")].find(
      (i) => i.value.toLowerCase() === item && i.getBoundingClientRect().width
    );
    if (!input) return false;
    const box = input.getBoundingClientRect();
    const midY = (box.top + box.bottom) / 2;
    const closeBtn = [...document.querySelectorAll('button, a, [role="button"], span, i, svg, div')]
      .filter((el) => !el.closest('[id^="wfx"]'))
      .filter((el) =>
        /close|dismiss/i.test(
          [el.getAttribute("aria-label"), el.getAttribute("title"), el.id, el.getAttribute("class")].join(" ")
        )
      )
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width && r.height && r.left >= box.right && Math.abs((r.top + r.bottom) / 2 - midY) < 40)
      .sort((a, b) => a.r.left - b.r.left)[0];
    if (!closeBtn) return false;
    closeBtn.el.setAttribute("data-coupa-auto", "close-search");
    return true;
  }, item);

  if (found) {
    await clickLocator(page, page.locator('[data-coupa-auto="close-search"]'));
  } else {
    await page.keyboard.press("Escape");
  }
}

// Steps of the catalog search flow: click the search bar, type `item`,
// Add to Cart on the first result, close the results, open the Cart menu.
export function catalogSearchSteps(item = "laptop") {
  return [
      {
        title: /click the search bar/i,
        description: "clicked the Coupa search bar",
        run: (page) => clickLocator(page, page.getByRole("button", { name: /start your search here/i })),
      },
      {
        title: /type in the name of the item/i,
        description: `typed "${item}" into the search box`,
        run: async (page) => {
          await page.keyboard.type(item, { delay: 100 });
        },
      },
      // Search results hand off to a 7-step add-to-cart flow
      {
        title: /click 'add to cart'/i,
        description: "clicked Add to Cart on the first search result",
        run: (page) => clickLocator(page, page.getByRole("button", { name: /^add to cart$/i })),
      },
      {
        title: /click the x icon/i,
        description: "closed the search results with the X icon",
        run: (page) => closeSearchResults(page, item),
      },
      {
        title: /click on the cart menu/i,
        description: "opened the Cart menu",
        run: (page) =>
          clickFirstVisible(page, [
            page.getByRole("button", { name: /^(my )?cart\b/i }),
            page.getByRole("link", { name: /^(my )?cart\b/i }),
            page.locator('a[href*="/carts"], [aria-label*="cart" i], [title*="cart" i], [id*="cart" i]'),
          ]),
      },
  ];
}

// Steps for the "What domain is this request?" non-catalog request wizard,
// from the point it opens the Commodity field onward: click the field's
// dropdown arrow, then pick `label` via type-ahead (the field is a jQuery UI
// autocomplete input; its open list is an OS popup with no DOM presence, so a
// click on the visible option text does not work).
export function commodityDropdownSteps(label = "Services") {
  return [
    {
      title: /^click here$/i,
      description: "opened the Commodity dropdown",
      run: (page) =>
        clickFirstVisible(page, [
          page
            .locator("#requisition_line_commodity_id_input")
            .locator("xpath=following-sibling::*[self::a or self::button or self::span][1]"),
          page.locator("#requisition_line_commodity_id_input"),
        ]),
    },
    {
      // The Whatfix tooltip for this step has an unclosed quote in its text,
      // e.g. "Click on 'Services" (no closing quote).
      title: new RegExp(`click on ['"]?${label}`, "i"),
      description: `picked "${label}" in the Commodity field`,
      run: async (page) => {
        const input = page.locator("#requisition_line_commodity_id_input");
        await input.click();
        await input.fill("");
        await input.type(label, { delay: 80 });
        await page.waitForTimeout(1000);
        await input.press("Enter");
      },
    },
  ];
}
