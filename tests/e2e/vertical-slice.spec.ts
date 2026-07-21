import AxeBuilder from "@axe-core/playwright";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import sharp from "sharp";

const invitedEmail = "journey@example.test";
const mailboxUrl = process.env.ODIINA_MAILBOX_URL ?? "http://127.0.0.1:54324";

type MailpitMessage = {
  ID: string;
  To?: Array<{ Address?: string }>;
};

type MailpitList = {
  messages?: MailpitMessage[];
};

async function mailIds(request: APIRequestContext): Promise<Set<string>> {
  const response = await request.get(`${mailboxUrl}/api/v1/messages`);
  if (!response.ok()) {
    throw new Error(`Mailpit list failed with ${response.status()}.`);
  }
  const body = (await response.json()) as MailpitList;
  return new Set((body.messages ?? []).map((message) => message.ID));
}

async function waitForMagicLink(
  request: APIRequestContext,
  existingIds: Set<string>,
): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(`${mailboxUrl}/api/v1/messages`);
    if (response.ok()) {
      const body = (await response.json()) as MailpitList;
      const message = (body.messages ?? []).find(
        (candidate) =>
          !existingIds.has(candidate.ID) &&
          candidate.To?.some(
            (recipient) => recipient.Address?.toLowerCase() === invitedEmail,
          ),
      );
      if (message) {
        const detailResponse = await request.get(
          `${mailboxUrl}/api/v1/message/${message.ID}`,
        );
        if (!detailResponse.ok()) {
          throw new Error(
            `Mailpit message read failed with ${detailResponse.status()}.`,
          );
        }
        const detail = (await detailResponse.json()) as {
          HTML?: string;
          Text?: string;
        };
        const material =
          `${detail.HTML ?? ""}\n${detail.Text ?? ""}`.replaceAll("&amp;", "&");
        const link = material
          .match(/https?:\/\/[^\s"'<>]+/g)
          ?.find((candidate) => candidate.includes("/auth/v1/verify"));
        if (link) {
          return link;
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`No new magic-link email arrived for ${invitedEmail}.`);
}

async function expectNoAxeViolations(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

test("@authenticated completes Odiina Increments A through C", async ({
  context,
  page,
  request,
}) => {
  test.setTimeout(360_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires a reset local Supabase stack, Mailpit and ODIINA_E2E=1.",
  );

  const priorMessages = await mailIds(request);
  await page.goto("/login");
  await page.getByLabel("Email address").fill(invitedEmail);
  await page.getByRole("button", { name: "Email me a magic link" }).click();
  await expect(page).toHaveURL(/status=check-email/);

  const magicLink = await waitForMagicLink(request, priorMessages);
  await page.goto(magicLink);
  await expect(page).toHaveURL(/\/onboarding$/);
  await expect(
    page.getByRole("heading", { name: "Confirm where your day happens." }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByLabel("IANA timezone").fill("UTC");
  await page.getByRole("button", { name: "Confirm and continue" }).click();
  await expect(page).toHaveURL(/\/feed$/);
  await expect(
    page.getByRole("heading", { name: "Your day, as it happened." }),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(
    page.getByRole("heading", { name: "Odiina member", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".profile-handle")).toHaveText(
    /^@member_[a-f0-9]{23}$/,
  );
  await expectNoAxeViolations(page);

  await page.getByRole("link", { name: "Edit Profile" }).click();
  await expect(
    page.getByRole("heading", { name: "Edit Profile" }),
  ).toBeVisible();
  await page.getByLabel("Display name").fill("Journey Example");
  await page.getByLabel("Handle").fill("journey_example");
  await page
    .getByLabel("Bio")
    .fill("Private days, recorded honestly.\nBuilt one Entry at a time.");
  const avatarFixture = await sharp({
    create: {
      width: 720,
      height: 480,
      channels: 3,
      background: { r: 100, g: 72, b: 210 },
    },
  })
    .png()
    .toBuffer();
  const bannerFixture = await sharp({
    create: {
      width: 1200,
      height: 500,
      channels: 3,
      background: { r: 28, g: 48, b: 112 },
    },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Choose avatar").setInputFiles({
    name: "profile-avatar.png",
    mimeType: "image/png",
    buffer: avatarFixture,
  });
  await expect(page.locator("#avatar-status")).toContainText("Ready", {
    timeout: 120_000,
  });
  await page.getByLabel("Choose banner").setInputFiles({
    name: "profile-banner.jpg",
    mimeType: "image/jpeg",
    buffer: bannerFixture,
  });
  await expect(page.locator("#banner-status")).toContainText("Ready", {
    timeout: 120_000,
  });
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Save Profile" }).click();
  await expect(page).toHaveURL(/\/profile\?saved=1#profile-edit-action$/);
  await expect(page.getByRole("status")).toHaveText("Profile saved.");
  await expect(page.getByRole("link", { name: "Edit Profile" })).toBeFocused();
  await expect(
    page.getByRole("heading", { name: "Journey Example" }),
  ).toBeVisible();
  await expect(page.locator(".profile-handle")).toHaveText("@journey_example");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Journey Example" }),
  ).toBeVisible();
  await expect(page.locator(".rail-profile-name")).toHaveText(
    "Journey Example",
  );
  await expect(page.locator(".profile-banner img")).toBeVisible();
  await expect(page.locator(".profile-avatar-large img")).toBeVisible();
  for (const role of ["avatar", "banner"]) {
    const response = await page.request.get(`/api/profile/media/${role}`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("image/jpeg");
    expect(response.headers()["cache-control"]).toContain("no-store");
  }

  const activeEntryStat = page
    .locator(".profile-stat-grid > div")
    .filter({ hasText: "Active Entries" })
    .locator("dd");
  await expect(activeEntryStat).toHaveText("0");
  await page.getByRole("link", { name: "Feed", exact: true }).click();

  const composer = page.getByLabel("Entry text");
  await composer.fill("Offline draft retained by Odiina");
  await context.setOffline(true);
  await page.getByRole("button", { name: "Add to today" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "offline" }),
  ).toContainText("offline");
  await expect(composer).toHaveValue("Offline draft retained by Odiina");
  await context.setOffline(false);

  const originalBody = "Vertical slice browser Entry";
  const revisedBody = "Vertical slice browser Entry — revised";
  await composer.fill(originalBody);
  await Promise.all([
    page.waitForEvent("load"),
    composer.press("Control+Enter"),
  ]);
  await expect(page.getByText(originalBody, { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(activeEntryStat).toHaveText("1");
  await page.getByRole("link", { name: "Feed", exact: true }).click();

  const parallelReads = await Promise.all(
    Array.from({ length: 4 }, () => page.request.get("/api/feed")),
  );
  for (const response of parallelReads) {
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
  }

  await page
    .getByRole("link", { name: /Open Entry from/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/);
  const entryId = page.url().match(/\/entries\/([0-9a-f-]{36})$/)?.[1];
  expect(entryId).toBeTruthy();
  await expect(
    page.getByText(originalBody, { exact: true }).first(),
  ).toBeVisible();
  await expectNoAxeViolations(page);

  const imageEntryPath = new URL(page.url()).pathname;
  await page
    .locator(`a[href="${imageEntryPath}?mode=edit"]`)
    .getByText("Edit Entry", { exact: true })
    .click();
  await page.getByLabel("Entry text").fill(revisedBody);
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible();
  await expect(page.getByText(originalBody, { exact: true })).toBeVisible();
  await expect(
    page.getByText(revisedBody, { exact: true }).first(),
  ).toBeVisible();

  await page.getByRole("link", { name: "Back to Feed" }).click();
  await expect(page).toHaveURL(new RegExp(`/feed#entry-${entryId}$`));
  await expect(
    page.locator(`#entry-${entryId}`).getByText(revisedBody, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(`#entry-${entryId}`)).toBeFocused();
  await page.getByRole("button", { name: "Move Entry to Trash" }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await expect(
    page.getByRole("heading", { name: "Recent Entries" }),
  ).toBeFocused();

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(activeEntryStat).toHaveText("0");

  await page.getByRole("link", { name: "Trash" }).click();
  await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
  await expect(page.getByText(revisedBody, { exact: true })).toBeVisible();
  await expectNoAxeViolations(page);
  await page.getByRole("button", { name: "Restore Entry" }).click();
  await expect(page.getByText("Trash is empty")).toBeVisible();

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await expect(activeEntryStat).toHaveText("1");

  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await expect(page.getByText(revisedBody, { exact: true })).toBeVisible();

  const cameraInput = page.getByLabel("Take a photo with the device camera");
  await expect(cameraInput).toHaveAttribute("capture", "environment");
  await expect(cameraInput).toHaveAttribute(
    "accept",
    "image/jpeg,image/png,image/webp",
  );
  const blue = await sharp({
    create: {
      width: 640,
      height: 360,
      channels: 3,
      background: { r: 20, g: 80, b: 210 },
    },
  })
    .png()
    .toBuffer();
  const gold = await sharp({
    create: {
      width: 480,
      height: 480,
      channels: 3,
      background: { r: 245, g: 185, b: 50 },
    },
  })
    .webp()
    .toBuffer();
  await page.getByLabel("Choose one or more photos").setInputFiles([
    { name: "blue-geometry.png", mimeType: "image/png", buffer: blue },
    { name: "gold-geometry.webp", mimeType: "image/webp", buffer: gold },
  ]);
  const goldSelection = page
    .locator("li")
    .filter({ hasText: "gold-geometry.webp" });
  await goldSelection.getByRole("button", { name: "Move earlier" }).click();
  const selectedNames = await page
    .locator("ol li p.font-bold")
    .allTextContents();
  expect(selectedNames).toEqual(["gold-geometry.webp", "blue-geometry.png"]);
  await expectNoAxeViolations(page);

  await page.getByRole("button", { name: "Add to today" }).click();
  await expect(page.getByText("2 photos", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  const imageOnlyCard = page.locator("article").filter({ hasText: "2 photos" });
  await imageOnlyCard.getByRole("link", { name: /Open Entry from/ }).click();
  const imageBackLink = page.getByRole("link", { name: "Back to Feed" });
  await expect(imageBackLink).toBeVisible();
  await expect(
    page.getByAltText("Attached image 1 of 2").first(),
  ).toBeVisible();
  await expect(
    page.getByAltText("Attached image 2 of 2").first(),
  ).toBeVisible();

  const imageOnlyEntryId = (await imageBackLink.getAttribute("href"))?.match(
    /entry-([0-9a-f-]{36})$/,
  )?.[1];
  expect(imageOnlyEntryId).toBeTruthy();
  await page
    .locator(`a[href="/entries/${imageOnlyEntryId}?mode=edit"]`)
    .getByText("Edit Entry", { exact: true })
    .click();
  await page.getByLabel("Entry text").fill("Text added to an image-only Entry");
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible();
  // Two images in the current view plus the same immutable membership in
  // revisions 2 and 1.
  expect(await page.getByAltText(/Attached image/).count()).toBe(6);

  await page.getByRole("link", { name: "Back to Feed" }).click();
  const mediaCard = page
    .locator("article")
    .filter({ hasText: "Text added to an image-only Entry" });
  await mediaCard.getByRole("button", { name: "Move Entry to Trash" }).click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("link", { name: "Trash" }).click();
  await expect(
    page.getByText("Text added to an image-only Entry", { exact: true }),
  ).toBeVisible();
  await expect(page.getByAltText("Attached image 1 of 2")).toBeVisible();
  await page.getByRole("button", { name: "Restore Entry" }).click();
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  await expect(
    page.getByText("Text added to an image-only Entry", { exact: true }),
  ).toBeVisible();

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await page.getByRole("link", { name: "Edit Profile" }).click();
  await page.getByLabel("Display name").fill("Unsaved replacement");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL(/\/profile#profile-edit-action$/);
  await expect(
    page.getByRole("heading", { name: "Journey Example" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Edit Profile" })).toBeFocused();
  await page.getByRole("link", { name: "Edit Profile" }).click();
  await page
    .getByRole("group", { name: "Avatar" })
    .getByRole("button", { name: "Remove" })
    .click();
  await page.getByRole("button", { name: "Save Profile" }).click();
  const initialsAvatar = page.locator('.profile-avatar-large[role="img"]');
  await expect(initialsAvatar).toBeVisible();
  await expect(initialsAvatar).toHaveAccessibleName(
    "Journey Example's initials",
  );
  expect((await page.request.get("/api/profile/media/avatar")).status()).toBe(
    404,
  );

  await page.getByRole("link", { name: "Settings" }).click();
  await expectNoAxeViolations(page);

  const authCookiesBeforeLogout = (await context.cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );
  expect(authCookiesBeforeLogout.length).toBeGreaterThan(0);
  expect(authCookiesBeforeLogout.every((cookie) => cookie.httpOnly)).toBe(true);
  expect(
    authCookiesBeforeLogout.every((cookie) => cookie.sameSite === "Lax"),
  ).toBe(true);

  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/status=logged-out/);
  const authCookiesAfterLogout = (await context.cookies()).filter((cookie) =>
    cookie.name.includes("auth-token"),
  );
  expect(authCookiesAfterLogout).toEqual([]);

  await page.goto("/feed");
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/profile/media/banner")).status()).toBe(
    401,
  );
});
