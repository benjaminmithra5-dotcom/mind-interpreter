import { test, expect, openAdmin, createCode, waitForAway } from "./helpers.js";

test("status: Away without the admin page, Available, Away by choice, and back", async ({ open, api }) => {
  await waitForAway(api);
  const visitor = await open("/call");
  const badge = visitor.getByTestId("status-badge");
  await expect(badge).toHaveAttribute("data-status", "away");
  await expect(badge).toHaveText("Away");
  await expect(visitor.getByTestId("request-form")).toBeVisible();
  await expect(visitor.getByTestId("call-button")).toHaveCount(0);

  const admin = await openAdmin(open);
  await expect(badge).toHaveAttribute("data-status", "available");
  await expect(visitor.getByTestId("call-panel")).toBeVisible();

  await admin.getByTestId("set-away").click();
  await expect(badge).toHaveAttribute("data-status", "away");
  await admin.getByTestId("set-available").click();
  await expect(badge).toHaveAttribute("data-status", "available");

  // Closing the admin page: Away again after a short grace.
  await admin.close();
  await expect(badge).toHaveAttribute("data-status", "away", { timeout: 20_000 });
});

test("request a time while Benjamin is away; it shows on the admin page", async ({ open, api }) => {
  await waitForAway(api);
  const { code } = await createCode(api, { note: "Request tester" });
  const visitor = await open("/call");
  const form = visitor.getByTestId("request-form");
  await form.getByLabel("Name (optional)").fill("Sam");
  await form.getByLabel("Code").fill(code);
  await form.getByLabel("Preferred day and time").fill("2030-05-04T18:30");
  await form.getByLabel("Your timezone").fill("Asia/Kolkata");
  await form.getByRole("button", { name: "Request a time" }).click();
  await expect(visitor.getByTestId("request-done")).toBeVisible();

  const admin = await openAdmin(open);
  const requests = admin.getByTestId("requests");
  await expect(requests).toContainText("Sam");
  await expect(requests).toContainText("2030-05-04 18:30 (Asia/Kolkata)");
  await expect(requests).toContainText("Request tester");
});

test("a request needs a valid code", async ({ open, api }) => {
  await waitForAway(api);
  const visitor = await open("/call");
  const form = visitor.getByTestId("request-form");
  await form.getByLabel("Code").fill("ABCDEFGHJK");
  await form.getByLabel("Preferred day and time").fill("2030-05-04T18:30");
  await form.getByRole("button", { name: "Request a time" }).click();
  await expect(form.getByRole("alert")).toBeVisible();
  await expect(visitor.getByTestId("request-done")).toHaveCount(0);
});
