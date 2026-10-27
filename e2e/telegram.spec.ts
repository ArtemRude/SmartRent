import { expect, test, type BrowserContext } from "@playwright/test";
import type { TelegramOverview, TelegramTopic } from "../src/lib/telegram";

const linkId = "fc000000-0000-0000-0000-000000000001";
const token = "fixture_one_time_telegram_token_123";
function fixture() {
  const overview: TelegramOverview = {
    configured: true,
    bot_username: "smartrent_fixture_bot",
    connection: null,
    pending: null,
    enabled: false,
    topics: [
      "payments",
      "agreements",
      "requests",
      "repairs",
      "recruitment",
      "utilities",
      "objects",
    ],
    deliveries: [],
    history_truncated: false,
  };
  return {
    overview,
    missing: false,
    denied: false,
    failSave: false,
    overviewDelay: 0,
    overviewWaiting: false,
    confirmCount: 0,
    tests: 0,
    lastTopics: [] as TelegramTopic[],
  };
}
async function install(
  context: BrowserContext,
  state: ReturnType<typeof fixture>,
  role = "tenant",
) {
  const id = "fc100000-0000-0000-0000-000000000001";
  const now = new Date().toISOString();
  const user = {
    id,
    email: `${role}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    email_confirmed_at: now,
    user_metadata: { name: "Telegram User", role },
    app_metadata: { provider: "email" },
    created_at: now,
  };
  const payload = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  await context.addInitScript(
    ({ session, key }) => localStorage.setItem(key, JSON.stringify(session)),
    {
      session,
      key: `sb-${new URL(process.env["E2E_SUPABASE_URL"]!).hostname.split(".")[0]}-auth-token`,
    },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await context.route("**/rest/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (resource === "telegram_overview") {
      if (state.overviewDelay) {
        state.overviewWaiting = true;
        await new Promise((resolve) => setTimeout(resolve, state.overviewDelay));
        state.overviewWaiting = false;
      }
      if (state.denied)
        return route.fulfill({ status: 403, json: { code: "42501", message: "access denied" } });
      if (state.missing)
        return route.fulfill({
          status: 404,
          json: { code: "PGRST202", message: "function missing" },
        });
      return route.fulfill({ json: state.overview });
    }
    if (resource === "begin_telegram_link")
      return route.fulfill({
        json: {
          id: linkId,
          token,
          bot_username: state.overview.bot_username,
          expires_at: new Date(Date.now() + 600_000).toISOString(),
        },
      });
    if (resource === "confirm_telegram_link") {
      expect(body.p_id).toBe(linkId);
      state.confirmCount++;
      state.overview.connection = { username: state.overview.pending!.username, connected_at: now };
      state.overview.pending = null;
      state.overview.enabled = true;
      return route.fulfill({ json: null });
    }
    if (resource === "save_telegram_preferences") {
      if (state.failSave)
        return route.fulfill({
          status: 403,
          json: { code: "42501", message: "preferences access denied" },
        });
      state.overview.enabled = body.p_enabled;
      state.overview.topics = body.p_topics;
      state.lastTopics = body.p_topics;
      return route.fulfill({ json: null });
    }
    if (resource === "test_telegram_delivery") {
      state.tests++;
      state.overview.deliveries.unshift({
        id: "delivery1",
        kind: "test",
        status: "pending",
        attempts: 0,
        created_at: now,
        sent_at: null,
        error_code: null,
      });
      return route.fulfill({ json: "delivery1" });
    }
    if (resource === "disconnect_telegram") {
      state.overview.connection = null;
      state.overview.pending = null;
      state.overview.enabled = false;
      return route.fulfill({ json: null });
    }
    const defaults: Record<string, unknown> = {
      profiles: { id, name: "Telegram User", email: user.email, phone: null },
      user_roles: { role },
      notifications: [],
      reminder_settings: {
        owner_id: id,
        enabled: true,
        notify_owner: true,
        notify_tenant: true,
        payment_due_enabled: true,
        payment_overdue_enabled: true,
        agreement_expiring_enabled: true,
      },
    };
    return route.fulfill({ json: defaults[resource] ?? [] });
  });
}

test("Telegram pairing requires personal confirmation, preferences persist, queued delivery is not claimed sent", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/notifications");
  const card = page.getByTestId("telegram-settings");
  await card.getByRole("button", { name: "Подключить Telegram", exact: true }).click();
  await expect(card.getByRole("link", { name: "Открыть бота" })).toHaveAttribute(
    "href",
    `https://t.me/smartrent_fixture_bot?start=${token}`,
  );
  expect(await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]))).not.toContain(
    token,
  );
  expect(state.confirmCount).toBe(0);
  state.overview.pending = {
    id: linkId,
    username: "telegram_person",
    expires_at: new Date(Date.now() + 600_000).toISOString(),
  };
  await expect(
    card.getByText("Бот получил запрос от @telegram_person.", { exact: true }),
  ).toBeVisible({ timeout: 12_000 });
  await expect(card.getByText("Подключён:", { exact: false })).toHaveCount(0);
  await card.getByRole("button", { name: "Подтвердить мой аккаунт" }).click();
  await expect(card.getByText("Подключён: @telegram_person", { exact: true })).toBeVisible();
  await expect(card.getByRole("link", { name: "Открыть бота" })).toHaveCount(0);
  expect(state.confirmCount).toBe(1);
  state.overviewDelay = 2_000;
  await card.getByRole("switch", { name: "Платежи", exact: true }).click();
  await expect.poll(() => state.overviewWaiting).toBe(true);
  // A second toggle must not save an old topics array while the first refresh is pending.
  await expect(
    card.getByRole("switch", { name: "Действия по объекту", exact: true }),
  ).toBeDisabled();
  await expect(card.getByRole("switch", { name: "Платежи", exact: true })).toBeDisabled();
  await expect(card.getByRole("switch", { name: "Платежи", exact: true })).not.toBeChecked();
  state.overviewDelay = 0;
  expect(state.lastTopics).not.toContain("payments");
  expect(state.lastTopics).toContain("objects");
  await page.reload();
  await expect(card.getByRole("switch", { name: "Платежи", exact: true })).not.toBeChecked();
  await card.getByRole("button", { name: "Отправить проверочное сообщение", exact: true }).click();
  await expect(card.getByText("В очереди", { exact: true })).toBeVisible();
  await expect(
    card.getByRole("button", { name: /Отправить проверочное сообщение/ }),
  ).toBeDisabled();
  expect(state.tests).toBe(1);
  state.overview.deliveries[0]!.status = "uncertain";
  await expect(card.getByText("Результат неизвестен", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await expect(
    card.getByText(/Сообщение могло прийти; автоматического повтора не будет/),
  ).toBeVisible();
  state.overview.deliveries[0]!.status = "sent";
  state.overview.deliveries[0]!.sent_at = new Date().toISOString();
  await expect(card.getByText("Принято Telegram", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await expect(
    card.getByText("Telegram принял сообщение. Это не подтверждение прочтения.", { exact: true }),
  ).toBeVisible();
  await card.getByRole("switch", { name: "Отправлять в Telegram", exact: true }).click();
  await expect(
    card.getByRole("switch", { name: "Отправлять в Telegram", exact: true }),
  ).not.toBeChecked();
  await card.getByRole("button", { name: "Отключить Telegram", exact: true }).click();
  await expect(
    card.getByRole("button", { name: "Подключить Telegram", exact: true }),
  ).toBeVisible();
  await expect(card.getByText("Подключён: @telegram_person", { exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("Telegram missing migration and deployment are nonblocking; revoked access hides prior data", async ({
  page,
  context,
}) => {
  const state = fixture();
  state.missing = true;
  await install(context, state, "owner");
  await page.goto("/notifications");
  const card = page.getByTestId("telegram-settings");
  await expect(card).toContainText("Подключение появится после настройки администратором");
  await expect(page.getByRole("heading", { name: "Автоматические напоминания" })).toBeVisible();
  state.missing = false;
  state.overview.configured = false;
  await page.reload();
  await expect(card).toContainText("Доставка Telegram пока не настроена");
  await expect(card.getByRole("button", { name: "Подключить Telegram", exact: true })).toHaveCount(
    0,
  );
  state.overview.configured = true;
  state.overview.connection = {
    username: "private_account",
    connected_at: new Date().toISOString(),
  };
  state.overview.enabled = true;
  await page.reload();
  await expect(card).toContainText("@private_account");
  state.failSave = true;
  await card.getByRole("switch", { name: "Действия по объекту", exact: true }).click();
  await expect(
    page.getByText("Доступ к настройкам Telegram недоступен. Войдите в аккаунт заново.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    card.getByRole("switch", { name: "Действия по объекту", exact: true }),
  ).toBeChecked();
  state.denied = true;
  await expect(card.getByRole("alert")).toContainText("Предыдущие сведения скрыты", {
    timeout: 12_000,
  });
  await expect(card).not.toContainText("private_account");
  await expect(card.getByRole("switch")).toHaveCount(0);
  state.denied = false;
  await card.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(card).toContainText("@private_account");
});

test("Telegram settings and history fit 320px and failed or cancelled delivery remains explicit", async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 320, height: 780 });
  const state = fixture();
  state.overview.connection = {
    username: "long_telegram_username_example",
    connected_at: new Date().toISOString(),
  };
  state.overview.enabled = true;
  state.overview.deliveries = [
    "failed",
    "cancelled",
    "retry",
    "pending",
    "processing",
    "sent",
    "uncertain",
  ].map((status, index) => ({
    id: `d${index}`,
    kind: "property_action",
    status: status as TelegramOverview["deliveries"][number]["status"],
    attempts: index + 1,
    created_at: new Date().toISOString(),
    sent_at: null,
    error_code: index === 0 ? "bot_blocked" : null,
  }));
  state.overview.history_truncated = true;
  await install(context, state, "admin");
  await page.goto("/notifications");
  const card = page.getByTestId("telegram-settings");
  await expect(card.getByText("Не отправлено", { exact: true })).toBeVisible();
  await expect(card.getByText("Отменено", { exact: true })).toBeVisible();
  await expect(card.getByText("Ожидает повторной попытки", { exact: true })).toBeVisible();
  await expect(card.getByText("Показаны последние отправки.", { exact: true })).toBeVisible();
  const introduction = card.getByText("Важное по объектам и аренде — даже когда кабинет закрыт.", {
    exact: true,
  });
  const introductionBounds = await introduction.boundingBox();
  const cardBounds = await card.boundingBox();
  // A status badge must not squeeze the introduction into a column one word wide.
  expect(introductionBounds!.width).toBeGreaterThan(cardBounds!.width / 2);
  const history = card.getByRole("region", { name: "История отправок Telegram" });
  await expect(history.getByRole("listitem")).toHaveCount(5);
  await card.getByRole("button", { name: "Показать всю историю · 7", exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(7);
  await expect(history.getByText("Результат неизвестен", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await card.getByRole("button", { name: "Свернуть историю", exact: true }).click();
  await expect(history.getByRole("listitem")).toHaveCount(5);
});
