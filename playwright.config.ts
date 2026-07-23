import { defineConfig } from "@playwright/test";

const useProductionServer = process.env.ODIINA_E2E_SERVER_MODE === "production";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  webServer: {
    command: useProductionServer ? "corepack pnpm start" : "corepack pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !useProductionServer && !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile-320",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: { viewport: { width: 320, height: 720 } },
    },
    {
      name: "mobile-390",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-768",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-960",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: { viewport: { width: 960, height: 900 } },
    },
    {
      name: "desktop-1200",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: { viewport: { width: 1200, height: 900 } },
    },
    {
      name: "desktop-1440",
      grepInvert:
        /@authenticated|@calendar|@profile|@photo-layout|@camera-capability|@voice|@video|@place|@search|@tags|@ai/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "authenticated-desktop",
      grep: /@authenticated/,
      use: { viewport: { width: 1200, height: 900 } },
    },
    {
      name: "authenticated-mobile",
      grep: /@authenticated/,
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "calendar-authenticated-desktop",
      grep: /@calendar-journey/,
      use: { viewport: { width: 1200, height: 900 } },
    },
    {
      name: "calendar-authenticated-mobile",
      grep: /@calendar-journey/,
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "calendar-setup",
      grep: /@calendar-setup/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "calendar-layout-320",
      grep: /@calendar-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 320, height: 720 },
      },
    },
    {
      name: "calendar-layout-768",
      grep: /@calendar-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "calendar-layout-960",
      grep: /@calendar-layout/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 960, height: 900 },
      },
    },
    {
      name: "calendar-layout-1440",
      grep: /@calendar-layout/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "profile-layout-320",
      grep: /@profile-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 320, height: 720 },
      },
    },
    {
      name: "profile-layout-768",
      grep: /@profile-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "profile-layout-960",
      grep: /@profile-layout/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 960, height: 900 },
      },
    },
    {
      name: "profile-layout-1440",
      grep: /@profile-layout/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `photo-layout-${width}`,
      grep: /@photo-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 900,
        },
      },
    })),
    {
      name: "camera-capability-mobile",
      grep: /@camera-capability/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1440].map((width) => ({
      name: `voice-layout-${width}`,
      grep: /@voice-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 900,
        },
      },
    })),
    {
      name: "voice-capability-mobile",
      grep: /@voice-capability/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "voice-journey-desktop",
      grep: /@voice-journey/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1200, height: 900 },
      },
    },
    {
      name: "voice-journey-mobile",
      grep: /@voice-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `video-layout-${width}`,
      grep: /@video-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 1000,
        },
      },
    })),
    {
      name: "video-capability-mobile",
      grep: /@video-capability/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "video-journey-desktop",
      grep: /@video-journey/,
      dependencies: ["calendar-setup"],
      use: {
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "video-journey-mobile",
      grep: /@video-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        permissions: ["camera", "microphone"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `place-layout-${width}`,
      grep: /@place-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 1000,
        },
      },
    })),
    {
      name: "place-capability-mobile",
      grep: /@place-capability/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        permissions: ["geolocation"],
        geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 24 },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "place-journey-desktop",
      grep: /@place-journey/,
      dependencies: ["calendar-setup"],
      use: {
        permissions: ["geolocation"],
        geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 24 },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "place-journey-mobile",
      grep: /@place-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        permissions: ["geolocation"],
        geolocation: { latitude: 12.9716, longitude: 77.5946, accuracy: 24 },
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `search-layout-${width}`,
      grep: /@search-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 1000,
        },
      },
    })),
    {
      name: "search-journey-desktop",
      grep: /@search-journey/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "search-journey-mobile",
      grep: /@search-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `tags-layout-${width}`,
      grep: /@tags-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 1000,
        },
      },
    })),
    {
      name: "tags-journey-desktop",
      grep: /@tags-journey/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "tags-journey-mobile",
      grep: /@tags-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    ...[320, 390, 768, 960, 1200, 1440].map((width) => ({
      name: `ai-layout-${width}`,
      grep: /@ai-layout/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium" as const,
        hasTouch: width <= 768,
        isMobile: width <= 768,
        storageState: "test-results/calendar-auth.json",
        viewport: {
          width,
          height: width <= 390 ? 844 : width <= 768 ? 1024 : 1000,
        },
      },
    })),
    {
      name: "ai-journey-desktop",
      grep: /@ai-journey/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
    {
      name: "ai-journey-mobile",
      grep: /@ai-journey/,
      dependencies: ["calendar-setup"],
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "ai-provider-journey",
      grep: /@ai-provider-journey/,
      dependencies: ["calendar-setup"],
      use: {
        storageState: "test-results/calendar-auth.json",
        viewport: { width: 1440, height: 1000 },
      },
    },
  ],
});
