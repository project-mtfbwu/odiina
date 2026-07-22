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
    const state = window as typeof window & { __odiinaMicTrackStops: number };
    state.__odiinaMicTrackStops = 0;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          const context = new AudioContext();
          const destination = context.createMediaStreamDestination();
          const oscillator = context.createOscillator();
          const gain = context.createGain();
          oscillator.frequency.value = 440;
          gain.gain.value = 0.08;
          oscillator.connect(gain).connect(destination);
          oscillator.start();
          const track = destination.stream.getAudioTracks()[0];
          const stop = track.stop.bind(track);
          track.stop = () => {
            state.__odiinaMicTrackStops += 1;
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

test("@voice-journey completes private voice capture through logout", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(240_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup and the media worker.",
  );
  await installSyntheticMicrophone(page);
  const voiceBody = `Private ${testInfo.project.name} voice Entry`;
  const revisedVoiceBody = `${voiceBody} revised`;
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed$/);

  await page.getByRole("button", { name: "Record a voice note" }).click();
  let dialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await expect(dialog).toContainText(
    "Recording then starts only when you press Start recording",
  );
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toContainText("Microphone ready");
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".voice-timer").textContent())
    .toBe("0:01");
  await dialog.getByRole("button", { name: "Cancel recording" }).click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaMicTrackStops: number })
            .__odiinaMicTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await expect(
    page.getByRole("button", { name: "Record a voice note" }),
  ).toBeFocused();

  const authorizations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/media/audio/authorize")) {
      authorizations.push(request.url());
    }
  });
  await page.getByRole("button", { name: "Record a voice note" }).click();
  dialog = page.getByRole("dialog", { name: "Record a private voice note" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toContainText("Microphone ready");
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".voice-timer").textContent())
    .toBe("0:02");
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByText("Review before using")).toBeVisible();
  await dialog.getByRole("button", { name: "Play" }).click();
  await expect(dialog.getByRole("button", { name: "Pause" })).toBeVisible();
  await dialog.getByRole("button", { name: "Pause" }).click();
  await dialog.getByRole("button", { name: "Use voice note" }).click();
  await expect(page.getByText("Voice-note draft")).toBeVisible();
  expect(authorizations).toEqual([]);

  await page
    .getByLabel("Entry text (optional with private media)")
    .fill(voiceBody);
  await page.getByRole("button", { name: "Add to today" }).click();
  const voiceCard = page.locator("article").filter({ hasText: voiceBody });
  await expect(voiceCard.getByText("Voice note", { exact: true })).toBeVisible({
    timeout: 120_000,
  });
  expect(authorizations).toHaveLength(1);
  await expectAccessible(page);
  await voiceCard
    .getByRole("button", { name: "Play private voice note" })
    .click();
  await expect(
    voiceCard.getByRole("button", { name: "Pause private voice note" }),
  ).toBeVisible();
  await voiceCard
    .getByRole("button", { name: "Pause private voice note" })
    .click();

  await voiceCard.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/);
  const entryId = page.url().match(/\/entries\/([0-9a-f-]{36})$/)?.[1];
  expect(entryId).toBeTruthy();
  const attachmentId = await page
    .locator(".voice-player audio")
    .first()
    .evaluate(
      (audio) =>
        (audio as HTMLAudioElement).src.match(
          /\/api\/media\/([0-9a-f-]{36})/,
        )?.[1],
    );
  expect(attachmentId).toBeTruthy();
  const range = await page.request.get(`/api/media/${attachmentId}`, {
    headers: { Range: "bytes=0-9" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-type"]).toContain("audio/mp4");
  expect(range.headers()["cache-control"]).toContain("no-store");
  expect(range.headers()["accept-ranges"]).toBe("bytes");
  expect((await range.body()).byteLength).toBe(10);

  await page
    .locator(`a[href="/entries/${entryId}?mode=edit"]`)
    .getByText("Edit Entry", { exact: true })
    .click();
  await page.getByLabel("Entry text").fill(revisedVoiceBody);
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible();
  expect(
    await page.getByText("Voice note", { exact: true }).count(),
  ).toBeGreaterThanOrEqual(2);

  await page.getByRole("link", { name: "Back to Feed" }).click();
  const revisedCard = page
    .locator("article")
    .filter({ hasText: revisedVoiceBody });
  await revisedCard
    .getByRole("button", { name: "Move Entry to Trash" })
    .click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("link", { name: "Trash" }).click();
  const trashedCard = page
    .locator("article")
    .filter({ hasText: revisedVoiceBody });
  await expect(
    trashedCard.getByText("Voice note", { exact: true }),
  ).toBeVisible();
  await trashedCard.getByRole("button", { name: "Restore Entry" }).click();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  const voiceEntryCount = Number(
    await page
      .locator(".profile-stat-grid > div")
      .filter({ hasText: "Voice Entries" })
      .locator("dd")
      .textContent(),
  );
  expect(voiceEntryCount).toBeGreaterThanOrEqual(1);
  await expectAccessible(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/status=logged-out/);
  expect(
    (await context.cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    ),
  ).toEqual([]);
});

test("@voice-layout keeps voice capture private and usable", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.goto("/feed");
  await expect(page).toHaveURL(/\/feed$/);
  const fileInput = page.getByLabel("Choose an existing audio file");
  await expect(fileInput).toHaveAttribute(
    "accept",
    "audio/webm,audio/ogg,audio/mp4,audio/x-m4a",
  );
  await page.getByRole("button", { name: "Record a voice note" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await expect(dialog).toContainText(
    "Your draft stays on this device until you use it and send the Entry.",
  );
  await expect(dialog.getByRole("button", { name: "Continue" })).toBeVisible();
  const layout = await page.evaluate(() => ({
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    dialogWithinViewport:
      (document.querySelector(".voice-capture-modal")?.getBoundingClientRect()
        .right ?? Infinity) <=
      window.innerWidth + 1,
  }));
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    dialogWithinViewport: true,
  });
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("button", { name: "Record a voice note" }),
  ).toBeFocused();
});

test("@voice-capability offers a file fallback without MediaRecorder", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Record a voice note" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "does not support private live recording",
  );
  await expect(
    dialog.getByRole("button", { name: "Choose audio file" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("@voice-capability explains denied microphone permission", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          throw new DOMException("mock microphone denial", "NotAllowedError");
        },
      },
    });
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Record a voice note" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Record a private voice note",
  });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Microphone access was denied or dismissed",
  );
  await expect(
    dialog.getByRole("button", { name: "Retry microphone" }),
  ).toBeVisible();
  await expectAccessible(page);
});
