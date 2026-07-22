import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

async function expectAccessible(page: Page) {
  await expect(page).toHaveTitle(/Odiina/);
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function installSyntheticCamera(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __odiinaVideoTrackStops: number;
      __odiinaAudioTrackStops: number;
      __odiinaCameraRequests: string[];
    };
    state.__odiinaVideoTrackStops = 0;
    state.__odiinaAudioTrackStops = 0;
    state.__odiinaCameraRequests = [];
    const makeStream = (withAudio: boolean, deviceId: string) => {
      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 360;
      const context = canvas.getContext("2d")!;
      let frame = 0;
      const render = () => {
        context.fillStyle = frame % 2 ? "#1f7a5a" : "#5637a5";
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = "white";
        context.font = "32px sans-serif";
        context.fillText("Synthetic private video", 80, 180);
        frame += 1;
      };
      render();
      const timer = window.setInterval(render, 80);
      const stream = canvas.captureStream(15);
      const videoTrack = stream.getVideoTracks()[0];
      Object.defineProperty(videoTrack, "getSettings", {
        configurable: true,
        value: () => ({ deviceId, width: 640, height: 360, frameRate: 15 }),
      });
      const originalVideoStop = videoTrack.stop.bind(videoTrack);
      videoTrack.stop = () => {
        state.__odiinaVideoTrackStops += 1;
        window.clearInterval(timer);
        originalVideoStop();
      };
      if (withAudio) {
        const audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const destination = audioContext.createMediaStreamDestination();
        oscillator.connect(destination);
        oscillator.start();
        const audioTrack = destination.stream.getAudioTracks()[0];
        const originalAudioStop = audioTrack.stop.bind(audioTrack);
        audioTrack.stop = () => {
          state.__odiinaAudioTrackStops += 1;
          oscillator.stop();
          void audioContext.close();
          originalAudioStop();
        };
        stream.addTrack(audioTrack);
      }
      return stream;
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          const exact =
            typeof constraints.video === "object" &&
            typeof constraints.video.deviceId === "object" &&
            "exact" in constraints.video.deviceId
              ? String(constraints.video.deviceId.exact)
              : "rear-camera";
          state.__odiinaCameraRequests.push(exact);
          return makeStream(Boolean(constraints.audio), exact);
        },
        enumerateDevices: async () => [
          {
            deviceId: "rear-camera",
            kind: "videoinput",
            label: "Rear camera",
            groupId: "one",
            toJSON: () => ({}),
          },
          {
            deviceId: "front-camera",
            kind: "videoinput",
            label: "Front camera",
            groupId: "two",
            toJSON: () => ({}),
          },
        ],
      },
    });
  });
}

async function observeNativeCameraLifecycle(page: Page) {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __odiinaVideoTrackStops: number;
      __odiinaAudioTrackStops: number;
    };
    state.__odiinaVideoTrackStops = 0;
    state.__odiinaAudioTrackStops = 0;
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async (constraints: MediaStreamConstraints) => {
        const stream = await original(constraints);
        for (const track of stream.getTracks()) {
          const originalStop = track.stop.bind(track);
          track.stop = () => {
            if (track.kind === "video") state.__odiinaVideoTrackStops += 1;
            if (track.kind === "audio") state.__odiinaAudioTrackStops += 1;
            originalStop();
          };
        }
        return stream;
      },
    });
  });
}

function syntheticSelectedVideo() {
  const base64 = readFileSync(
    resolve(process.cwd(), "tests/fixtures/video/silent.webm.b64"),
    "utf8",
  ).trim();
  return Buffer.from(base64, "base64");
}

async function chooseExistingVideo(page: Page, buffer: Buffer) {
  const chooserReady = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Choose video" }).click();
  const chooser = await chooserReady;
  await chooser.setFiles({
    name: "selected.webm",
    mimeType: "video/webm",
    buffer,
  });
}

