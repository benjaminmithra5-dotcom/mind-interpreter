import { test, expect } from "./helpers.js";

// The glowing pulse and the short wiggle on the "Talk now" tab, and the dot on the ☰ button.
const after = (locator) => locator.evaluate((el) => {
  const s = getComputedStyle(el, "::after");
  return { name: s.animationName, duration: s.animationDuration, count: s.animationIterationCount, state: s.animationPlayState, boxShadow: s.boxShadow };
});
const talkTab = (page) => page.locator(".top-tabs").getByRole("link", { name: "Talk now" });
const shake = (locator) => locator.locator(".talk-shake").evaluate((el) => {
  const s = getComputedStyle(el);
  return { name: s.animationName, duration: s.animationDuration, count: s.animationIterationCount, state: s.animationPlayState, transform: s.transform };
});
// Every property and value in a @keyframes rule.
const keyframes = (page, name) => page.evaluate((n) => {
  for (const sheet of document.styleSheets) {
    let rules = [];
    try { rules = [...sheet.cssRules]; } catch { continue; } // a font stylesheet from another site
    for (const rule of rules) if (rule instanceof CSSKeyframesRule && rule.name === n) return [...rule.cssRules].map((k) => ({ at: k.keyText, props: Object.fromEntries([...k.style].map((p) => [p, k.style.getPropertyValue(p)])) }));
  }
  return null;
}, name);
// WCAG contrast of two "rgb(r, g, b)" colours.
function contrast(a, b) {
  const lum = (rgb) => { const [r, g, bl] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
const CREAM = [246, 240, 228];
const AQUA = [30, 207, 192];
const box = (locator) => locator.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height].map((n) => Math.round(n * 100) / 100); });
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("desktop: the Talk now tab glows every 2 seconds and wiggles every 3.5 seconds, forever; other tabs don't", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const tab = talkTab(page);
  await expect(tab).toBeVisible();
  expect(await after(tab)).toMatchObject({ name: "talkPulse", duration: "2s", count: "infinite", state: "running" });
  expect(await shake(tab)).toMatchObject({ name: "talkShake", duration: "3.5s", count: "infinite", state: "running" });
  const faq = page.locator(".top-tabs").getByRole("link", { name: "FAQ" });
  expect(await after(faq)).toMatchObject({ name: "none" });
  expect(await faq.locator(".talk-shake").count()).toBe(0);

  // The glow: only box-shadow and opacity, a deep teal ring under a bright aqua glow
  // at 75% at its peak, reaching 12px (spread) beyond the tab.
  const pulse = await keyframes(page, "talkPulse");
  for (const k of pulse) for (const p of Object.keys(k.props)) expect(["box-shadow", "opacity"]).toContain(p);
  const peak = pulse.find((k) => k.at === "25%").props["box-shadow"];
  expect(peak).toContain("rgba(14, 90, 95, 0.45)");
  expect(peak).toContain("rgba(30, 207, 192, 0.75)");
  expect(pulse.find((k) => k.at === "70%").props["box-shadow"]).toMatch(/rgba\(30, 207, 192, 0\) 0px 0px 10px 12px/);

  // The wiggle: transform: translateX only, ±2px, 4 times in the first 0.5s (8 a second), then still.
  const wiggle = await keyframes(page, "talkShake");
  const moves = [];
  for (const k of wiggle) {
    expect(Object.keys(k.props)).toEqual(["transform"]);
    expect(k.props.transform).toMatch(/^translateX\((-?2px|0px|0)\)$/);
    for (const at of k.at.split(",").map((x) => parseFloat(x))) moves.push([at, k.props.transform]);
  }
  moves.sort((a, b) => a[0] - b[0]);
  const shaking = moves.filter(([, t]) => t !== "translateX(0px)" && t !== "translateX(0)");
  expect(shaking.length).toBe(7);
  expect(Math.max(...shaking.map(([at]) => at)) * 3.5 / 100).toBeLessThanOrEqual(0.5);

  // The tab itself never moves, fades or changes colour.
  expect(await tab.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
  expect(await tab.evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
});

test("the glow and the wiggle never move or resize the tab, the nav, or where you tap", async ({ open }) => {
  for (const width of [1280, 390]) {
    const page = await open("/", { viewport: { width, height: 900 } });
    const tab = talkTab(page);
    const label = tab.locator(".talk-shake");
    const bar = page.locator(".top-tabs");
    // Sample through a whole wiggle (every 40ms for 0.6s), then across the 3.5s cycle.
    await page.evaluate(() => document.getAnimations().filter((a) => a.animationName === "talkShake").forEach((a) => { a.currentTime = 0; }));
    const samples = [];
    const offsets = new Set();
    for (let i = 0; i < 15; i++) {
      samples.push([await box(tab), await box(bar)]);
      offsets.add(await label.evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).m41));
      // The middle of the tab is the tab (or its label), so taps land.
      expect(await tab.evaluate((el) => { const r = el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); })).toBe(true);
      await page.waitForTimeout(40);
    }
    for (let i = 0; i < 4; i++) { samples.push([await box(tab), await box(bar)]); await page.waitForTimeout(700); }
    for (const s of samples) expect(s, `${width}px, during the animation`).toEqual(samples[0]);
    // The label moved, but only sideways and never more than 2px.
    expect([...offsets].some((x) => x !== 0)).toBe(true);
    for (const x of offsets) expect(Math.abs(x)).toBeLessThanOrEqual(2);

    await page.addStyleTag({ content: ".talk-pulse, .talk-pulse::after, .talk-shake { animation: none !important; }" });
    expect([await box(tab), await box(bar)], `${width}px, without the animation`).toEqual(samples[0]);
    expect(await noSidewaysScroll(page)).toBe(true);
  }
  // And the same with reduced motion.
  const still = await open("/", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const moving = await open("/", { viewport: { width: 1280, height: 900 } });
  expect(await box(talkTab(still))).toEqual(await box(talkTab(moving)));
});

