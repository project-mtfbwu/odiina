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
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
      use: { viewport: { width: 320, height: 720 } },
    },
    {
      name: "mobile-390",
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-768",
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-960",
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
      use: { viewport: { width: 960, height: 900 } },
    },
    {
      name: "desktop-1200",
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
      use: { viewport: { width: 1200, height: 900 } },
    },
    {
      name: "desktop-1440",
      grepInvert: /@authenticated|@calendar|@photo-layout|@camera-capability/,
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
  ],
});