test("@video-layout keeps active recording and local review within responsive bounds", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await observeNativeCameraLifecycle(page);
  await page.goto("/feed");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog).toContainText("Camera and microphone ready");
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".video-recording-row strong").textContent())
    .toBe("0:01");
  const layout = await page.evaluate(() => ({
    noHorizontalOverflow:
      document.documentElement.scrollWidth <= window.innerWidth + 1,
    dialogWithinViewport:
      (document.querySelector(".video-capture-modal")?.getBoundingClientRect()
        .right ?? Infinity) <=
      window.innerWidth + 1,
    controlsVisible:
      (document
        .querySelector(".video-live-state .camera-actions")
        ?.getBoundingClientRect().bottom ?? Infinity) <=
      window.innerHeight + 1,
  }));
  expect(layout).toEqual({
    noHorizontalOverflow: true,
    dialogWithinViewport: true,
    controlsVisible: true,
  });
  await expectAccessible(page);
  if (testInfo.project.name === "video-layout-390") {
    await page.screenshot({
      path: testInfo.outputPath("video-active-recording.png"),
    });
  }
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByLabel("Review private video draft")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Restart" })).toBeVisible();
  await expectAccessible(page);
  await dialog.getByRole("button", { name: "Discard" }).click();
  await expect(page.getByRole("button", { name: "Add media" })).toBeFocused();
});

test("@video-capability offers native fallback without MediaRecorder", async ({
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
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "cannot make a supported private recording",
  );
  await expect(
    dialog.getByRole("button", { name: "Use device camera picker" }),
  ).toBeVisible();
  await expectAccessible(page);
});

test("@video-capability recovers from microphone denial with camera-only capture", async ({
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
        getUserMedia: async (constraints: MediaStreamConstraints) => {
          if (constraints.audio)
            throw new DOMException("mock microphone denial", "NotAllowedError");
          const canvas = document.createElement("canvas");
          const stream = canvas.captureStream(10);
          const track = stream.getVideoTracks()[0];
          Object.defineProperty(track, "getSettings", {
            value: () => ({ deviceId: "camera-only" }),
          });
          return stream;
        },
        enumerateDevices: async () => [],
      },
    });
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "permission was denied",
  );
  await expect(
    dialog.getByRole("button", { name: "Retry without microphone" }),
  ).toBeVisible();
  await dialog
    .getByRole("button", { name: "Retry without microphone" })
    .click();
  await expect(dialog).toContainText("Camera ready without microphone audio");
  await dialog.getByRole("button", { name: "Cancel" }).click();
});

test("@video-capability switches cameras before recording and releases both streams", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await installSyntheticCamera(page);
  await page.goto("/feed");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  expect(
    await page.evaluate(
      () =>
        (window as typeof window & { __odiinaCameraRequests: string[] })
          .__odiinaCameraRequests,
    ),
  ).toEqual([]);
  await dialog
    .getByRole("checkbox", { name: "Include microphone audio" })
    .click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(
    dialog.getByRole("button", { name: "Switch camera" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Switch camera" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaCameraRequests: string[] })
            .__odiinaCameraRequests,
      ),
    )
    .toContain("front-camera");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaVideoTrackStops: number })
            .__odiinaVideoTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(2);
});

test("@video-capability stops backgrounded recording and preserves review", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await observeNativeCameraLifecycle(page);
  await page.goto("/feed");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".video-recording-row strong").textContent())
    .toBe("0:01");
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect(dialog.getByLabel("Review private video draft")).toBeVisible();
  await expect(dialog.getByRole("status")).toContainText(
    "stopped when Odiina moved to the background",
  );
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaVideoTrackStops: number })
            .__odiinaVideoTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await dialog.getByRole("button", { name: "Discard" }).click();
});

