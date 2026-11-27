import { test, expect } from "./helpers.js";

// The Christmas theme: lights across the top, mild snow behind the
// content, and Diego's Santa cap, snowy roof, house lights and tree.
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("every page has the lights across the top and the snow behind the content", async ({ open }) => {
  for (const path of ["/", "/faq", "/articles", "/call", "/consultation"]) {
    const page = await open(path, { viewport: { width: 1280, height: 900 } });
    const lights = page.getByTestId("xmas-lights");
    await expect(lights, path).toBeVisible();
    expect((await lights.boundingBox()).y, path).toBeLessThanOrEqual(8); // the top of the page (inside the body's 8px margin)
    await expect(lights).toHaveAttribute("aria-hidden", "true");
    expect(await lights.locator("svg").count()).toBeGreaterThanOrEqual(27); // enough for any width up to 1296px
    const snow = page.getByTestId("xmas-snow");
    await expect(snow).toHaveAttribute("aria-hidden", "true");
    expect(await snow.locator(".xmas-flake").count()).toBe(34);
    // Behind the content (z-index 1, under main's 2) and never in the way of a tap.
    expect(await snow.evaluate((el) => [getComputedStyle(el).zIndex, getComputedStyle(el).pointerEvents])).toEqual(["1", "none"]);
    expect(await lights.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  }
});

test("the snow falls and the lights twinkle slowly; only transform and opacity animate", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const running = await page.evaluate(() => document.getAnimations().map((a) => a.animationName));
  expect(running).toContain("xmasFall");
  expect(running).toContain("xmasSway");
  expect(running).toContain("xmasTwinkle");
  const twinkle = await page.locator(".xmas-glow").first().evaluate((el) => getComputedStyle(el).animationDuration);
  expect(parseFloat(twinkle)).toBeGreaterThanOrEqual(2); // slow, never a fast flash
  const props = await page.evaluate(() => {
    const out = {};
    for (const sheet of document.styleSheets) {
      let rules = [];
      try { rules = [...sheet.cssRules]; } catch { continue; }
      for (const r of rules) if (r instanceof CSSKeyframesRule && r.name.startsWith("xmas")) out[r.name] = [...new Set([...r.cssRules].flatMap((k) => [...k.style]))];
    }
    return out;
  });
  expect(props).toEqual({ xmasTwinkle: ["opacity"], xmasFall: ["transform"], xmasSway: ["transform"] });
});

test("the lights don't cover the navigation: the tabs still work", async ({ open }) => {
  const page = await open("/", { viewport: { width: 390, height: 844 } });
  await page.locator(".top-tabs").getByRole("link", { name: "FAQ" }).click();
  await expect(page).toHaveURL(/\/faq$/);
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator('a.nav-btn[href="/call"]')).toBeVisible();
});

test("Diego wears a Santa cap, his roof has snow and lights, and a tree stands beside the house", async ({ open }) => {
  const page = await open("/faq", { viewport: { width: 1280, height: 900 } });
  await page.locator(".gd-scene").waitFor();
  await expect(page.getByTestId("santa-cap")).toHaveCount(1);
  await expect(page.getByTestId("diego-christmas")).toHaveCount(1);
  await expect(page.getByTestId("christmas-tree")).toHaveCount(1);
  // The cap moves with his head.
  expect(await page.getByTestId("santa-cap").evaluate((el) => el.parentElement.getAttribute("transform") !== null)).toBe(true);
  // The tree is beside the house (to its right), not on top of it, and inside the scene.
  const house = await page.locator(".gd-home").boundingBox();
  const tree = await page.getByTestId("christmas-tree").boundingBox();
  const scene = await page.locator(".gd-scene").boundingBox();
  expect(tree.x).toBeGreaterThan(house.x + house.width - 10);
  expect(tree.height).toBeLessThan(house.height);
  expect(tree.x + tree.width).toBeLessThanOrEqual(scene.x + scene.width);
  // Tapping the house still shows the tip.
  await page.locator(".gd-home").click();
  await expect(page.locator(".gd-bubble")).toBeVisible();
});

test("reduced motion: no falling snow and no twinkling, the lights stay on", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await expect(page.getByTestId("xmas-snow")).toBeHidden();
  await expect(page.getByTestId("xmas-lights")).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().filter((a) => String(a.animationName).startsWith("xmas")).length)).toBe(0);
});

test("no sideways scroll at 390px or 1280px", async ({ open }) => {
  for (const width of [390, 1280]) for (const path of ["/", "/faq", "/call"]) {
    const page = await open(path, { viewport: { width, height: 844 } });
    await page.waitForTimeout(300);
    expect(await noSidewaysScroll(page), `${path} at ${width}px`).toBe(true);
  }
});
