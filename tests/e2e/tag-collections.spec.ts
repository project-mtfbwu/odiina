import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("@tags-layout keeps private tag collections accessible", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/tags");
  await expect(
    page.getByRole("heading", { level: 1, name: "Tags" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  await expectAccessible(page);
  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-h1-tags-${testInfo.project.use.viewport?.width}.png`,
      fullPage: true,
    });
  }
});

test("@tags-journey supports inline, nested, parent and child collections", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  const run = crypto.randomUUID().slice(0, 8);
  const parent = `Work${run}`;
  const firstTag = `${parent}/OAS`;
  const secondTag = `${parent}/PGS`;
  const firstBody = `Synthetic collection ${run} #${firstTag}`;
  const secondBody = `Second collection ${run} #${secondTag}`;

  await page.goto("/feed");
  const body = page.getByLabel("Entry text (optional with private media)");
  await body.fill(firstBody);
  const inlineChip = page.getByRole("button", { name: `Remove ${firstTag}` });
  await expect(inlineChip).toBeVisible();
  await inlineChip.click();
  await expect(body).toHaveValue(firstBody);
  await expect(inlineChip).toHaveCount(0);

  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Add tags" }).click();
  const picker = page.getByRole("dialog", { name: "Add tags" });
  await picker.getByLabel("Find or create a tag").fill(`#${firstTag}`);
  await picker.getByLabel("Find or create a tag").press("Enter");
  await expect(
    picker.getByRole("button", { name: `Remove ${firstTag}` }),
  ).toBeVisible();
  await picker.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: /Add to/ }).click();
  await expect(
    page.locator("article.entry-card").filter({ hasText: firstBody }),
  ).toBeVisible();

  await body.fill(secondBody);
  await expect(
    page.getByRole("button", { name: `Remove ${secondTag}` }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Add to/ }).click();
  await expect(
    page.locator("article.entry-card").filter({ hasText: secondBody }),
  ).toBeVisible();

  await page.goto("/tags");
  const parentLink = page
    .getByRole("link", {
      name: new RegExp(`${parent}, 2 active Entries, collection`),
    })
    .first();
  await expect(parentLink).toBeVisible();
  await parentLink.focus();
  await expect(parentLink).toBeFocused();
  await parentLink.press("Enter");
  await expect(page).toHaveURL(/tagScope=collection/);
  await expect(
    page.locator("article.entry-card").filter({ hasText: firstBody }),
  ).toBeVisible();
  await expect(
    page.locator("article.entry-card").filter({ hasText: secondBody }),
  ).toBeVisible();

  await page.goto(`/search?tag=${encodeURIComponent(firstTag)}&sort=newest`);
  const firstCard = page
    .locator("article.entry-card")
    .filter({ hasText: firstBody });
  await expect(firstCard).toBeVisible();
  await expect(
    page.locator("article.entry-card").filter({ hasText: secondBody }),
  ).toHaveCount(0);
  await firstCard.getByRole("button", { name: "Move Entry to Trash" }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(firstCard).toHaveCount(0);

  await page.goto("/tags");
  await expect(
    page
      .getByRole("link", {
        name: new RegExp(`${parent}, 1 active Entry, collection`),
      })
      .first(),
  ).toBeVisible();
  await page.goto("/trash");
  const trashed = page
    .getByText(firstBody, { exact: true })
    .locator("xpath=ancestor::article");
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore Entry" }).click();
  await expect(trashed).toHaveCount(0);
  await page.goto("/tags");
  await expect(
    page
      .getByRole("link", {
        name: new RegExp(`${parent}, 2 active Entries, collection`),
      })
      .first(),
  ).toBeVisible();
  await expectAccessible(page);

  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-h1-collection-${testInfo.project.use.viewport?.width}.png`,
      fullPage: true,
    });
  }
});
