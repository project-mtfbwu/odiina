import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function openTagPicker(page: Page) {
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Add tags" }).click();
  await expect(page.getByRole("dialog", { name: "Add tags" })).toBeVisible();
}

async function createTag(page: Page, tag: string) {
  const input = page.getByLabel("Find or create a tag");
  await input.fill(tag);
  await page.getByRole("button", { name: `Create “${tag}”` }).click();
  await expect(
    page
      .getByRole("dialog", { name: "Add tags" })
      .getByRole("button", { name: `Remove ${tag}` }),
  ).toBeVisible();
}

test("@search-layout keeps private Search usable at certified widths", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/search");
  await expect(
    page.getByRole("heading", { name: "Search your Odiina" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search private Entries" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: /Entry types/ })).toBeVisible();
  const layout = await page.evaluate(() => ({
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    queryVisible: Boolean(
      document.querySelector<HTMLInputElement>('input[name="q"]')?.offsetParent,
    ),
  }));
  expect(layout).toEqual({ noHorizontalOverflow: true, queryVisible: true });
  await expectAccessible(page);
  if (
    ["search-layout-390", "search-layout-1440"].includes(testInfo.project.name)
  ) {
    await page.screenshot({
      path: `test-results/evidence/increment-h-search-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
});

test("@search-journey creates tags, searches, revises, trashes and restores", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  const mobile = testInfo.project.name.includes("mobile");
  const suffix = mobile ? "Mobile" : "Desktop";
  const runId = Date.now().toString(36);
  const body = `Increment H guitar recall ${suffix} ${runId}`;
  const workTag = `Work ${suffix} ${runId}`;
  const guitarTag = `Guitar ${suffix} ${runId}`;
  const revisedTag = `Practice ${suffix} ${runId}`;

  await page.goto("/feed");
  await page.getByPlaceholder("Log something…").fill(body);
  await openTagPicker(page);
  await createTag(page, workTag);
  await createTag(page, guitarTag);
  await page.getByRole("button", { name: "Done" }).click();
  await expect(
    page
      .getByRole("status", { name: "Selected tags" })
      .getByRole("button", { name: `Remove ${workTag}` }),
  ).toBeVisible();
  if (mobile) {
    await page.screenshot({
      path: "test-results/evidence/increment-h-tags-composer-mobile.png",
      fullPage: true,
    });
  }
  const feedReloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: /Add to/ }).click();
  await feedReloaded;
  const feedCard = page.locator("article.entry-card").filter({ hasText: body });
  await expect(feedCard).toContainText(workTag);
  await expect(feedCard).toContainText(guitarTag);

  await page.goto(
    `/search?q=${encodeURIComponent("guitar recall")}&sort=relevance`,
  );
  const searchCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await expect(searchCard).toBeVisible();
  await expect(page.getByRole("status")).toContainText(/result/);
  await expectAccessible(page);

  await page.goto(
    `/search?tag=${encodeURIComponent(workTag)}&tag=${encodeURIComponent(guitarTag)}&sort=newest`,
  );
  await expect(
    page.locator("article.entry-card").filter({ hasText: body }),
  ).toBeVisible();
  await expect(page.getByLabel(workTag)).toBeChecked();
  await expect(page.getByLabel(guitarTag)).toBeChecked();
  if (mobile) {
    await page.screenshot({
      path: "test-results/evidence/increment-h-filtered-results-mobile.png",
      fullPage: true,
    });
  }

  const detailLink = page
    .locator("article.entry-card")
    .filter({ hasText: body })
    .getByRole("link", { name: /Open Entry from/ });
  await detailLink.click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/);
  const detailUrl = page.url();
  await page.getByRole("link", { name: "Edit Entry" }).click();
  await page.getByRole("button", { name: "Change tags" }).click();
  await page
    .getByRole("dialog", { name: "Add tags" })
    .getByRole("button", { name: `Remove ${guitarTag}` })
    .click();
  await createTag(page, revisedTag);
  await page.getByRole("button", { name: "Done" }).click();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible();
  const revisionHistory = page.getByLabel("Revision history");
  await expect(
    revisionHistory.getByText(guitarTag, { exact: true }),
  ).toBeVisible();
  await expect(
    revisionHistory.getByText(revisedTag, { exact: true }),
  ).toBeVisible();
  if (!mobile) {
    await page.screenshot({
      path: "test-results/evidence/increment-h-tag-history-desktop.png",
      fullPage: true,
    });
  }

  await page.goto(`/search?tag=${encodeURIComponent(guitarTag)}&sort=newest`);
  await expect(page.getByText(body, { exact: false })).toHaveCount(0);
  await page.goto(`/search?tag=${encodeURIComponent(revisedTag)}&sort=newest`);
  const revisedCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await expect(revisedCard).toBeVisible();
  await revisedCard
    .getByRole("button", { name: "Move Entry to Trash" })
    .click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(revisedCard).toHaveCount(0);

  await page.goto(`/search?tag=${encodeURIComponent(revisedTag)}&sort=newest`);
  await expect(page.getByText(body, { exact: false })).toHaveCount(0);
  await page.goto(
    `/search?tag=${encodeURIComponent(revisedTag)}&includeTrash=1&sort=newest`,
  );
  const trashedCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await expect(trashedCard).toContainText("In Trash");
  if (mobile) {
    await page.screenshot({
      path: "test-results/evidence/increment-h-include-trash-mobile.png",
      fullPage: true,
    });
  }
  await trashedCard.getByRole("button", { name: "Restore Entry" }).click();
  await expect(trashedCard).toHaveCount(0);
  await page.goto(`/search?tag=${encodeURIComponent(revisedTag)}&sort=newest`);
  await expect(
    page.locator("article.entry-card").filter({ hasText: body }),
  ).toBeVisible();

  await page.goto(detailUrl);
  await expect(page.getByRole("link", { name: revisedTag })).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/\/login\?status=logged-out$/);
  await page.goto(`/search?q=${encodeURIComponent(body)}`);
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(body, { exact: false })).toHaveCount(0);
});
