import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
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

test("@ai-layout keeps private AI controls usable at certified widths", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/settings/ai");
  await expect(
    page.getByRole("heading", { level: 1, name: "Private AI" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Enable private AI processing"),
  ).not.toBeChecked();
  await expect(page.getByLabel("Allow requested transcription")).toBeDisabled();
  await expect(
    page.getByLabel("Include transcripts in private Search"),
  ).toBeDisabled();
  await expect(
    page.getByLabel("Allow requested private insights"),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expectAccessible(page);
  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-i-ai-settings-${testInfo.project.use.viewport?.width}.png`,
      fullPage: true,
    });
  }
});

test("@ai-journey explicitly enables and kills private AI without automatic work", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/settings/ai");
  const master = page.getByLabel("Enable private AI processing");
  await expect(master).not.toBeChecked();
  await master.check();
  await page.getByLabel("Allow requested transcription").check();
  await page.getByLabel("Include transcripts in private Search").check();
  await page.getByLabel("Allow requested private insights").check();
  await page.getByRole("button", { name: "Save AI choices" }).click();
  await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  await expect(page.getByText("Active jobs").locator("..")).toContainText(
    "0 / 2",
  );
  await expectAccessible(page);

  await master.uncheck();
  await expect(
    page.getByLabel("Allow requested transcription"),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Save AI choices" }).click();
  await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  await page.goto("/insights");
  await expect(
    page.getByRole("button", { name: "Generate from this snapshot" }),
  ).toBeDisabled();
  await expect(page.getByText(/Insights are unavailable/)).toBeVisible();
  await expectAccessible(page);
  if ([390, 1440].includes(testInfo.project.use.viewport?.width ?? 0)) {
    await page.screenshot({
      path: `test-results/evidence/increment-i-insights-disabled-${testInfo.project.use.viewport?.width}.png`,
      fullPage: true,
    });
  }
});

test("@ai-provider-journey transcribes, corrects, searches and cites synthetic evidence", async ({
  page,
}) => {
  test.setTimeout(240_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local media and AI workers.",
  );
  await installSyntheticMicrophone(page);
  const body = `Synthetic AI evidence ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto("/feed");
  await page.getByRole("button", { name: "Record a voice note" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toContainText("Microphone ready");
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".voice-timer").textContent())
    .toBe("0:02");
  await dialog.getByRole("button", { name: "Stop" }).click();
  await dialog.getByRole("button", { name: "Use voice note" }).click();
  await page.getByLabel("Entry text (optional with private media)").fill(body);
  await page.getByRole("button", { name: /Add to/ }).click();
  const card = page.locator("article.entry-card").filter({ hasText: body });
  await expect(card.getByText("Voice note", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  await card.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/);
  const entryUrl = page.url();
  await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Request transcript" }),
  ).toBeDisabled();

  await page.goto("/settings/ai");
  await page.getByLabel("Enable private AI processing").check();
  await page.getByLabel("Allow requested transcription").check();
  await page.getByLabel("Include transcripts in private Search").check();
  await page.getByLabel("Allow requested private insights").check();
  await page.getByRole("button", { name: "Save AI choices" }).click();
  await expect(page.getByText("Private AI settings saved.")).toBeVisible();
  await page.goto(entryUrl);
  await page.getByRole("button", { name: "Request transcript" }).click();
  await expect(
    page.getByText("Synthetic private transcript segment."),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page.getByRole("button", { name: /Play media at 1/ }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Correct this segment" })
    .first()
    .click();
  await page
    .getByLabel("Correct transcript segment")
    .fill("Corrected synthetic rehearsal");
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(
    page.getByText("Corrected synthetic rehearsal", { exact: true }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-i-transcript-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-i-transcript-390.png",
    fullPage: true,
  });

  await page.goto("/search?q=Corrected%20synthetic%20rehearsal");
  await expect(page.getByText("Matched transcript")).toBeVisible();
  await expect(
    page.locator("article.entry-card").filter({ hasText: body }),
  ).toBeVisible();

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/insights");
  await page.getByRole("button", { name: "Preview private scope" }).click();
  await expect(page.getByText(/Scope preview ready/)).toBeVisible();
  await page
    .getByRole("button", { name: "Generate from this snapshot" })
    .click();
  const saved = page.getByRole("link", {
    name: /Private evidence summary/,
  });
  await expect(saved).toBeVisible({ timeout: 60_000 });
  await saved.click();
  await expect(
    page.getByRole("heading", { name: "Evidence citations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Open accepted Entry revision/ }),
  ).toBeVisible();
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-i-insight-1440.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await expectAccessible(page);
  await page.screenshot({
    path: "test-results/evidence/increment-i-insight-390.png",
    fullPage: true,
  });

  await page.goto(entryUrl);
  await page.getByRole("button", { name: "Delete transcript" }).click();
  await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(
    page.getByRole("button", { name: "Request transcript" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Play private voice note" }).first(),
  ).toBeVisible();
});
