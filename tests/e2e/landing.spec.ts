import { expect, test } from "@playwright/test";
import { installFailureGuards, uploadCas, uploadInput, waitForHydration } from "./helpers/app";
import { makeCasPdf, mockDailyHistory, mockLatestNav } from "./helpers/cas-fixture";

test.describe("landing and local upload boundary", () => {
  test("renders the complete privacy-first initial state", async ({ page }) => {
    const assertNoErrors = await installFailureGuards(page);
    await page.goto("/");
    await waitForHydration(page);

    await expect(page).toHaveTitle("FolioVista — Mutual Fund CAS Dashboard");
    await expect(page.getByLabel("FolioVista home").first()).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: /Your mutual funds, finally in focus/i })).toBeVisible();
    await expect(page.getByText("Private by design")).toBeVisible();
    await expect(page.getByText("Statement totals reconciled")).toBeVisible();
    await expect(page.getByText("CAMS + KFintech")).toBeVisible();
    await expect(page.getByText("Nothing uploaded")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Choose statement" })).toBeEnabled();
    await expect(page.getByRole("button", { name: /explore with demo data/i })).toBeEnabled();
    await expect(page.getByText("Your PDF never leaves this device. No account. No storage.")).toBeVisible();
    await expect(uploadInput(page)).toHaveAttribute("accept", "application/pdf,.pdf");
    await expect(page.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Dashboard preview" })).toBeVisible();
    assertNoErrors();
  });

  test("navigation anchors and analyse action remain functional", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-chromium", "The compact mobile header intentionally hides desktop navigation.");
    await page.goto("/");
    await waitForHydration(page);

    await page.getByRole("link", { name: "How it works" }).click();
    await expect(page).toHaveURL(/#how-it-works$/);
    await expect(page.getByRole("heading", { name: "Three steps. Zero data trails." })).toBeInViewport();

    await page.getByRole("link", { name: "Privacy" }).click();
    await expect(page).toHaveURL(/#privacy$/);
    await expect(page.getByRole("heading", { name: /Your money is personal/i })).toBeInViewport();

    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Analyse statement" }).click();
    await (await chooser).setFiles([]);
  });

  test("rejects a non-PDF before attempting a network update", async ({ page }) => {
    let navRequests = 0;
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/nav") navRequests += 1;
    });
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "portfolio.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("not,a,pdf"),
    });

    await expect(page.getByRole("alert")).toContainText("Please choose a PDF Consolidated Account Statement.");
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
    expect(navRequests).toBe(0);
  });

  test("rejects a statement larger than the documented 30 MB limit", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "oversize.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.alloc(30 * 1024 * 1024 + 1),
    });

    await expect(page.getByRole("alert")).toContainText("This PDF is larger than 30 MB");
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
  });

  test("surfaces unreadable and non-CAS PDFs without leaving the landing page", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    await uploadInput(page).setInputFiles({
      name: "broken.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nthis is intentionally malformed\n%%EOF"),
    });

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("alert")).not.toBeEmpty();
    await expect(page.getByRole("heading", { name: "Drop your CAS here" })).toBeVisible();
  });

  test("shows parsing progress and retains it while latest NAV is pending", async ({ page }) => {
    await mockLatestNav(page, { delayMs: 800 });
    await mockDailyHistory(page);
    await page.goto("/");

    await uploadCas(page, makeCasPdf({ pages: 8 }));
    const processing = page.locator(".processing-panel");
    await expect(processing.getByRole("heading", { name: "Reconciling your portfolio" })).toBeVisible();
    await expect(processing).toContainText(/\d+% complete/);
    await expect(processing.locator(".progress-row > span")).toHaveAttribute("style", /width:\s*\d+%/);
    await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
  });

  test("drag-and-drop follows the same local validation path", async ({ page }) => {
    await page.goto("/");
    await waitForHydration(page);
    const uploadCard = page.locator(".upload-card");
    await uploadCard.evaluate((target) => {
      const transfer = new DataTransfer();
      target.dispatchEvent(new DragEvent("dragenter", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(uploadCard).toHaveClass(/dragging/);
    await uploadCard.dispatchEvent("dragleave");
    await expect(uploadCard).not.toHaveClass(/dragging/);

    await uploadCard.evaluate((target) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["not a PDF"], "statement.txt", { type: "text/plain" }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    await expect(page.getByRole("alert")).toContainText("Please choose a PDF");
  });
});
