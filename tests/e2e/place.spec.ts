import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function openPlacePicker(page: Page) {
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Add place" }).click();
  await expect(
    page.getByRole("dialog", { name: "Add a private place" }),
  ).toBeVisible();
}

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("@place-layout keeps the private picker usable at certified widths", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/feed");
  await openPlacePicker(page);
  await expect(
    page.getByText(/no production-approved provider/i),
  ).toBeVisible();
  await expect(page.getByLabel("Place name")).toBeFocused();
  await expectAccessible(page);

  const layout = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>(".place-picker-modal");
    if (!dialog) return null;
    const box = dialog.getBoundingClientRect();
    return {
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth + 1,
      dialogFitsViewport: box.left >= 0 && box.right <= window.innerWidth + 1,
      actionsVisible: Boolean(
        document.querySelector(".place-picker-footer .button-primary"),
      ),
    };
  });
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    dialogFitsViewport: true,
    actionsVisible: true,
  });

  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-g-picker-${testInfo.project.name}.png`,
      fullPage: true,
    });
  }
});

test("@place-capability requests current location only after explanation", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/feed");
  await openPlacePicker(page);
  await page.getByRole("button", { name: "Use current location" }).click();
  await expect(
    page.getByText("One-time permission", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/never watches your movement/i)).toBeVisible();
  await page.screenshot({
    path: "test-results/evidence/increment-g-permission-place-capability-mobile.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Location found/i)).toBeVisible();
  await expect(page.getByLabel("Place name")).toHaveValue("Pinned location");
  await page.getByLabel(/Approximate/).check();
  await expect(page.getByText(/0.025° grid/)).toBeVisible();
  await page.getByLabel(/Exact/).check();
  await expect(
    page.getByLabel(/exact location will remain/i),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Attach place" }),
  ).toBeDisabled();
  await page.getByLabel(/exact location will remain/i).check();
  await expect(
    page.getByRole("button", { name: "Attach place" }),
  ).toBeEnabled();
  await expectAccessible(page);
});

test("@place-capability keeps manual entry available after permission denial", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "geolocation", {
      configurable: true,
      value: {
        getCurrentPosition: (
          _success: PositionCallback,
          failure: PositionErrorCallback,
        ) =>
          failure({
            code: 1,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
            message: "denied",
          }),
      },
    });
  });
  await page.goto("/feed");
  await openPlacePicker(page);
  await page.getByRole("button", { name: "Use current location" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(
    page.getByText(/permission was denied or dismissed/i),
  ).toBeVisible();
  await page.getByLabel("Place name").fill("Manual fallback");
  await expect(
    page.getByRole("button", { name: "Attach place" }),
  ).toBeEnabled();
});

test("@place-journey creates, revises, recalls, trashes, restores and redacts place history", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  const suffix = testInfo.project.name.includes("mobile")
    ? "Mobile"
    : "Desktop";
  const runId = Date.now().toString(36);
  const body = `Increment G place journey ${suffix} ${runId}`;
  const firstPlace = `Café 日本語 ${suffix} ${runId}`;
  const secondPlace = `Revised private place ${suffix} ${runId}`;

  await page.goto("/feed");
  await openPlacePicker(page);
  await page.getByLabel("Place name").fill(firstPlace);
  await page.getByLabel("Area or address (optional)").fill("Private test area");
  await page.getByRole("button", { name: "Attach place" }).click();
  await expect(page.getByText(firstPlace, { exact: true })).toBeVisible();
  if (suffix === "Mobile") {
    await page.screenshot({
      path: "test-results/evidence/increment-g-selected-place-mobile.png",
      fullPage: true,
    });
  }
  const feedReloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: /Add to/ }).click();
  await feedReloaded;

  const feedCard = page
    .locator("article.entry-card")
    .filter({ hasText: firstPlace });
  await expect(page.getByLabel("Loading your Odiina Feed")).toHaveCount(0);
  await expect(feedCard).toContainText(firstPlace);
  await page.screenshot({
    path: `test-results/evidence/increment-g-feed-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await feedCard.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/);
  await expect(
    page.getByText(firstPlace, { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Edit Entry" }).click();
  await page.getByLabel("Entry text").fill(body);
  await page.getByRole("button", { name: "Change place" }).click();
  await page.getByRole("button", { name: "Use current location" }).click();
  await expect(
    page.getByText("One-time permission", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText(/Location found/i)).toBeVisible();
  await page.getByLabel("Place name").fill(secondPlace);
  await page.getByRole("button", { name: "Attach place" }).click();
  await expect(page.getByText("Approximate · about 3 km")).toBeVisible();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible();
  await expect(page.getByText(firstPlace, { exact: true })).toBeVisible();
  await expect(
    page.getByText(secondPlace, { exact: true }).first(),
  ).toBeVisible();
  await expectAccessible(page);
  if (suffix === "Desktop") {
    await page.screenshot({
      path: "test-results/evidence/increment-g-history-desktop.png",
      fullPage: true,
    });
  }

  await page.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar/);
  const calendarCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await expect(calendarCard).toContainText(body);
  await expect(calendarCard).toContainText(secondPlace);

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  const placeStatistic = page
    .locator(".profile-stat-grid > div")
    .filter({ hasText: "Place Entries" });
  await expect(placeStatistic.locator("dd")).not.toHaveText("0");

  await page.goto("/feed");
  const revisedFeedCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await revisedFeedCard
    .getByRole("button", { name: "Move Entry to Trash" })
    .click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("link", { name: "Trash", exact: true }).click();
  await expect(page).toHaveURL(/\/trash$/);
  const trashCard = page.locator("article").filter({ hasText: body });
  await expect(trashCard).toContainText(secondPlace);
  await trashCard.getByRole("button", { name: "Restore Entry" }).click();
  await expect(trashCard).toHaveCount(0);

  await page.goto("/feed");
  const restoredCard = page
    .locator("article.entry-card")
    .filter({ hasText: body });
  await restoredCard.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]+$/);
  await page.getByRole("link", { name: "Edit Entry" }).click();
  await page.getByRole("button", { name: "Remove", exact: true }).click();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 3.*Current/ }),
  ).toBeVisible();
  await expect(page.getByText(firstPlace, { exact: true })).toBeVisible();
  await expect(page.getByText(secondPlace, { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Remove place from all revisions" })
    .click();
  const redactionReloaded = page.waitForEvent("load");
  await page.getByRole("button", { name: "Remove permanently" }).click();
  await redactionReloaded;
  // The two historical place snapshots are redacted; the current third
  // revision already contains no place.
  await expect(
    page.getByText("Place removed from this revision for privacy."),
  ).toHaveCount(2);
  await expect(page.getByText(firstPlace, { exact: true })).toHaveCount(0);
  await expect(page.getByText(secondPlace, { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Loading Odiina" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Revision 3.*Current/ }),
  ).toBeVisible();

  await page.screenshot({
    path: `test-results/evidence/increment-g-redacted-${testInfo.project.name}.png`,
    fullPage: true,
  });
});
