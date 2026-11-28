import { test, expect } from "./helpers.js";

// The home page: one Victorian poster pinned to a wooden board, fitted to
// the screen with no scrolling. The tabs, Benjamin's picture and name,
// "Life Coach", WhatsApp, the holiday message, Talk now, Mind Exercises
// and Brain Games, and the footer are all inside it.
const TABS = ["Home", "Articles", "Mind Exercises", "Brain Games", "RV Lab", "Write to me"];
const SIZES = [[1280, 720], [1366, 768], [1440, 900], [1920, 1080], [1024, 768], [768, 1024], [390, 844], [375, 667], [360, 740]];
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the heading, the holiday message and the buttons, all inside the poster", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  await expect(page).toHaveTitle("Benjamin Mithra | Life Coach");
  const poster = page.getByTestId("poster");
  await expect(poster.getByRole("heading", { level: 1 })).toHaveText("Benjamin Mithra");
  await expect(poster.getByText("Life Coach", { exact: true })).toBeVisible();
  await expect(poster.getByRole("heading", { level: 2 })).toHaveText("Feeling lonely this Holiday Season?");
  for (const line of [
    "You don't have to spend the holidays feeling alone. If you'd like someone to talk to, share a story with, or simply spend a little time having a friendly conversation, I'm here for you.",
    "It's absolutely free. No charges, no catch, no obligations. Just a genuine conversation.",
    "The holiday season is a time for warmth, kindness and connection. You deserve to feel heard, valued and remembered.",
    "Let's share a conversation, a smile and a little happiness. Sometimes, a friendly voice can make all the difference.",
    "You're welcome here. ♥",
  ]) await expect(poster.getByText(line, { exact: true })).toBeVisible();
  // Mind Exercises next to Brain Games, under Talk now.
  const [t, e, g] = [await poster.getByTestId("home-talk-now").boundingBox(), await poster.getByTestId("home-mind-exercises").boundingBox(), await poster.getByTestId("home-brain-games").boundingBox()];
  expect(e.y).toBeGreaterThan(t.y + t.height - 1);
  expect(Math.abs(e.y - g.y)).toBeLessThan(2);
  expect(g.x).toBeGreaterThan(e.x + e.width - 1);
  // The Write to Me form isn't on the home page any more (it's behind the pencil tab).
  await expect(page.locator("#write-to-me")).toHaveCount(0);
});

test("the tabs are inside the poster: no Talk now tab, and a pencil for Write to me", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  const tabs = page.getByTestId("poster").getByRole("navigation", { name: "Main" }).getByRole("link");
  expect(await tabs.evaluateAll((els) => els.map((a) => a.getAttribute("aria-label") || a.textContent.trim()))).toEqual(TABS);
  const pencil = page.getByTestId("poster").getByRole("link", { name: "Write to me" });
  await expect(pencil).toHaveText("");
  await expect(pencil.locator("svg")).toHaveCount(1);
  await pencil.click();
  await expect(page).toHaveURL(/\/consultation$/);
  await expect(page.getByText("Write to Me", { exact: true })).toBeVisible();
  // On the other pages' tabs and menu too.
  await expect(page.locator(".top-tabs a")).toHaveCount(6);
  await expect(page.locator('.top-tabs a[href="/call"]')).toHaveCount(0);
  const sub = await open("/faq", { viewport: { width: 1280, height: 800 } });
  await sub.getByRole("button", { name: "Menu" }).click();
  const items = (await sub.locator('[style*="position: absolute"] a.nav-btn').allInnerTexts()).map((x) => x.trim().toLowerCase());
  expect(items).toEqual(["home", "articles", "mind exercises", "brain games", "rv lab", "write to me", "privacy", "terms", "disclaimer"]);
});

test("Talk now sits in the footer, with the copyright and the policies", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  const footer = page.getByTestId("poster").locator("footer");
  await expect(footer).toContainText(`© ${new Date().getFullYear()} Benjamin Mithra`);
  expect(await footer.getByRole("link").evaluateAll((els) => els.map((a) => [a.textContent, a.getAttribute("href")]))).toEqual([
    ["Talk now", "/call"], ["Privacy Policy", "/privacy"], ["Disclaimer", "/disclaimer"], ["Terms and Conditions", "/terms"],
  ]);
  await footer.getByRole("link", { name: "Talk now" }).click();
  await expect(page).toHaveURL(/\/call$/);
  // The other pages' footers have it too.
  const contact = await open("/consultation", { viewport: { width: 1280, height: 800 } });
  await expect(contact.locator("main").getByRole("link", { name: "Talk now" })).toHaveAttribute("href", "/call");
});

test("Benjamin's picture in a square frame, next to his name", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  const photo = page.getByTestId("home-photo");
  await expect(photo).toHaveAttribute("src", "/benjamin-mithra.jpg");
  const p = await photo.boundingBox();
  const h = await page.locator("#hm-title").boundingBox();
  expect(Math.abs(p.width - p.height)).toBeLessThan(1);
  expect(p.x + p.width).toBeLessThanOrEqual(h.x);
  expect(p.y).toBeLessThan(h.y + h.height);
  expect(await photo.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("double");
});

