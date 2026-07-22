import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("@profile-layout keeps private identity usable at certified widths", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires the authenticated local Profile setup.",
  );
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Odiina member", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Profile" })).toBeVisible();
  await expect(page.locator(".profile-stat-grid dd")).toHaveCount(8);

  const layout = await page.evaluate(() => {
    const banner = document.querySelector(".profile-banner");
    const avatar = document.querySelector(".profile-avatar-large");
    const card = document.querySelector(".profile-card");
    if (!banner || !avatar || !card) return null;
    const bannerBox = banner.getBoundingClientRect();
    const avatarBox = avatar.getBoundingClientRect();
    const cardBox = card.getBoundingClientRect();
    return {
      noHorizontalOverflow:
        document.documentElement.scrollWidth <= window.innerWidth + 1,
      bannerControlled:
        bannerBox.height <= Math.max(256, window.innerHeight * 0.45),
      avatarInsideCard:
        avatarBox.left >= cardBox.left && avatarBox.right <= cardBox.right,
      editTargetHeight:
        document
          .querySelector<HTMLElement>(".profile-edit-button")
          ?.getBoundingClientRect().height ?? 0,
    };
  });
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    bannerControlled: true,
    avatarInsideCard: true,
    editTargetHeight: 44,
  });

  const axe = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(axe.violations).toEqual([]);
});
