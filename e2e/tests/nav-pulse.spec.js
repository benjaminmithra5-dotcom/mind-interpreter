import { test, expect } from "./helpers.js";

// The soft pulse on the "Talk now" tab and the dot on the ☰ button.
const after = (locator) => locator.evaluate((el) => {
  const s = getComputedStyle(el, "::after");
  return { name: s.animationName, duration: s.animationDuration, count: s.animationIterationCount, state: s.animationPlayState, boxShadow: s.boxShadow };
});
const talkTab = (page) => page.locator(".top-tabs").getByRole("link", { name: "Talk now" });
const box = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100); });
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("desktop: the Talk now tab pulses every 2 seconds, forever; other tabs don't", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const tab = talkTab(page);
  await expect(tab).toBeVisible();
  expect(await after(tab)).toMatchObject({ name: "talkPulse", duration: "2s", count: "infinite", state: "running" });
  expect(await after(page.locator(".top-tabs").getByRole("link", { name: "FAQ" }))).toMatchObject({ name: "none" });
  // The keyframes only change box-shadow and opacity.
  const props = await page.evaluate(() => {
    for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
      if (rule instanceof CSSKeyframesRule && rule.name === "talkPulse") return [...rule.cssRules].flatMap((k) => [...k.style]);
    }
    return null;
  });
  expect(props).not.toBeNull();
  for (const p of props) expect(["box-shadow", "opacity"]).toContain(p);
  // The text itself is never animated or dimmed.
  expect(await tab.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await tab.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("the pulse never moves or resizes the tab or the nav", async ({ open }) => {
  for (const width of [1280, 390]) {
    const page = await open("/", { viewport: { width, height: 900 } });
    const tab = talkTab(page);
    const bar = page.locator(".top-tabs");
    const samples = [];
    for (let i = 0; i < 6; i++) { samples.push([await box(tab), await box(bar)]); await page.waitForTimeout(350); }
    for (const s of samples) expect(s, `${width}px, during the pulse`).toEqual(samples[0]);
    await page.addStyleTag({ content: ".talk-pulse, .talk-pulse::after { animation: none !important; }" });
    expect([await box(tab), await box(bar)], `${width}px, without the pulse`).toEqual(samples[0]);
    expect(await noSidewaysScroll(page)).toBe(true);
  }
  // And the same with reduced motion.
  const still = await open("/", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const moving = await open("/", { viewport: { width: 1280, height: 900 } });
  expect(await box(talkTab(still))).toEqual(await box(talkTab(moving)));
});

test("reduced motion: a steady teal ring instead of the pulse, and no animation", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const s = await after(talkTab(page));
  expect(s.name).toBe("none");
  expect(s.boxShadow).toBe("rgba(14, 90, 95, 0.45) 0px 0px 0px 3px");
  expect(await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === "talkPulse").length)).toBe(0);

  const sub = await open("/faq", { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await expect(sub.getByTestId("menu-dot")).toBeVisible();
  expect((await after(sub.getByTestId("menu-dot"))).name).toBe("none");
});

test("mobile menu: the ☰ button has a pulsing dot that goes away while the menu is open; the item pulses inside", async ({ open }) => {
  const page = await open("/faq", { viewport: { width: 390, height: 844 } });
  const menu = page.getByRole("button", { name: "Menu" });
  const dot = page.getByTestId("menu-dot");
  await expect(dot).toBeVisible();
  expect(await after(dot)).toMatchObject({ name: "talkPulse", duration: "2s", count: "infinite" });
  expect(await dot.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe("rgb(14, 90, 95)");
  const before = await box(menu);
  expect(await noSidewaysScroll(page)).toBe(true);

  await menu.click();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  await expect(dot).toHaveCount(0);
  expect(await box(menu)).toEqual(before);
  const item = page.locator('a.nav-btn[href="/call"]');
  await expect(item).toBeVisible();
  expect(await after(item)).toMatchObject({ name: "talkPulse", count: "infinite" });
  expect(await after(page.locator('a.nav-btn[href="/articles"]'))).toMatchObject({ name: "none" });
  expect(await noSidewaysScroll(page)).toBe(true);

  // Tapping outside closes the menu; the dot comes back.
  await page.mouse.click(195, 700);
  await expect(menu).toHaveAttribute("aria-expanded", "false");
  await expect(dot).toBeVisible();
});

test("on /call the Talk now item keeps its active style and still pulses", async ({ open }) => {
  const page = await open("/call", { viewport: { width: 1280, height: 900 } });
  await expect(page.getByTestId("menu-dot")).toBeVisible();
  await page.getByRole("button", { name: "Menu" }).click();
  const item = page.locator('a.nav-btn[href="/call"]');
  expect(await item.evaluate((el) => [getComputedStyle(el).backgroundColor, getComputedStyle(el).color])).toEqual(["rgb(14, 90, 95)", "rgb(255, 255, 255)"]);
  expect((await after(item)).name).toBe("talkPulse");
});

test("the pulse pauses while the browser tab is hidden", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const tab = talkTab(page);
  const setHidden = (hidden) => page.evaluate((h) => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
  await setHidden(true);
  expect((await after(tab)).state).toBe("paused");
  await setHidden(false);
  expect((await after(tab)).state).toBe("running");
});