test("@video-capability releases camera after recorder initialization failure", async ({
  page,
}) => {
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup.",
  );
  await observeNativeCameraLifecycle(page);
  await page.addInitScript(() => {
    class BrokenMediaRecorder {
      static isTypeSupported() {
        return true;
      }

      constructor() {
        throw new DOMException("mock recorder failure", "NotSupportedError");
      }
    }
    Object.defineProperty(window, "MediaRecorder", {
      configurable: true,
      value: BrokenMediaRecorder,
    });
  });
  await page.goto("/feed");
  await page.getByRole("button", { name: "Add media" }).click();
  await page.getByRole("menuitem", { name: "Record video" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "recorder could not initialize",
  );
  await expect(
    dialog.getByRole("button", { name: "Use device camera picker" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaVideoTrackStops: number })
            .__odiinaVideoTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(1);
});

test("@video-journey completes selected and recorded private video flow", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(360_000);
  test.skip(
    process.env.ODIINA_E2E !== "1",
    "Requires authenticated local setup and media worker.",
  );
  await observeNativeCameraLifecycle(page);
  await page.goto("/feed");
  const fixture = syntheticSelectedVideo();
  const authorizations: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/api/media/video/authorize"))
      authorizations.push(request.url());
  });
  await chooseExistingVideo(page, fixture);
  await expect(page.getByText("Video draft")).toBeVisible();
  expect(authorizations).toEqual([]);
  await page.getByRole("button", { name: "Discard video" }).click();
  await chooseExistingVideo(page, fixture);
  const body = `Private ${testInfo.project.name} video Entry ${crypto.randomUUID()}`;
  await page.getByLabel("Entry text (optional with private media)").fill(body);
  await page.getByRole("button", { name: "Add to today" }).click();
  const card = page.locator("article").filter({ hasText: body });
  const player = card.getByLabel(/Private video, .*silent/);
  await expect(player).toBeVisible({
    timeout: 180_000,
  });
  if (!testInfo.project.name.includes("mobile")) {
    await expect(card.getByText("Video", { exact: true })).toBeVisible();
  }
  expect(authorizations).toHaveLength(1);
  await expectAccessible(page);
  expect(
    await player.evaluate((element: HTMLVideoElement) => ({
      autoplay: element.autoplay,
      controls: element.controls,
      playsInline: element.playsInline,
      preload: element.preload,
    })),
  ).toEqual({
    autoplay: false,
    controls: true,
    playsInline: true,
    preload: "none",
  });
  if (!testInfo.project.name.includes("mobile")) {
    await player.evaluate((element: HTMLVideoElement) => element.play());
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.currentTime),
      )
      .toBeGreaterThan(0);
    await player.evaluate((element: HTMLVideoElement) => element.pause());
    await expect
      .poll(() =>
        player.evaluate((element: HTMLVideoElement) => element.paused),
      )
      .toBe(true);
  }
  const feedPlayer = card.locator(".video-player");
  await feedPlayer.evaluate((element) => {
    element.scrollIntoView({ block: "start" });
    window.scrollBy(0, -96);
  });
  await expect
    .poll(async () => {
      const playerBox = await feedPlayer.boundingBox();
      const composerBox = await page.locator(".composer-shell").boundingBox();
      return Boolean(
        playerBox &&
        composerBox &&
        playerBox.y >= 0 &&
        playerBox.y + playerBox.height <= composerBox.y,
      );
    })
    .toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("video-feed-ready.png"),
  });
  await card.getByRole("link", { name: /Open Entry from/ }).click();
  await expect(page).toHaveURL(/\/entries\/[0-9a-f-]{36}$/);
  const entryId = page.url().match(/\/entries\/([0-9a-f-]{36})$/)?.[1];
  expect(entryId).toBeTruthy();
  const attachmentId = await page
    .locator(".video-player video")
    .first()
    .evaluate(
      (element: HTMLVideoElement) =>
        element.src.match(/\/api\/media\/([0-9a-f-]{36})/)?.[1],
    );
  expect(attachmentId).toBeTruthy();
  const range = await page.request.get(`/api/media/${attachmentId}`, {
    headers: { Range: "bytes=0-31" },
  });
  expect(range.status()).toBe(206);
  expect(range.headers()["content-type"]).toContain("video/mp4");
  expect(range.headers()["cache-control"]).toContain("no-store");
  expect((await range.body()).byteLength).toBe(32);
  const poster = await page.request.get(
    `/api/media/${attachmentId}?variant=poster`,
  );
  expect(poster.status()).toBe(200);
  expect(poster.headers()["content-type"]).toContain("image/jpeg");
  await page.screenshot({
    path: testInfo.outputPath("video-detail-ready.png"),
  });

  await page
    .locator(`a[href="/entries/${entryId}?mode=edit"]`)
    .getByText("Edit Entry", { exact: true })
    .click();
  await page.getByRole("button", { name: "Record replacement" }).click();
  const dialog = page.getByRole("dialog", { name: "Record a private video" });
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".video-recording-row strong").textContent())
    .toBe("0:01");
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByLabel("Review private video draft")).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaVideoTrackStops: number })
            .__odiinaVideoTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __odiinaAudioTrackStops: number })
            .__odiinaAudioTrackStops,
      ),
    )
    .toBeGreaterThanOrEqual(1);
  await page.screenshot({
    path: testInfo.outputPath("video-local-review.png"),
  });
  await dialog.getByRole("button", { name: "Record again" }).click();
  await dialog.getByRole("button", { name: "Continue" }).click();
  await dialog.getByRole("button", { name: "Start recording" }).click();
  await expect
    .poll(() => dialog.locator(".video-recording-row strong").textContent())
    .toBe("0:01");
  await dialog.getByRole("button", { name: "Stop" }).click();
  await expect(dialog.getByLabel("Review private video draft")).toBeVisible();
  await dialog.getByRole("button", { name: "Use video" }).click();
  await expect(page.getByText("Unsaved video draft")).toBeVisible();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 2.*Current/ }),
  ).toBeVisible({ timeout: 180_000 });
  expect(authorizations).toHaveLength(2);
  await expect(page.locator(".video-player")).toHaveCount(3);
  if (!testInfo.project.name.includes("mobile")) {
    await page.screenshot({
      path: testInfo.outputPath("video-revision-history.png"),
    });
  }

  await page.getByRole("link", { name: "Profile", exact: true }).click();
  const countWithVideo = Number(
    await page
      .locator(".profile-stat-grid > div")
      .filter({ hasText: "Video Entries" })
      .locator("dd")
      .textContent(),
  );
  expect(countWithVideo).toBeGreaterThan(0);
  await page.goto(`/entries/${entryId}?mode=edit`);
  await page
    .getByRole("button", { name: "Remove video from this revision" })
    .click();
  await page.getByRole("button", { name: "Save revision" }).click();
  await expect(
    page.getByRole("heading", { name: /Revision 3.*Current/ }),
  ).toBeVisible();
  await expect(page.locator(".video-player")).toHaveCount(2);

  await page.getByRole("link", { name: "Calendar" }).click();
  await expect(
    page.locator("article").filter({ hasText: body }).first(),
  ).toBeVisible();
  await page.getByRole("link", { name: "Profile", exact: true }).click();
  const countWithoutVideo = Number(
    await page
      .locator(".profile-stat-grid > div")
      .filter({ hasText: "Video Entries" })
      .locator("dd")
      .textContent(),
  );
  expect(countWithoutVideo).toBe(countWithVideo - 1);
  await page.getByRole("link", { name: "Feed", exact: true }).click();
  const restoredCard = page.locator("article").filter({ hasText: body });
  await restoredCard
    .getByRole("button", { name: "Move Entry to Trash" })
    .click();
  await page.getByRole("button", { name: "Move to Trash" }).click();
  await page.getByRole("link", { name: "Trash" }).click();
  const trashed = page.locator("article").filter({ hasText: body });
  await expect(trashed).toBeVisible();
  await trashed.getByRole("button", { name: "Restore Entry" }).click();
  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Log out of Odiina" }).click();
  await expect(page).toHaveURL(/status=logged-out/);
  expect(
    (await context.cookies()).filter((cookie) =>
      cookie.name.includes("auth-token"),
    ),
  ).toEqual([]);
});
