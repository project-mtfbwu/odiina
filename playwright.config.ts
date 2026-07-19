import { defineConfig } from "@playwright/test";

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
    command: "corepack pnpm dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "mobile-320",
      grepInvert: /@authenticated/,
      use: { viewport: { width: 320, height: 720 } },
    },
    {
      name: "mobile-390",
      grepInvert: /@authenticated/,
      use: { viewport: { width: 390, height: 844 } },
    },
    {
      name: "tablet-768",
      grepInvert: /@authenticated/,
      use: {
        browserName: "chromium",
        hasTouch: true,
        isMobile: true,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-960",
      grepInvert: /@authenticated/,
      use: { viewport: { width: 960, height: 900 } },
    },
    {
      name: "desktop-1200",
      grepInvert: /@authenticated/,
      use: { viewport: { width: 1200, height: 900 } },
    },
    {
      name: "desktop-1440",
      grepInvert: /@authenticated/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "authenticated-desktop",
      grep: /@authenticated/,
      use: { viewport: { width: 1200, height: 900 } },
    },
  ],
});
