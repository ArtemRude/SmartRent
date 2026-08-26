import { spawnSync } from "node:child_process";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const status = spawnSync("supabase", ["status", "-o", "json"], {
  encoding: "utf8",
});

if (status.error?.code === "ENOENT") {
  fail("Supabase CLI не найден. Установите его и повторите запуск.");
}

if (status.status !== 0) {
  fail("Локальный Supabase не запущен. Сначала выполните: supabase start");
}

const jsonStart = status.stdout.indexOf("{");
const jsonEnd = status.stdout.lastIndexOf("}");
if (jsonStart === -1 || jsonEnd <= jsonStart) {
  fail("Не удалось прочитать параметры локального Supabase.");
}

let localStatus;
try {
  localStatus = JSON.parse(status.stdout.slice(jsonStart, jsonEnd + 1));
} catch {
  fail("Supabase CLI вернул некорректный JSON.");
}

const apiUrl = localStatus.API_URL;
const publishableKey = localStatus.PUBLISHABLE_KEY ?? localStatus.ANON_KEY;

if (typeof apiUrl !== "string" || typeof publishableKey !== "string") {
  fail("В статусе Supabase отсутствуют API_URL или PUBLISHABLE_KEY.");
}

const parsedUrl = new URL(apiUrl);
if (
  parsedUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)
) {
  fail("E2E-тесты авторизации разрешено запускать только с локальным Supabase.");
}

const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test"], {
  stdio: "inherit",
  env: {
    ...process.env,
    E2E_SUPABASE_URL: apiUrl,
    E2E_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  },
});

process.exit(result.status ?? 1);