test("WhatsApp sits under Life Coach; the floating button is gone", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  const wa = page.getByTestId("home-whatsapp");
  await expect(wa).toHaveAttribute("href", /^https:\/\/wa\.me\/447440573315\?text=/);
  await expect(wa).toHaveAttribute("aria-label", "Chat with Benjamin on WhatsApp");
  const ribbon = await page.getByTestId("poster").getByText("Life Coach", { exact: true }).boundingBox();
  const w = await wa.boundingBox();
  expect(w.y).toBeGreaterThan(ribbon.y + ribbon.height - 1);
  for (const path of ["/", "/faq", "/games", "/exercises", "/consultation"]) {
    const p = await open(path, { viewport: { width: 1280, height: 800 } });
    await p.waitForLoadState("load");
    await expect(p.locator(".wa-float"), path).toHaveCount(0);
  }
});

test("the whole poster fits the screen with no scrolling, on laptops and phones", async ({ open }) => {
  for (const [width, height] of SIZES) {
    const page = await open("/", { viewport: { width, height } });
    await page.waitForLoadState("networkidle");
    await page.evaluate(() => document.fonts.ready);
    const m = await page.evaluate(() => {
      const r = document.querySelector("[data-testid=poster]").getBoundingClientRect();
      return { sh: document.documentElement.scrollHeight, ih: innerHeight, sw: document.documentElement.scrollWidth, iw: innerWidth, top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
    const at = `${width}x${height}`;
    expect(m.sh, at).toBeLessThanOrEqual(m.ih);
    expect(m.sw, at).toBeLessThanOrEqual(m.iw);
    expect(m.top, at).toBeGreaterThanOrEqual(0);
    expect(m.bottom, at).toBeLessThanOrEqual(height);
    expect(m.left, at).toBeGreaterThanOrEqual(0);
    expect(m.right, at).toBeLessThanOrEqual(width);
    // The buttons and the footer are on screen, not under Diego or the snowman.
    const footer = await page.getByTestId("poster").locator("footer").boundingBox();
    expect(footer.y + footer.height, at).toBeLessThanOrEqual(height);
    const diego = await page.locator(".gd-home").boundingBox().catch(() => null);
    const brain = await page.getByTestId("home-mind-exercises").boundingBox();
    if (diego) expect(brain.y + brain.height <= diego.y || brain.x >= diego.x + diego.width, at).toBe(true);
  }
});

test("the poster style: wood behind, parchment, Victorian type, a double border and pins", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  const poster = page.getByTestId("poster");
  expect(await poster.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("double");
  await expect(poster.locator(".lp-pin")).toHaveCount(2);
  expect(await page.locator("#hm-title").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Ultra");
  expect(await page.locator(".lp-text").first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Old Standard TT");
  expect(await page.locator("#hm-title").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(36, 23, 15)");
  // Every other page sits on its own pinned poster sheet on the board.
  for (const path of ["/games", "/exercises", "/articles", "/consultation", "/faq"]) {
    const p = await open(path, { viewport: { width: 1280, height: 800 } });
    const sheet = p.getByTestId("poster-sheet");
    await expect(sheet, path).toHaveCount(1);
    expect(await sheet.evaluate((el) => getComputedStyle(el).borderTopStyle), path).toBe("double");
    await expect(sheet.locator("main")).toHaveCount(1);
    expect(await noSidewaysScroll(p), path).toBe(true);
  }
});

test("Diego's tip on the home page leads to the Write to Me form", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  await page.locator(".gd-scene").waitFor();
  await page.locator(".gd-home").click();
  await page.getByRole("link", { name: "Go to the form" }).click();
  await expect(page).toHaveURL(/\/consultation$/);
  await expect(page.getByText("Write to Me", { exact: true })).toBeVisible();
});

test("Mind Exercises, Brain Games and RV Lab still open as before", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 800 } });
  await page.getByTestId("home-mind-exercises").click();
  await expect(page).toHaveURL(/\/exercises$/);
  await expect(page.getByRole("link", { name: /Breathing/i }).first()).toBeVisible();
  await page.goto("/");
  await page.getByTestId("home-brain-games").click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("link", { name: /Chess/i }).first()).toBeVisible();
  await page.goto("/");
  await page.getByTestId("poster").getByRole("link", { name: "RV Lab" }).click();
  await expect(page).toHaveURL(/\/exercises\/rv-lab$/);
  await expect(page.locator("main")).toContainText(/remote viewing|target/i);
});

test("no console errors, at laptop and phone sizes", async ({ open }) => {
  for (const [width, height] of [[1366, 768], [390, 844]]) {
    const page = await open("/", { viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.waitForLoadState("networkidle");
    expect(errors, `${width}px`).toEqual([]);
  }
});
