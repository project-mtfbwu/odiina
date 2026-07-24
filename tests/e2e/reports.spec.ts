import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("@report-layout keeps the private library and creation flow usable", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/reports");
  await expect(
    page.getByRole("heading", { level: 1, name: "Reports" }),
  ).toBeVisible();
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await page.goto("/reports/new");
  await expect(
    page.getByRole("heading", { level: 1, name: "Create a private recap" }),
  ).toBeVisible();
  const type = page.getByLabel("Recap type");
  await type.selectOption("weekly");
  await expect(page.locator(".report-period-summary strong")).toContainText(
    "Weekly recap",
  );
  await type.selectOption("monthly");
  await expect(page.locator(".report-period-summary strong")).toContainText(
    "Monthly recap",
  );
  await type.selectOption("yearly");
  await expect(page.locator(".report-period-summary strong")).toContainText(
    "Yearly story",
  );
  await expectAccessible(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-j-report-library-${testInfo.project.use.viewport?.width}.png`,
      fullPage: true,
    });
  }
});

test("@report-types creates weekly, monthly and yearly factual stories", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  for (const type of ["weekly", "monthly", "yearly"] as const) {
    await page.goto("/reports/new");
    await page.getByLabel("Recap type").selectOption(type);
    await page.getByRole("button", { name: "Preview sources" }).click();
    await expect(page.getByText(/Factual preview only/)).toBeVisible();
    await page.getByRole("button", { name: "Create private draft" }).click();
    await expect(page).toHaveURL(/\/reports\/[0-9a-f-]+\/edit/);
    const storyUrl = new URL(page.url()).pathname.replace(/\/edit$/, "");
    await page.goto(storyUrl);
    await expect(page.getByText("Factual · no AI required")).toBeVisible();
    await expectAccessible(page);
  }
  await expect(
    page.getByRole("heading", { level: 1, name: /Yearly story/ }),
  ).toBeVisible();
  const width = testInfo.project.use.viewport?.width ?? 0;
  if ([390, 1440].includes(width))
    await page.screenshot({
      path: `test-results/evidence/increment-j-yearly-story-${width}.png`,
      fullPage: true,
    });
});

test("@report-journey creates, curates, exports, shares and revokes a factual daily recap", async ({
  page,
  browser,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  const marker = `Factual report source ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/settings/ai");
  const master = page.getByLabel("Enable private AI processing");
  if (await master.isChecked()) {
    await master.uncheck();
    await page.getByRole("button", { name: "Save AI choices" }).click();
    await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  }
  await page.goto("/feed");
  await page.getByLabel("Entry text").fill(marker);
  await page.getByRole("button", { name: /Add to/ }).click();
  await expect(
    page.locator("article.entry-card").filter({ hasText: marker }),
  ).toBeVisible();

  await page.goto("/reports/new");
  await page.getByLabel("Recap type").selectOption("daily");
  await page.getByRole("button", { name: "Preview sources" }).click();
  await expect(page.getByText(/Factual preview only/)).toBeVisible();
  await page.getByRole("button", { name: "Create private draft" }).click();
  await expect(page).toHaveURL(/\/reports\/[0-9a-f-]+\/edit/);
  await expect(page.getByText(marker)).toBeVisible();
  await page.getByLabel("Report title").fill("A private factual day");
  await page
    .getByLabel("User-authored introduction")
    .fill("A deliberately factual recap created while AI was off.");
  await page
    .getByLabel("Closing reflection")
    .fill("User-authored reflection remains distinct from generated evidence.");
  await page.getByRole("button", { name: "Move down" }).first().click();
  await page.getByRole("button", { name: "Save private report" }).click();
  await expect(page.getByText(/Private report saved/)).toBeVisible();
  const reportUrl = new URL(page.url()).pathname.replace(/\/edit$/, "");
  await page.goto(reportUrl);
  await expect(
    page.getByRole("heading", { level: 1, name: "A private factual day" }),
  ).toBeVisible();
  await expect(page.getByText("Factual · no AI required")).toBeVisible();
  await expect(page.getByText(marker)).toBeVisible();
  await expectAccessible(page);
  const width = testInfo.project.use.viewport?.width ?? 0;
  if ([390, 1440].includes(width))
    await page.screenshot({
      path: `test-results/evidence/increment-j-daily-story-${width}.png`,
      fullPage: true,
    });

  await page.goto(`${reportUrl}/share`);
  await expect(
    page.getByRole("heading", { level: 1, name: "Export or share" }),
  ).toBeVisible();
  await expect(
    page.getByText(/Media excluded in this deployment/),
  ).toBeVisible();
  await expectAccessible(page);
  const printPagePromise = page.waitForEvent("popup");
  await page.getByRole("link", { name: "Open print view" }).click();
  const printPage = await printPagePromise;
  await expect(
    printPage.getByRole("heading", { level: 1, name: "A private factual day" }),
  ).toBeVisible();
  await expect(printPage.getByText(/does not claim tagged-PDF/)).toBeVisible();
  await expectAccessible(printPage);
  if (width === 1440)
    await printPage.screenshot({
      path: "test-results/evidence/increment-j-print-view-1440.png",
      fullPage: true,
    });
  await printPage.close();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Markdown" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^odiina-daily-.*\.md$/);
  expect(await download.failure()).toBeNull();
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const markdown = await readFile(downloadPath!, "utf8");
  expect(markdown).toContain(marker);
  expect(markdown).toContain("exact coordinates are omitted");
  expect(markdown).not.toMatch(
    /entry_id|revision_id|object_key|latitude|longitude/,
  );
  if ([390, 1440].includes(width))
    await page.screenshot({
      path: `test-results/evidence/increment-j-share-review-${width}.png`,
      fullPage: true,
    });
  await page.getByLabel(/I reviewed the exact text/).check();
  await page
    .getByRole("button", { name: "Publish revocable snapshot" })
    .click();
  const shareInput = page.getByLabel("One-time share link");
  await expect(shareInput).toBeVisible();
  const shareUrl = await shareInput.inputValue();

  const anonymous = await browser.newContext({
    viewport: {
      width: width <= 390 ? 390 : 1440,
      height: width <= 390 ? 844 : 1000,
    },
  });
  await anonymous.clearCookies();
  expect(await anonymous.cookies()).toEqual([]);
  const viewer = await anonymous.newPage();
  await viewer.goto(shareUrl);
  await expect(
    viewer.getByRole("heading", { level: 1, name: "A private factual day" }),
  ).toBeVisible();
  await expect(viewer.getByText(marker)).toBeVisible();
  await expect(viewer.getByText(/No tracking, comments, likes/)).toBeVisible();
  await expectAccessible(viewer);
  if ([390, 1440].includes(width))
    await viewer.screenshot({
      path: `test-results/evidence/increment-j-shared-viewer-${width}.png`,
      fullPage: true,
    });
  await viewer.goto("/reports");
  await expect(viewer).toHaveURL(/\/login/);

  await page.getByRole("button", { name: "Revoke" }).click();
  await expect(page.getByText("Share revoked immediately.")).toBeVisible();
  await viewer.goto(shareUrl);
  await expect(
    viewer.getByRole("heading", { level: 1, name: "This share was revoked" }),
  ).toBeVisible();
  await expect(viewer.getByText(marker)).toHaveCount(0);
  await anonymous.close();
});
