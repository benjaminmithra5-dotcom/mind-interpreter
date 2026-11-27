import { test, expect } from "./helpers.js";

// The home page: Benjamin Mithra, Life Coach for Seniors, with a holiday
// message, Talk now, Mind Exercises and Brain Games, the articles and the
// Write to Me form.
const NAV = ["Home", "Articles", "Mind Exercises", "Brain Games", "RV Lab", "Talk now"];
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the heading, the holiday message, and nothing else from before", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await expect(page).toHaveTitle("Benjamin Mithra | Life Coach for Seniors");
  const home = page.getByTestId("home");
  await expect(home.getByRole("heading", { level: 1 })).toHaveText("Benjamin Mithra");
  await expect(home.getByText("Life Coach for Seniors", { exact: true })).toBeVisible();
  expect(await home.getByRole("heading", { level: 2 }).allTextContents()).toEqual([
    "Feeling lonely this Holiday Season?",
    "Insights on Ageing, Care & Companionship",
  ]);
  for (const line of [
    "You don't have to spend the holidays feeling alone. If you'd like someone to talk to, share a story with, or simply spend a little time having a friendly conversation, I'm here for you.",
    "It's absolutely free. No charges, no catch, no obligations. Just a genuine conversation.",
    "The holiday season is a time for warmth, kindness and connection. You deserve to feel heard, valued and remembered.",
    "Let's share a conversation, a smile and a little happiness. Sometimes, a friendly voice can make all the difference.",
    "You're welcome here. ❤️",
  ]) await expect(home.getByText(line, { exact: true })).toBeVisible();
  // The earlier sections are gone.
  for (const gone of ["How I Can Help", "A Personal Approach to Senior Care", "More Than Assistance", "Explore the Mind", "Let's Talk About the Support You Need", "Explore Services", "Online Support"]) {
    await expect(home.getByText(gone)).toHaveCount(0);
  }
  await expect(home.locator("footer")).toHaveCount(0);
});

test("Talk now, then Mind Exercises next to Brain Games, below the message", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const talk = page.getByTestId("home-talk-now");
  const ex = page.getByTestId("home-mind-exercises");
  const games = page.getByTestId("home-brain-games");
  const msg = await page.getByText("You're welcome here. ❤️").boundingBox();
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

test("the articles: three real articles with Read More links", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const cards = page.locator(".hm-article");
  await expect(cards).toHaveCount(3);
  const hrefs = await cards.getByRole("link", { name: /^Read more/ }).evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(["/articles/who-am-i-now-that-im-retired", "/articles/mom-wont-let-me-help", "/articles/adult-child-stops-calling"]);
  await cards.first().getByRole("link", { name: /^Read more/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Who Am I Now That I'm Retired?");
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
  await expect(page.locator('a.nav-btn[href="/exercises/rv-lab"]')).toHaveCSS("background-color", "rgb(14, 90, 95)");
});

test("Contact: only Get in touch and what follows", async ({ open }) => {
  const page = await open("/consultation", { viewport: { width: 1280, height: 900 } });
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Get in touch");
  await expect(main.getByRole("link", { name: "Message on WhatsApp" })).toBeVisible();
  await expect(main.getByText("Write to Me", { exact: true })).toBeVisible();
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
