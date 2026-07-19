import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("Odiina login is responsive and keyboard operable", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveTitle(/Sign in · Odiina/);
  await expect(page.getByRole("heading", { name: "Odiina" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Sign in to your private feed" }),
  ).toBeVisible();

  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.tagName);
  expect(focused).not.toBe("BODY");

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("@a11y login has no automated WCAG A/AA violations", async ({ page }) => {
  await page.goto("/login");
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
});

test("login reflows without horizontal scrolling at 200% and 400%", async ({
  page,
}) => {
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Sign in to your private feed" }),
    ).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    );
    expect(overflow).toBe(false);
  }
});
