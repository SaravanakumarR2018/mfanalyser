import { test, expect } from "@playwright/test";
import { mockDailyHistory, mockLatestNav } from "./helpers/cas-fixture";
import { uploadCas, expectNoHorizontalOverflow } from "./helpers/app";

test("saved account uploads, restores on reload and login, and keeps guest uploads local", async ({ page }) => {
  test.setTimeout(120_000);
  await mockLatestNav(page); await mockDailyHistory(page);
  const username = `test_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
  const password = "Synthetic-passphrase-123";
  await page.goto("/");
  await page.getByRole("button", { name: "Analyse with login" }).click();
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByText(`Saved analysis · ${username}`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Saved statements", exact: true })).toBeEnabled();
  await uploadCas(page);
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Statement uploaded and saved" })).toBeVisible();
  await expectNoHorizontalOverflow(page);
  const library = await (await page.request.get("/api/vault/statements")).json();
  expect(library.statements).toHaveLength(1);
  const id = library.statements[0].id;
  const download = await page.request.get(`/api/vault/statements/${id}/pdf`);
  expect(download.status()).toBe(200);
  expect((await download.body()).subarray(0, 5).toString()).toBe("%PDF-");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Import another CAS" }).click();
  await uploadCas(page);
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Saved statements", exact: true }).click();
  const saved = page.getByRole("region", { name: "Saved statements", exact: true });
  await expect(saved.getByRole("button", { name: "Open analysis" })).toHaveCount(2);
  await saved.getByRole("button", { name: "Open analysis" }).last().click();
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
  expect((await page.request.get(`/api/vault/statements/${id}/pdf`)).status()).toBe(401);
  await page.getByRole("button", { name: "Analyse with login" }).click();
  // The form retains its create/sign-in choice, but never its account password.
  if (await page.getByRole("button", { name: "Already have an account? Sign in" }).isVisible()) await page.getByRole("button", { name: "Already have an account? Sign in" }).click();
  await page.getByLabel("Username", { exact: true }).fill(username);
  await page.getByLabel("Account password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Analyse without login" }).click();
  let writes = 0;
  page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/vault/statements")) writes++; });
  await uploadCas(page);
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  expect(writes).toBe(0);
  await page.getByRole("button", { name: "Saved statements", exact: true }).click();
  await expect(saved.getByRole("button", { name: "Open analysis" })).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await saved.getByRole("button", { name: "Delete", exact: true }).first().click();
    await saved.getByRole("button", { name: "Confirm delete", exact: true }).click();
    await expect(saved.getByRole("button", { name: "Delete", exact: true })).toHaveCount(1 - i);
  }
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
});

test("a failed save keeps analysis available and can be retried", async ({ page }) => {
  await mockLatestNav(page); await mockDailyHistory(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Analyse with login" }).click();
  await page.getByRole("button", { name: "New here? Create an account" }).click();
  await page.getByLabel("Username", { exact: true }).fill(`retry_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`);
  await page.getByLabel("Account password", { exact: true }).fill("Synthetic-passphrase-123");
  await page.getByRole("button", { name: "Create account", exact: true }).click();
  await expect(page.getByRole("button", { name: "Saved statements", exact: true })).toBeEnabled();
  let fail = true;
  await page.route("**/api/vault/statements", async route => {
    if (route.request().method() === "POST" && fail) {
      fail = false;
      await route.fulfill({ status: 503, json: { error: "Temporary storage failure." } });
    } else await route.continue();
  });
  await uploadCas(page);
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("Not saved:");
  await page.getByRole("button", { name: "Retry save", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Statement uploaded and saved" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your funds", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Saved statements", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete", exact: true }).click();
  await expect(page.getByText("No statements saved yet.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
});
