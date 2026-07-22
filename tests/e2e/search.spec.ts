import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

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

async function installSyntheticMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const context = new AudioContext();
          const destination = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          oscillator.connect(destination);
          oscillator.start();
          const track = destination.stream.getAudioTracks()[0];
          const stop = track.stop.bind(track);
          track.stop = () => {
            oscillator.stop();
            void context.close();
            stop();
          };
          return destination.stream;
        },
      },
    });
  });
}

async function chooseExistingVideo(page: Page) {
  const buffer = Buffer.from(
    readFileSync(
      resolve(process.cwd(), "tests/fixtures/video/silent.webm.b64"),
      "utf8",
    ).trim(),
    "base64",
  );
  const chooserReady = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Choose video" }).click();
  const chooser = await chooserReady;
  await chooser.setFiles({
    name: "search-fixture.webm",
    mimeType: "video/webm",
    buffer,
  });
}

async function openPlacePicker(page: Page) {
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Add place" }).click();
  await expect(
    page.getByRole("dialog", { name: "Add a private place" }),
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
  test.setTimeout(900_000);
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
  const photoBody = `Search photo ${suffix} ${runId}`;
  const voiceBody = `Search voice ${suffix} ${runId}`;
  const videoBody = `Search video ${suffix} ${runId}`;
  const placeBody = `Search place ${suffix} ${runId}`;
  const placeName = `Recall Place ${suffix} ${runId}`;
  const occurrenceDate = new Date().toISOString().slice(0, 10);

  await installSyntheticMicrophone(page);
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

  const composerText = page.getByLabel(
    "Entry text (optional with private media)",
  );
  await composerText.fill(photoBody);
  await expect(
    page.getByText(
      `${(100_000 - photoBody.length).toLocaleString("en-US")} characters left`,
    ),
  ).toBeVisible();

  const photo = await sharp({
    create: {
      width: 800,
      height: 500,
      channels: 3,
      background: { r: 72, g: 54, b: 190 },
    },
  })
    .jpeg()
    .toBuffer();
  await page.getByLabel("Choose one or more photos").setInputFiles({
    name: "search-photo.jpg",
    mimeType: "image/jpeg",
    buffer: photo,
  });
  await expect(page.getByText("1 of 5 photo selected")).toBeVisible();
  await page.getByRole("button", { name: /Add to/ }).click();
  const photoCard = page
    .locator("article.entry-card")
    .filter({ hasText: photoBody });
  await expect(photoCard.getByAltText(/Photo attached to Entry/)).toBeVisible({
    timeout: 120_000,
  });

  await page.getByRole("button", { name: "Record a voice note" }).click();
  const voiceDialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await voiceDialog.getByRole("button", { name: "Continue" }).click();
  await expect(voiceDialog).toContainText("Microphone ready");
  await voiceDialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => voiceDialog.locator(".voice-timer").textContent())
    .toBe("0:01");
  await voiceDialog.getByRole("button", { name: "Stop" }).click();
  await voiceDialog.getByRole("button", { name: "Use voice note" }).click();
  await page
    .getByLabel("Entry text (optional with private media)")
    .fill(voiceBody);
  await page.getByRole("button", { name: /Add to/ }).click();
  const voiceCard = page
    .locator("article.entry-card")
    .filter({ hasText: voiceBody });
  await expect(voiceCard.getByText("Voice note", { exact: true })).toBeVisible({
    timeout: 120_000,
  });

  await chooseExistingVideo(page);
  await expect(page.getByText("Video draft")).toBeVisible();
  await page
    .getByLabel("Entry text (optional with private media)")
    .fill(videoBody);
  await page.getByRole("button", { name: /Add to/ }).click();
  const videoCard = page
    .locator("article.entry-card")
    .filter({ hasText: videoBody });
  await expect(videoCard.locator(".video-player video")).toBeVisible({
    timeout: 180_000,
  });

  await openPlacePicker(page);
  await page.getByLabel("Place name").fill(placeName);
  await page
    .getByLabel("Area or address (optional)")
    .fill("Synthetic search district");
  await page.getByRole("button", { name: "Attach place" }).click();
  await page
    .getByLabel("Entry text (optional with private media)")
    .fill(placeBody);
  await page.getByRole("button", { name: /Add to/ }).click();
  await expect(
    page.locator("article.entry-card").filter({ hasText: placeName }),
  ).toContainText(placeBody);

  for (const [media, expectedText] of [
    ["text", body],
    ["image", photoBody],
    ["audio", voiceBody],
    ["video", videoBody],
    ["place", placeBody],
  ] as const) {
    await page.goto(`/search?media=${media}&sort=newest`);
    await expect(
      page.locator("article.entry-card").filter({ hasText: expectedText }),
    ).toBeVisible();
  }
  await page.goto("/search?media=image&media=audio&sort=newest");
  await expect(
    page.locator("article.entry-card").filter({ hasText: photoBody }),
  ).toBeVisible();
  await expect(
    page.locator("article.entry-card").filter({ hasText: voiceBody }),
  ).toBeVisible();
  await page.goto("/search?hasPlace=1&sort=newest");
  await expect(
    page.locator("article.entry-card").filter({ hasText: placeName }),
  ).toBeVisible();
  await page.goto(`/search?q=${encodeURIComponent(placeName)}&sort=relevance`);
  await expect(
    page.locator("article.entry-card").filter({ hasText: placeName }),
  ).toBeVisible();
  await page.goto(
    `/search?from=${occurrenceDate}&to=${occurrenceDate}&sort=newest`,
  );
  await expect(
    page.locator("article.entry-card").filter({ hasText: body }),
  ).toBeVisible();

  const csrfToken = (await page.context().cookies()).find(
    (cookie) => cookie.name === "odiina_csrf",
  )?.value;
  expect(csrfToken).toBeTruthy();
  for (let index = 0; index < 21; index += 1) {
    const occurredAt = new Date(Date.now() - index * 60_000).toISOString();
    const response = await page.request.post("/api/entries", {
      headers: {
        origin: "http://localhost:3000",
        "x-odiina-csrf": csrfToken!,
      },
      data: {
        clientRequestId: crypto.randomUUID(),
        bodyText: `Pagination ${runId} item ${index}`,
        tags: [],
        occurredAt,
        occurredTimezone: "UTC",
        occurredLocalDate: occurredAt.slice(0, 10),
        occurredUtcOffsetMinutes: 0,
      },
    });
    expect(response.ok()).toBe(true);
  }
  await page.goto(
    `/search?q=${encodeURIComponent(`Pagination ${runId}`)}&sort=newest`,
  );
  const firstPageBodies = await page
    .locator("article.entry-card .entry-body")
    .allTextContents();
  expect(firstPageBodies).toHaveLength(20);
  await page.getByRole("link", { name: "Load more results" }).click();
  await expect(page).toHaveURL(/(?:\?|&)cursor=/);
  await expect(page.locator("article.entry-card .entry-body")).toHaveCount(1);
  const secondPageBodies = await page
    .locator("article.entry-card .entry-body")
    .allTextContents();
  expect(secondPageBodies).toHaveLength(1);
  expect(firstPageBodies).not.toContain(secondPageBodies[0]);

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
