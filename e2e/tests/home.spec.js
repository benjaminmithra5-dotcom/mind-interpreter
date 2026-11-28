import { test, expect } from "./helpers.js";

// The home page: Benjamin Mithra, Life Coach, with a holiday
// message, Talk now, Mind Exercises and Brain Games, the Write to Me form
// and the footer.
const NAV = ["Home", "Articles", "Mind Exercises", "Brain Games", "RV Lab", "Talk now"];
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the heading, the holiday message, and nothing else from before", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await expect(page).toHaveTitle("Benjamin Mithra | Life Coach");
  const home = page.getByTestId("home");
  await expect(home.getByRole("heading", { level: 1 })).toHaveText("Benjamin Mithra");
  await expect(home.getByText("Life Coach", { exact: true })).toBeVisible();
  await expect(home.getByText(/Seniors/)).toHaveCount(0);
  expect(await home.getByRole("heading", { level: 2 }).allTextContents()).toEqual(["Feeling lonely this Holiday Season?"]);
  for (const line of [
    "You don't have to spend the holidays feeling alone. If you'd like someone to talk to, share a story with, or simply spend a little time having a friendly conversation, I'm here for you.",
    "It's absolutely free. No charges, no catch, no obligations. Just a genuine conversation.",
    "The holiday season is a time for warmth, kindness and connection. You deserve to feel heard, valued and remembered.",
    "Let's share a conversation, a smile and a little happiness. Sometimes, a friendly voice can make all the difference.",
    "You're welcome here. ♥",
  ]) await expect(home.getByText(line, { exact: true })).toBeVisible();
  // The earlier sections are gone.
  for (const gone of ["How I Can Help", "A Personal Approach to Senior Care", "More Than Assistance", "Explore the Mind", "Let's Talk About the Support You Need", "Explore Services", "Online Support"]) {
    await expect(home.getByText(gone)).toHaveCount(0);
  }
  // No articles on the home page.
  await expect(home.locator(".hm-article")).toHaveCount(0);
  await expect(home.getByText("Insights on Ageing, Care & Companionship")).toHaveCount(0);
  await expect(home.getByRole("link", { name: /Read more/i })).toHaveCount(0);
});

test("Talk now, then Mind Exercises next to Brain Games, below the message", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const talk = page.getByTestId("home-talk-now");
  const ex = page.getByTestId("home-mind-exercises");
  const games = page.getByTestId("home-brain-games");
  const msg = await page.getByText("You're welcome here. ♥").boundingBox();
  const [t, e, g] = [await talk.boundingBox(), await ex.boundingBox(), await games.boundingBox()];
  expect(t.y).toBeGreaterThan(msg.y);
  expect(e.y).toBeGreaterThan(t.y + t.height - 1);
  expect(Math.abs(e.y - g.y)).toBeLessThan(2); // side by side
  expect(g.x).toBeGreaterThan(e.x + e.width - 1);
  await talk.click();
  await expect(page).toHaveURL(/\/call$/);
  await page.goBack();
  await ex.click();
  await expect(page).toHaveURL(/\/exercises$/);
  await page.goBack();
  await games.click();
  await expect(page).toHaveURL(/\/games$/);
});

test("the footer: copyright, Privacy Policy, Disclaimer and Terms and Conditions, at the end", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const footer = page.getByTestId("home").locator("footer");
  await expect(footer).toContainText(`© ${new Date().getFullYear()} Benjamin Mithra`);
  expect(await footer.getByRole("link").evaluateAll((els) => els.map((a) => [a.textContent, a.getAttribute("href")]))).toEqual([
    ["Privacy Policy", "/privacy"], ["Disclaimer", "/disclaimer"], ["Terms and Conditions", "/terms"],
  ]);
  // Below the Write to Me form: the last thing on the page.
  const form = await page.locator("#write-to-me").boundingBox();
  const f = await footer.boundingBox();
  expect(f.y).toBeGreaterThan(form.y + form.height - 1);
  for (const [name, path, heading] of [["Privacy Policy", "/privacy", /privacy/i], ["Disclaimer", "/disclaimer", /disclaimer/i], ["Terms and Conditions", "/terms", /terms/i]]) {
    await footer.getByRole("link", { name }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page.locator("main")).toContainText(heading);
    await page.goBack();
  }
});

