import { test, expect } from "./helpers.js";

// The home page: Benjamin Mithra, Life Coach & Carer for Seniors.
const NAV = ["Home", "Articles", "Mind Exercises", "Brain Games", "RV Lab", "Talk now"];
const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("the new identity and the sections in order", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await expect(page).toHaveTitle("Benjamin Mithra | Life Coach & Carer for Seniors");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Life Coach & Carer for Seniors");
  const home = page.getByTestId("home");
  await expect(home.getByText("Companionship · Personal Care · Personal Assistance")).toBeVisible();
  await expect(home.getByText("Care, Companionship & Meaningful Connections.")).toBeVisible();
  await expect(home.getByText("Online Support", { exact: true })).toBeVisible();
  await expect(home.getByText("In-Person Support", { exact: true })).toBeVisible();
  expect(await home.getByRole("heading", { level: 2 }).allTextContents()).toEqual([
    "A Personal Approach to Senior Care",
    "How I Can Help",
    "More Than Assistance. Meaningful Companionship.",
    "Explore the Mind",
    "Insights on Ageing, Care & Companionship",
    "Let's Talk About the Support You Need.",
  ]);
  expect(await home.locator(".hm-principle h3").allTextContents()).toEqual(["Compassion", "Dignity", "Mental Engagement", "Connection"]);
  await expect(home.locator("footer")).toContainText("Benjamin Mithra — Life Coach & Carer for Seniors");
  // Benjamin's own portrait; no placeholder photo in the hero.
  await expect(home.getByRole("img", { name: "Benjamin Mithra" })).toHaveAttribute("src", "/benjamin-mithra.jpg");
  await expect(home.getByText(/photograph of Benjamin/i)).toHaveCount(0);
  // The rotating question, the breathing circle and the Leetspeak passage are gone from the home page.
  await expect(home.getByText("Exhale")).toHaveCount(0);
  await expect(home.getByText(/Decoding numbers as letters/)).toHaveCount(0);
  await expect(home.getByText(/Th3 m1nd 1s n0t/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open Leetspeak Reading exercise" })).toHaveCount(0);
});

test("the services: online and in-person, kept apart", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const online = page.getByTestId("service-online");
  const offline = page.getByTestId("service-offline");
  expect(await online.locator("li").allTextContents()).toEqual(["Online Companionship", "Online Life Coaching", "Mind Exercises and Cognitive Activities", "Chess, Puzzles and Memory Activities", "Family Consultations"]);
  expect(await offline.locator("li").allTextContents()).toEqual(["Personal Care and Daily Assistance", "Personal Companionship", "Outings and Appointment Assistance", "Cognitive and Recreational Engagement", "Personal Assistance and Concierge Support", "Live-in Companionship and Care"]);
  await expect(online).not.toContainText("Personal Care");
  for (const card of [online, offline]) await expect(card.getByRole("link", { name: "Senior Care & Companionship" })).toHaveAttribute("href", "/#services");
  // No clinical titles, credentials, testimonials or prices.
  const text = await page.getByTestId("home").innerText();
  expect(text).not.toMatch(/\b(nurse|nursing|doctor|medical|clinical(?! caregiving)|certified|licensed|registered|testimonial|\$\d)/i);
  expect(text).toContain("non-clinical caregiving");
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

test("Explore Services and the Senior Care & Companionship buttons go to the services section", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await page.getByTestId("explore-services").click();
  await expect(page).toHaveURL(/\/#services$/);
  await expect(page.locator("#services")).toBeInViewport();
  // Senior Care & Companionship, About Benjamin, Contact and FAQ are no longer in the navigation.
  for (const gone of ["/#services", "/#about", "/consultation", "/faq"]) await expect(page.locator(`.top-tabs a[href="${gone}"]`)).toHaveCount(0);
  // The pages themselves still work.
  for (const path of ["/consultation", "/faq"]) {
    const p = await open(path, { viewport: { width: 1280, height: 900 } });
    await expect(p.locator("main")).not.toBeEmpty();
  }
});

test("Mind Exercises, Brain Games and RV Lab open the existing sections, unchanged", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const home = page.getByTestId("home");
  await home.getByRole("link", { name: /^Mind Exercises/ }).click();
  await expect(page).toHaveURL(/\/exercises$/);
  await expect(page.getByRole("link", { name: /Breathing/i }).first()).toBeVisible();
  await page.goBack();
  await home.getByRole("link", { name: /^Brain Games/ }).click();
  await expect(page).toHaveURL(/\/games$/);
  await expect(page.getByRole("link", { name: /Chess/i }).first()).toBeVisible();
  await page.goBack();
  await home.getByRole("link", { name: /^RV Lab/ }).click();
  await expect(page).toHaveURL(/\/exercises\/rv-lab$/);
  await expect(page.locator("main")).toContainText(/remote viewing|target/i);
  // The tab for RV Lab lights up there, not Mind Exercises.
  await page.getByRole("button", { name: "Menu" }).click();
  await expect(page.locator('a.nav-btn[href="/exercises/rv-lab"]')).toHaveCSS("background-color", "rgb(14, 90, 95)");
  await expect(page.locator('a.nav-btn[href="/exercises"]')).not.toHaveCSS("background-color", "rgb(14, 90, 95)");
});

test("the exercises the home page used to tease still work at their own addresses", async ({ open }) => {
  const page = await open("/exercises", { viewport: { width: 1280, height: 900 } });
  await page.getByRole("link", { name: /Leetspeak/i }).first().click();
  await expect(page).toHaveURL(/\/exercises\/leetspeak-reading$/);
  await page.goto("/exercises/breathing");
  await expect(page.locator("main")).toContainText(/breath/i);
});

test("Contact: only Get in touch and what follows", async ({ open }) => {
  const page = await open("/consultation", { viewport: { width: 1280, height: 900 } });
  await expect(page).toHaveTitle("Contact | Benjamin Mithra, Life Coach & Carer for Seniors");
  const main = page.locator("main");
  await expect(main.getByRole("heading", { level: 1 })).toHaveText("Get in touch");
  await expect(main.getByRole("link", { name: "Message on WhatsApp" })).toBeVisible();
  await expect(main.getByRole("link", { name: "Send an email" })).toBeVisible();
  await expect(main.getByText("Write to Me", { exact: true })).toBeVisible();
  for (const gone of ["Private Consultation", "I'm a Mind Interpreter.", "You talk. I listen. We explore.", "Your first hour is on me.", "How it works", "What this isn't", "Sometimes you simply need someone"]) {
    await expect(main.getByText(gone, { exact: false })).toHaveCount(0);
  }
});

test("articles: three real articles with Read More links; Contact Benjamin goes to Contact", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  const cards = page.locator(".hm-article");
  await expect(cards).toHaveCount(3);
  const hrefs = await cards.getByRole("link", { name: /^Read more/ }).evaluateAll((els) => els.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual(["/articles/who-am-i-now-that-im-retired", "/articles/mom-wont-let-me-help", "/articles/adult-child-stops-calling"]);
  await cards.first().getByRole("link", { name: /^Read more/ }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Who Am I Now That I'm Retired?");
  await page.goBack();
  await page.getByRole("link", { name: "Contact Benjamin" }).click();
  await expect(page).toHaveURL(/\/consultation$/);
});

test("Diego, the Christmas decorations and the Write to Me form are all still there", async ({ open }) => {
  const page = await open("/", { viewport: { width: 1280, height: 900 } });
  await page.locator(".gd-scene").waitFor();
  for (const id of ["xmas-lights", "xmas-ground", "snowman", "santa-cap", "christmas-tree"]) await expect(page.getByTestId(id)).toHaveCount(1);
  await expect(page.getByTestId("xmas-snow")).toHaveCount(1);
  // Diego's home tip still points to the form.
  await expect(page.locator("#write-to-me")).toHaveCount(1);
  await page.locator(".gd-home").click();
  await page.getByRole("link", { name: "Go to the form" }).click();
  await expect(page.locator("#write-to-me")).toBeInViewport();
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
