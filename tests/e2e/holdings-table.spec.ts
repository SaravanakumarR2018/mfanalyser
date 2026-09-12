import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo } from "./helpers/app";

for (const width of [320, 390, 768, 1440]) {
  test(`comparison headings and fund names remain pinned at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDemo(page);
    const region = page.getByRole("region", { name: "Scrollable fund comparison" });
    const header = region.locator(".table-header");
    await region.scrollIntoViewIfNeeded();
    await expect(page.locator(".holdings-scroll-tools")).toContainText("6 funds");
    const before = await header.boundingBox();
    await region.evaluate((element) => { element.scrollTop = 180; });
    expect(await region.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
    expect((await header.boundingBox())!.y).toBeCloseTo(before!.y, 0);

    await region.evaluate((element) => { element.scrollLeft = 440; });
    const regionBox = (await region.boundingBox())!;
    const fourthFund = region.locator(".fund-group > .fund-row").nth(3);
    const fundName = fourthFund.locator(".fund-name");
    expect((await fundName.boundingBox())!.x).toBeCloseTo(regionBox.x, 0);
    expect((await header.locator("span").first().boundingBox())!.x).toBeCloseTo(regionBox.x, 0);
    const rowCells = fourthFund.locator(":scope > [data-label]");
    const headings = header.locator(":scope > span");
    for (let index = 0; index < 7; index++) {
      const cellBox = (await rowCells.nth(index).boundingBox())!;
      const headingBox = (await headings.nth(index + 1).boundingBox())!;
      expect(cellBox.x).toBeCloseTo(headingBox.x, 0);
      expect(cellBox.width).toBeCloseTo(headingBox.width, 0);
    }
    await expectNoHorizontalOverflow(page);
  });
}

test("column navigation, sorting, search and folio details work in the phone table", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  const region = page.getByRole("region", { name: "Scrollable fund comparison" });
  await region.scrollIntoViewIfNeeded();
  const next = page.getByRole("button", { name: "Next fund columns" });
  const previous = page.getByRole("button", { name: "Previous fund columns" });
  await expect(previous).toBeDisabled();
  await next.click();
  expect(await region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(50);
  await previous.click();
  await expect(previous).toBeDisabled();
  const valueSort = region.getByRole("button", { name: /^Current value:/i });
  await valueSort.click();
  await expect(valueSort.locator("..")).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.getByRole("textbox", { name: "Search funds" }).fill("Aurora");
  await expect(page.locator(".holdings-scroll-tools")).toContainText("1 of 6 funds");
  await region.getByRole("button", { name: "Expand folios for Aurora Small Cap Direct Growth", exact: true }).click();
  const folio = region.getByRole("group", { name: "Folios for Aurora Small Cap Direct Growth" }).getByRole("button").first();
  await folio.locator(".folio-name").click();
  await expect(page.getByRole("dialog", { name: "Folio ••••4821" })).toBeVisible();
  await page.getByRole("button", { name: "Close fund details" }).click();
  await page.getByRole("textbox", { name: "Search funds" }).fill("");
  await expect(page.locator(".fund-group")).toHaveCount(6);
});

test("finger swipes scroll table rows and columns without opening fund details", async ({ page, browserName, isMobile }) => {
  test.skip(browserName !== "chromium" || !isMobile, "Native touch dispatch requires mobile Chromium.");
  await page.setViewportSize({ width: 390, height: 844 });
  await openDemo(page);
  const region = page.getByRole("region", { name: "Scrollable fund comparison" });
  await region.scrollIntoViewIfNeeded();
  const box = (await region.boundingBox())!;
  const headerTop = (await region.locator(".table-header").boundingBox())!.y;
  const client = await page.context().newCDPSession(page);
  const swipe = async (dx: number, dy: number) => {
    const x = box.x + box.width - 28;
    const y = box.y + box.height * .7;
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    for (let step = 1; step <= 6; step++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + dx * step / 6, y: y + dy * step / 6 }] });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(-170, 0);
  await expect.poll(() => region.evaluate((element) => element.scrollLeft)).toBeGreaterThan(60);
  await swipe(0, -150);
  await expect.poll(() => region.evaluate((element) => element.scrollTop)).toBeGreaterThan(60);
  expect((await region.locator(".table-header").boundingBox())!.y).toBeCloseTo(headerTop, 0);
  expect((await region.locator(".fund-name").nth(3).boundingBox())!.x).toBeCloseTo(box.x, 0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
  await client.detach();
});