test("the Write to Me form stays, and Diego's tip still leads to it", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await page.locator(".gd-scene").waitFor();
  await expect(page.locator("#write-to-me")).toHaveCount(1);
  await page.locator(".gd-home").click();
  await page.getByRole("link", { name: "Go to the form" }).click();
  await expect(page.locator("#write-to-me")).toBeInViewport();
});

test("navigation: Home, Articles, Mind Exercises, Brain Games, RV Lab and Talk now, on the tabs and in the menu", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  expect((await page.locator(".top-tabs a").allInnerTexts()).map((t) => t.trim().toLowerCase())).toEqual(NAV.map((t) => t.toLowerCase()));
  const sub = await open("/faq", { viewport: { width: 1280, height: 900 } });
  await sub.getByRole("button", { name: "Menu" }).click();
  const items = (await sub.locator('[style*="position: absolute"] a.nav-btn').allInnerTexts()).map((t) => t.trim().toLowerCase());
  expect(items.slice(0, NAV.length)).toEqual(NAV.map((t) => t.toLowerCase()));
  expect(items.slice(NAV.length)).toEqual(["privacy", "terms", "disclaimer"]);
});

test("Mind Exercises, Brain Games and RV Lab still open as before", async ({ open }) => {
  const page = await open("/exercises", { viewport: { width: 1280, height: 900 } });
  await expect(page.getByRole("link", { name: /Breathing/i }).first()).toBeVisible();
  await page.goto("/games");
  await expect(page.getByRole("link", { name: /Chess/i }).first()).toBeVisible();
  await page.goto("/exercises/rv-lab");
  await expect(page.locator("main")).toContainText(/remote viewing|target/i);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator('a.nav-btn[href="/exercises/rv-lab"]')).toHaveCSS("background-color", "rgb(46, 29, 18)");
});

test("Contact: only Get in touch and what follows", async ({ open }) => {
  const page = await open("/consultation", { viewport: { width: 1280, height: 900 } });
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Get in touch");
  await expect(main.getByRole("link", { name: "Message on WhatsApp" })).toBeVisible();
  await expect(main.getByText("Write to Me", { exact: true })).toBeVisible();
});

test("the poster: Victorian type, ink on parchment, a double-line border", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const poster = page.getByTestId("poster");
  expect(await poster.evaluate((el) => getComputedStyle(el).borderTopStyle)).toBe("double");
  expect(await page.locator("#hm-title").evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Ultra");
  expect(await page.locator("#hm-title").evaluate((el) => getComputedStyle(el).filter)).toContain("lp-ink");
  expect(await page.locator(".lp-text").first().evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Old Standard TT");
  expect(await page.locator("#hm-title").evaluate((el) => getComputedStyle(el).color)).toBe("rgb(36, 23, 15)");
  // Every page sits inside the double-line border.
  for (const path of ["/", "/games", "/exercises", "/articles"]) {
    const p = await open(path, { viewport: { width: 1280, height: 900 } });
    expect(await p.locator(".lp-frame").evaluate((el) => getComputedStyle(el).borderTopStyle), path).toBe("double");
  }
});

test("responsive, with no sideways scroll and no console errors", async ({ open }) => {
  for (const [width, height] of [[1280, 900], [768, 1024], [390, 844]]) {
    const page = await open("/", { viewport: { width, height } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
    await page.waitForLoadState("networkidle");
    expect(await noSidewaysScroll(page), `${width}px`).toBe(true);
    expect(errors, `${width}px`).toEqual([]);
  }
});
