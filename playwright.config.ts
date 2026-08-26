import { defineConfig, devices } from "@playwright/test";

const baseURL = "http://127.0.0.1:4173";
const localSupabaseUrl = process.env["E2E_SUPABASE_URL"];
const localSupabaseKey = process.env["E2E_SUPABASE_PUBLISHABLE_KEY"];

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

if (Boolean(localSupabaseUrl) !== Boolean(localSupabaseKey)) {
  throw new Error("E2E_SUPABASE_URL and E2E_SUPABASE_PUBLISHABLE_KEY must be provided together.");
}

if (localSupabaseUrl && !isLoopbackUrl(localSupabaseUrl)) {
  throw new Error("E2E authentication tests may only use a loopback Supabase URL.");
}

const webServerEnv =
  localSupabaseUrl && localSupabaseKey
    ? {
        VITE_SUPABASE_URL: localSupabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: localSupabaseKey,
        SUPABASE_URL: localSupabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: localSupabaseKey,
      }
    : undefined;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  fullyParallel: false,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    channel: "chrome",
    screenshot: "only-on-failure",
    trace: "retain-on-first-failure",
  },
  webServer: {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 4173`,
    url: baseURL,
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    ...(webServerEnv ? { env: webServerEnv } : {}),
  },
});
