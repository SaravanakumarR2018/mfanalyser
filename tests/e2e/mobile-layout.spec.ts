import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, openDemo } from "./helpers/app";

for (const width of [320, 390, 480, 600, 768]) {
  test(`mobile chart actions stay inside the viewport at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await openDemo(page);
    const stack = page.locator(".fund-stack-card");
    for (const name of ["Invested", "Contribution", "Period change"]) {
      await stack.getByRole("button", { name, exact: true }).click();
    }
    await expect(stack.locator(".fund-stack-panel")).toHaveCount(4);
    await expectNoHorizontalOverflow(page);
    const outside = () => page.locator(".chart-card, .fund-stack-card").evaluateAll((cards) =>
      cards.flatMap((card) => Array.from(card.querySelectorAll("button, input, canvas"))).filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0 && (box.left < -1 || box.right > innerWidth + 1);
      }).map((element) => element.getAttribute("aria-label") || element.textContent || element.className),
    );
    await expect.poll(outside, { message: "Every chart action and the complete plotting surface must fit without clipping" }).toEqual([]);
    const card = page.locator(".chart-card").first();
    await card.getByRole("button", { name: "1Y", exact: true }).click();
    await expect(card.locator('canvas[role="img"]')).not.toHaveAttribute("data-visible-points", "58");
    await card.getByRole("button", { name: "All", exact: true }).click();
    await expect(card.locator('canvas[role="img"]')).toHaveAttribute("data-visible-points", "58");
  });
}

test("phone holdings retain every desktop fund value and working search", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openDemo(page);
  const values = page.locator(".fund-group .fund-row > [data-label]");
  const desktopValues = await values.allTextContents();
  expect(desktopValues.length).toBeGreaterThan(30);
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(values).toHaveText(desktopValues);
  const scroller = page.getByRole("region", { name: "Scrollable fund comparison" });
  const clipped = await values.evaluateAll((elements) => elements.filter((element) => {
    const box = element.getBoundingClientRect();
    return box.width <= 0 || box.height <= 0 || element.scrollWidth > element.clientWidth + 1;
  }).map((element) => element.getAttribute("data-label")));
  expect(clipped, "Every desktop metric has an unclipped table cell accessible by horizontal scrolling").toEqual([]);
  await expectNoHorizontalOverflow(page);
  await scroller.scrollIntoViewIfNeeded();
  await scroller.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(page.locator(".fund-row.table-header").getByRole("columnheader", { name: "Below cost" })).toBeInViewport();
  const search = page.getByRole("textbox", { name: /search funds/i });
  await search.fill("Aurora");
  await expect(page.locator(".fund-group")).toHaveCount(1);
  await search.fill("");
  await expect(values).toHaveText(desktopValues);
});

