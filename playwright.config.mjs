import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "line",
  use: {
    baseURL,
    colorScheme: "dark",
    reducedMotion: "no-preference",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    viewport: { width: 500, height: 600 },
  },
  projects: [
    { colorScheme: "dark", name: "webkit-dark", reducedMotion: "no-preference" },
    { colorScheme: "light", name: "webkit-light-reduced-motion", reducedMotion: "reduce" },
  ].map(({ colorScheme, name, reducedMotion }) => ({
    name,
    use: {
      ...devices["Desktop Safari"],
      colorScheme,
      reducedMotion,
      viewport: { width: 500, height: 600 },
    },
  })),
  webServer: {
    command: "node tests/ui/server.mjs",
    url: `${baseURL}/__health`,
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
