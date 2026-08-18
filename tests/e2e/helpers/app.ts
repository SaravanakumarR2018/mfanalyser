import { expect, type Locator, type Page } from "@playwright/test";
import { makeCasPdf } from "./cas-fixture";

export const uploadInput = (page: Page) => page.locator('input[type="file"]');

export async function waitForHydration(page: Page) {
  await page.waitForFunction(() => {
    const input = document.querySelector('input[type="file"]');
    return input && Object.keys(input).some((key) => key.startsWith("__reactProps$"));
  });
}

export async function openDemo(page: Page) {
  await page.goto("/");
  await waitForHydration(page);
  await page.getByRole("button", { name: /explore with demo data/i }).click();
  await expect(page.getByRole("heading", { name: "Your funds" })).toBeVisible();
}

export async function uploadCas(page: Page, pdf = makeCasPdf()) {
  await waitForHydration(page);
  await uploadInput(page).setInputFiles({
    name: "regression-cas.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
}

export async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    body: document.body.scrollWidth - document.body.clientWidth,
    root: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  }));
  expect(overflow.body, "body must not overflow the viewport horizontally").toBeLessThanOrEqual(1);
  expect(overflow.root, "document must not overflow the viewport horizontally").toBeLessThanOrEqual(1);
}

export async function expectCanvasHasInk(canvas: Locator) {
  await expect(canvas).toBeVisible();
  const sample = await canvas.evaluate((element: HTMLCanvasElement) => {
    const context = element.getContext("2d");
    if (!context || !element.width || !element.height) return { colors: 0, opaque: 0 };
    const pixels = context.getImageData(0, 0, element.width, element.height).data;
    const colors = new Set<string>();
    let opaque = 0;
    const stride = Math.max(4, Math.floor(pixels.length / 20_000 / 4) * 4);
    for (let index = 0; index < pixels.length; index += stride) {
      const alpha = pixels[index + 3];
      if (alpha > 8) {
        opaque += 1;
        colors.add(`${pixels[index]},${pixels[index + 1]},${pixels[index + 2]},${alpha}`);
      }
    }
    return { colors: colors.size, opaque };
  });
  expect(sample.opaque, "canvas should contain rendered pixels").toBeGreaterThan(20);
  expect(sample.colors, "canvas should contain multiple visual colors").toBeGreaterThan(3);
}

export async function installFailureGuards(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console.error: ${message.text()}`);
  });
  return () => expect(errors, "browser must not emit uncaught errors").toEqual([]);
}
