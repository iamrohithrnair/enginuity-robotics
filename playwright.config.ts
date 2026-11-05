// Configures single-worker Chrome tests against a local Next.js server.
import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.RC_PORT ?? 3100);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,  
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1600, height: 960 },
    launchOptions: {
      executablePath: process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      args: ["--use-angle=metal", "--ignore-gpu-blocklist"],
    },
  },
  webServer: {
    command: `npx next dev -p ${PORT}`,
    port: PORT,
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
