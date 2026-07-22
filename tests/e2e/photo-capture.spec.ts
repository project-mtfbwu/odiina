import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import sharp from "sharp";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function expectComposerReady(page: Page) {
  const text = page.getByLabel("Entry text (optional with private media)");
  await text.fill("ready");
  await expect(page.getByText("99,995 characters left")).toBeVisible();
  await text.fill("");
  await expect(page.getByText("100,000 characters left")).toBeVisible();
}

test("@photo-layout keeps the private photo draft usable", async ({ page }) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed$/);
  await expectComposerReady(page);
  const fixture = await sharp({
    create: {
      width: 800,
      height: 500,
      channels: 3,
      background: { r: 70, g: 52, b: 168 },
    },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Choose one or more photos").setInputFiles({
    name: "responsive-photo.jpg",
    mimeType: "image/jpeg",
    buffer: fixture,
  });
  await expect(page.getByText("1 of 5 photo selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add more" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Clear all" })).toBeVisible();
  const layout = await page.evaluate(() => {
    const preview = document.querySelector(".image-preview-shell");
    const composer = document.querySelector(".composer-shell");
    const mobileNav = document.querySelector('[aria-label="Mobile primary"]');
    if (!preview || !composer) return null;
    const composerBox = composer.getBoundingClientRect();
    const navBox = mobileNav?.getBoundingClientRect();
    return {
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth + 1,
      previewScrollable:
        preview.scrollHeight <= preview.clientHeight + 1 ||
        getComputedStyle(preview).overflowY === "auto",
      clearsMobileNavigation:
        !navBox ||
        composerBox.bottom <= navBox.top + 1 ||
        composerBox.top >= navBox.bottom,
    };
  });
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    previewScrollable: true,
    clearsMobileNavigation: true,
  });
  await expectAccessible(page);
  await page.getByRole("button", { name: "Clear all" }).click();
  await expect(page.locator(".image-preview-shell")).toHaveCount(0);
});

test("@camera-capability enforces the five-photo draft limit", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/feed");
  await expectComposerReady(page);
  const fixture = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 3,
      background: { r: 42, g: 114, b: 92 },
    },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Choose one or more photos").setInputFiles(
    Array.from({ length: 6 }, (_, index) => ({
      name: `photo-${index + 1}.jpg`,
      mimeType: "image/jpeg",
      buffer: fixture,
    })),
  );
  await expect(page.locator("#capture-error")).toContainText(
    "You can attach up to 5 photos",
  );
  await expect(page.getByText("5 of 5 photos selected")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add more" })).toBeDisabled();
  await expectAccessible(page);
});

test("@camera-capability keeps native fallbacks without getUserMedia", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: async () => [] },
    });
  });
  await page.goto("/feed");
  await expectComposerReady(page);
  await page.getByRole("button", { name: "Take a photo", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Take a photo" });
  await dialog.getByRole("button", { name: "Open camera" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "does not provide live camera capture",
  );
  await expect(
    dialog.getByRole("button", { name: "Choose photos" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Use device camera picker" }),
  ).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Open camera" })).toHaveCount(
    0,
  );
  await expectAccessible(page);
});

for (const failure of [
  {
    name: "NotAllowedError",
    expected: "Camera access was blocked",
  },
  {
    name: "NotFoundError",
    expected: "No usable camera was found",
  },
]) {
  test(`@camera-capability offers fallbacks after ${failure.name}`, async ({
    page,
  }) => {
    test.skip(
      process.env.ODIINA_E2E !== "1",
      "Requires authenticated local setup.",
    );
    await page.addInitScript((errorName) => {
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: async () => {
            throw new DOMException("mock camera failure", errorName);
          },
          enumerateDevices: async () => [],
        },
      });
    }, failure.name);
    await page.goto("/feed");
    await expectComposerReady(page);
    await page
      .getByRole("button", { name: "Take a photo", exact: true })
      .click();
    const dialog = page.getByRole("dialog", { name: "Take a photo" });
    await dialog.getByRole("button", { name: "Open camera" }).click();
    await expect(dialog.getByRole("alert")).toContainText(failure.expected);
    await expect(
      dialog.getByRole("button", { name: "Choose photos" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Use device camera picker" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Retry camera" }),
    ).toBeVisible();
    await expectAccessible(page);
  });
}
