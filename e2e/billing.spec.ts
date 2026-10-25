import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Identity = "owner" | "admin" | "tenant";
type Overview = {
  mode: "prelaunch" | "enforced";
  launched_at: string | null;
  notice_until: string | null;
  plan: "start" | "owner" | "portfolio" | "team";
  paid_until: string | null;
  trial_until: string | null;
  units_used: number;
  seats_used: number;
};

const ownerId = "b1000000-0000-0000-0000-000000000001";
const daysFromNow = (days: number) => new Date(Date.now() + days * 86400000).toISOString();

function overview(values: Partial<Overview> = {}): Overview {
  return {
    mode: "prelaunch",
    launched_at: null,
    notice_until: null,
    plan: "owner",
    paid_until: daysFromNow(-30),
    trial_until: null,
    units_used: 4,
    seats_used: 0,
    ...values,
  };
}

async function installBillingApi(
  context: BrowserContext,
  role: Identity,
  initialOverview: Overview = overview(),
) {
  const now = new Date().toISOString();
  const id =
    role === "owner" ? ownerId : `b1000000-0000-0000-0000-00000000000${role === "admin" ? 2 : 3}`;
  const user = {
    id,
    email: `${role}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { role, name: "Анна" },
    app_metadata: { provider: "email" },
    created_at: now,
  };
  const token = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    user,
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
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
  const state = { overview: initialOverview, available: true };
  const calls: { resource: string; body: unknown }[] = [];
  await context.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const resource = url.pathname.split("/").at(-1)!;
    calls.push({
      resource,
      body: route.request().method() === "POST" ? route.request().postDataJSON() : null,
    });
    if (resource === "billing_overview") {
      if (!state.available)
        return route.fulfill({
          status: 404,
          json: { code: "PGRST202", message: "Function not found in the schema cache" },
        });
      return route.fulfill({ json: state.overview });
    }
    if (resource === "billing_admin_launch") {
      state.overview.mode = "enforced";
      state.overview.launched_at = now;
      state.overview.notice_until = daysFromNow(30);
      return route.fulfill({ json: null });
    }
    if (resource === "billing_admin_pause") {
      state.overview.mode = "prelaunch";
      return route.fulfill({ json: null });
    }
    const profile = { id, name: "Анна", email: user.email, phone: null, created_at: now };
    const tables: Record<string, unknown> = {
      profiles: url.searchParams.has("id") ? profile : [profile],
      user_roles: url.searchParams.has("user_id") ? { role } : [{ user_id: id, role }],
    };
    return route.fulfill({ json: tables[resource] ?? [] });
  });
  return { state, calls };
}

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

test.beforeEach(() => {
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use a loopback intercepted API.");
});

test("owner sees prelaunch access in dashboard and pricing without expired-subscription restrictions", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const api = await installBillingApi(context, "owner");
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  const summary = page.getByTestId("billing-summary");
  await expect(summary).toBeVisible();
  await expect(summary).toContainText("Ранний доступ");
  await expect(summary).toContainText(/бесплат|без оплаты/i);
  await expect(summary).not.toContainText("Доступ ограничен");
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Тариф и доступ", exact: true })
    .click();
  await expect(page).toHaveURL(/\/billing$/);
  await expect(page.getByRole("heading", { name: "Тариф и доступ", exact: true })).toBeVisible();
  for (const name of ["Старт", "Собственник", "Портфель", "Команда"])
    await expect(
      page.getByRole("region", { name: "Тарифы после запуска" }).getByText(name, { exact: true }),
    ).toBeVisible();
  const main = page.getByRole("main");
  await expect(main).toContainText(/590/);
  await expect(main).toContainText(/1[\s\u00a0\u202f]?490/);
  await expect(main).toContainText(/3[\s\u00a0\u202f]?490/);
  await expect(main).toContainText("Оплата не требуется");
  await expect(main).toContainText("Тарифный лимит пока не применяется");
  expect(api.calls.some((call) => call.resource === "billing_overview")).toBe(true);
  expect(api.calls.filter((call) => call.resource.startsWith("billing_admin_"))).toEqual([]);
  expect(errors).toEqual([]);
  await context.close();
});

test("missing billing RPC reports unavailable access information instead of claiming free prelaunch", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const api = await installBillingApi(context, "owner");
  api.state.available = false;
  const page = await context.newPage();
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Тариф и доступ", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText(
    /не удалось.*(?:тариф|доступ)|(?:тариф|доступ).*недоступ/i,
  );
  await expect(page.getByRole("main")).not.toContainText("Ранний доступ");
  await context.close();
});

test("tenant access stays free and does not request owner billing information", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const api = await installBillingApi(context, "tenant", overview({ mode: "enforced" }));
  const page = await context.newPage();
  await page.goto("/billing");
  await expect(page.getByRole("main")).toContainText(/арендатор.*бесплат|бесплат.*арендатор/i);
  expect(api.calls.filter((call) => call.resource === "billing_overview")).toEqual([]);
  await context.close();
});

test("mobile billing explains prelaunch terms and has no horizontal overflow", async ({
  browser,
}, testInfo) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
  });
  await installBillingApi(context, "owner");
  const page = await context.newPage();
  await page.goto("/billing");
  await expect(page.getByRole("heading", { name: "Тариф и доступ", exact: true })).toBeVisible();
  await expect(page.getByRole("main")).toContainText("Ранний доступ");
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: testInfo.outputPath("billing-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await expect(
    page.getByRole("dialog").getByRole("link", { name: "Тариф и доступ", exact: true }),
  ).toBeVisible();
  await context.close();
});

for (const scenario of [
  {
    name: "launch notice keeps access free despite an expired paid period",
    values: { notice_until: daysFromNow(20) },
    heading: "Есть время выбрать подходящий тариф",
    label: "Переходный период",
    detail: "Все возможности пока доступны бесплатно",
  },
  {
    name: "recent expiration keeps the paid plan during its grace period",
    values: { paid_until: daysFromNow(-2) },
    heading: "Подписка закончилась — доступ пока сохраняется",
    label: "Ожидает продления",
    detail: "Льготный период действует до",
  },
  {
    name: "unpaid account after grace explains restrictions and retained rental access",
    values: { paid_until: daysFromNow(-10) },
    heading: "Для новых платных действий нужно продление",
    label: "Ограниченный доступ",
    detail:
      "История, учёт платежей, заявки и работа по действующим обязательствам остаются доступны",
  },
  {
    name: "paid account displays its active subscription",
    values: { paid_until: daysFromNow(20) },
    heading: "Ваш тариф оплачен",
    label: "Подписка активна",
    detail: "Оплаченный доступ действует до",
  },
  {
    name: "one-unit start account remains free after paid launch",
    values: { plan: "start" as const, units_used: 1, paid_until: null },
    heading: "Вы на тарифе «Старт»",
    label: "Бесплатный тариф",
    detail: "Базовые возможности для одной единицы аренды доступны бесплатно",
  },
]) {
  test(scenario.name, async ({ browser }) => {
    const context = await browser.newContext();
    await installBillingApi(
      context,
      "owner",
      overview({
        mode: "enforced",
        launched_at: daysFromNow(-60),
        notice_until: daysFromNow(-30),
        ...scenario.values,
      }),
    );
    const page = await context.newPage();
    await page.goto("/billing");
    await expect(page.getByRole("heading", { name: scenario.heading, exact: true })).toBeVisible();
    await expect(page.getByRole("main")).toContainText(scenario.label);
    await expect(page.getByRole("main")).toContainText(scenario.detail);
    await expect(page.getByRole("main")).not.toContainText("Ранний доступ");
    await expectNoHorizontalOverflow(page);
    await context.close();
  });
}

test("admin launch requires explicit typed confirmation and restrictions can be paused", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const api = await installBillingApi(context, "admin");
  const page = await context.newPage();
  await page.goto("/admin");
  const controls = page.getByTestId("billing-admin-controls");
  await expect(controls).toContainText("Сейчас действует ранний доступ");
  await controls.getByRole("button", { name: "Запустить платный режим", exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  const confirm = dialog.getByRole("button", { name: "Подтвердить запуск", exact: true });
  await expect(confirm).toBeDisabled();
  await dialog.getByLabel("Подтверждение запуска").fill("запуск");
  await expect(confirm).toBeDisabled();
  expect(api.calls.filter((call) => call.resource === "billing_admin_launch")).toEqual([]);
  await dialog.getByRole("button", { name: "Отмена", exact: true }).click();
  expect(api.calls.filter((call) => call.resource === "billing_admin_launch")).toEqual([]);
  await controls.getByRole("button", { name: "Запустить платный режим", exact: true }).click();
  await dialog.getByLabel("Подтверждение запуска").fill("ЗАПУСК");
  await expect(confirm).toBeEnabled();
  expect(api.calls.filter((call) => call.resource === "billing_admin_launch")).toEqual([]);
  await confirm.click();
  await expect(dialog).toHaveCount(0);
  await expect(controls).toContainText("Платный режим включён");
  expect(api.calls.filter((call) => call.resource === "billing_admin_launch")).toEqual([
    { resource: "billing_admin_launch", body: { p_confirm: true } },
  ]);
  await controls.getByRole("button", { name: "Отключить ограничения", exact: true }).click();
  await expect(controls).toContainText("Сейчас действует ранний доступ");
  expect(api.calls.filter((call) => call.resource === "billing_admin_pause")).toHaveLength(1);
  await context.close();
});