test("reduced motion: no glow pulse and no wiggle, just a steady teal outline and a soft tint, with AA contrast", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  const tab = talkTab(page);
  const s = await after(tab);
  expect(s.name).toBe("none");
  expect(s.boxShadow).toBe("rgba(14, 90, 95, 0.45) 0px 0px 0px 3px");
  expect(await shake(tab)).toMatchObject({ name: "none", transform: "none" });
  expect(await page.evaluate(() => document.getAnimations().filter((a) => ["talkPulse", "talkShake"].includes(a.animationName)).length)).toBe(0);

  // The tint sits behind the text: text on cream with 14% aqua stays well above AA (4.5:1).
  const tint = await tab.evaluate((el) => getComputedStyle(el, "::after").backgroundColor);
  expect(tint).toBe("rgba(30, 207, 192, 0.14)");
  const bg = CREAM.map((v, i) => Math.round(v * 0.86 + AQUA[i] * 0.14));
  const text = (await tab.evaluate((el) => getComputedStyle(el).color)).match(/\d+/g).slice(0, 3).map(Number);
  expect(contrast(text, bg)).toBeGreaterThan(4.5);

  const sub = await open("/faq", { viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  await expect(sub.getByTestId("menu-dot")).toBeVisible();
  expect((await after(sub.getByTestId("menu-dot"))).name).toBe("none");
  await sub.getByRole("button", { name: "Menu" }).click();
  const item = sub.locator('a.nav-btn[href="/call"]');
  expect((await after(item)).name).toBe("none");
  expect((await shake(item)).name).toBe("none");
});

test("the text keeps AA contrast with the glow at its brightest", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const tab = talkTab(page);
  // The glow is outside the tab (box-shadow), so the text sits on the plain cream.
  const text = (await tab.evaluate((el) => getComputedStyle(el).color)).match(/\d+/g).slice(0, 3).map(Number);
  expect(contrast(text, CREAM)).toBeGreaterThan(4.5);
  // The brightest aqua glow, even behind it, would still leave AA contrast.
  expect(contrast(text, CREAM.map((v, i) => Math.round(v * 0.25 + AQUA[i] * 0.75)))).toBeGreaterThan(4.5);
});

test("mobile menu: the ☰ button has a glowing dot that goes away while the menu is open; the item glows and wiggles inside", async ({ open }) => {
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
  expect(await shake(item)).toMatchObject({ name: "talkShake", duration: "3.5s", count: "infinite" });
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
  expect((await shake(tab)).state).toBe("paused");
  await setHidden(false);
  expect((await after(tab)).state).toBe("running");
  expect((await shake(tab)).state).toBe("running");
});
