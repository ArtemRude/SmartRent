import { expect, test, type BrowserContext } from "@playwright/test";
import type { PropertyExpense, ExpenseEvent } from "../src/lib/property-finances";

async function installFinanceApi(context: BrowserContext, role: "owner" | "admin" | "tenant") {
  const api = process.env["E2E_SUPABASE_URL"]!;
  const ownerId = "91000000-0000-0000-0000-000000000001";
  const id =
    role === "owner"
      ? ownerId
      : role === "admin"
        ? "91000000-0000-0000-0000-000000000004"
        : "91000000-0000-0000-0000-000000000002";
  const propertyId = "92000000-0000-0000-0000-000000000001";
  const now = new Date().toISOString(),
    today = now.slice(0, 10),
    period = now.slice(0, 7) + "-01";
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
    { session, key: `sb-${new URL(api).hostname.split(".")[0]}-auth-token` },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  const expenses: PropertyExpense[] = [],
    events: ExpenseEvent[] = [];
  const calls: string[] = [],
    uploads: string[] = [];
  const state = { ledgerAvailable: true, expensesAvailable: true, paged: false };
  await context.route("**/storage/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/object/sign/"))
      return route.fulfill({ json: { signedURL: "/object/sign/receipt.pdf?token=fixture" } });
    uploads.push(decodeURIComponent(url.pathname));
    return route.fulfill({ json: { Key: "receipt", Id: "receipt" } });
  });
  await context.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      resource = url.pathname.split("/").at(-1)!;
    calls.push(resource);
    if (
      (resource === "rent_payments" && !state.ledgerAvailable) ||
      (["property_expenses", "property_expense_events"].includes(resource) &&
        !state.expensesAvailable)
    )
      return route.fulfill({
        status: 404,
        json: { code: "PGRST205", message: "table unavailable" },
      });
    if (resource === "save_property_expense") {
      const body = route.request().postDataJSON();
      let expense = expenses.find((e) => e.id === body.p_expense_id);
      if (!expense) {
        expense = {
          id: `expense-${expenses.length + 1}`,
          property_id: body.p_property_id,
          revision: 0,
          created_at: now,
          updated_at: now,
          ...body.p_values,
        };
        expenses.push(expense!);
      }
      Object.assign(expense!, body.p_values, { revision: expense!.revision + 1 });
      events.push({
        id: `event-${events.length + 1}`,
        expense_id: expense!.id,
        actor_id: id,
        reason: body.p_reason,
        snapshot: structuredClone(expense!) as unknown as ExpenseEvent["snapshot"],
        created_at: now,
      });
      return route.fulfill({ json: expense!.id });
    }
    const property = {
      id: propertyId,
      owner_id: ownerId,
      name: "Квартира на Садовой",
      address: "Садовая, 12",
      type: "apartment",
      status: "active",
      description: null,
      photos: [],
      created_at: now,
    };
    const charges = [
      {
        id: "rent",
        agreement_id: "agreement",
        owner_id: ownerId,
        tenant_id: "tenant",
        period_start: period,
        due_date: period,
        amount: 60000,
        adjustment_amount: 0,
        paid_amount: 40000,
        paid_at: null,
        charge_type: "rent",
        created_at: now,
      },
      {
        id: "utilities",
        agreement_id: "agreement",
        owner_id: ownerId,
        tenant_id: "tenant",
        period_start: period,
        due_date: period,
        amount: 1500,
        adjustment_amount: 0,
        paid_amount: 1500,
        paid_at: now,
        charge_type: "utilities",
        created_at: now,
      },
    ];
    if (state.paged) charges[0]!.paid_amount = 52000;
    const tables: Record<string, unknown> = {
      profiles: { id, name: "Анна", email: user.email, phone: null },
      user_roles: { role },
      properties: url.searchParams.has("id")
        ? property
        : [
            property,
            { ...property, id: "92000000-0000-0000-0000-000000000002", name: "Свободная студия" },
          ],
      lease_agreements: [
        {
          id: "agreement",
          owner_id: ownerId,
          property_id: propertyId,
          tenant_id: "tenant",
          start_date: period,
          end_date: `${new Date().getFullYear() + 1}-12-31`,
          monthly_payment: 60000,
          status: "active",
          payment_due_day: 15,
          contract_details: {},
        },
      ],
      rent_charges: charges,
      rent_payments: [
        { id: "payment", charge_id: "rent", amount: 40000, paid_at: now },
        { id: "utility-payment", charge_id: "utilities", amount: 1500, paid_at: now },
      ],
      property_expenses: expenses,
      property_expense_events: events,
    };
    let payload = tables[resource] ?? [];
    if (resource === "rent_payments" && state.paged)
      payload = [
        ...(payload as object[]),
        ...Array.from({ length: 1200 }, (_, i) => ({
          id: `extra-${i}`,
          charge_id: "rent",
          amount: 10,
          paid_at: now,
        })),
      ];
    if (Array.isArray(payload) && url.searchParams.has("limit")) {
      const offset = Number(url.searchParams.get("offset") ?? 0),
        limit = Math.min(Number(url.searchParams.get("limit")), state.paged ? 100 : 500);
      const page = payload.slice(offset, offset + limit);
      return route.fulfill({
        json: page,
        headers: {
          "access-control-expose-headers": "content-range",
          "content-range": page.length
            ? `${offset}-${offset + page.length - 1}/${payload.length}`
            : `*/${payload.length}`,
        },
      });
    }
    await route.fulfill({ json: payload });
  });
  return { expenses, events, state, calls, uploads, propertyId, today, id };
}
for (const role of ["owner", "admin"] as const) {
  test(`${role} records planned and paid expenses, corrects with history and compares rental results`, async ({
    browser,
  }) => {
    test.setTimeout(90_000);
    test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
    const context = await browser.newContext();
    const api = await installFinanceApi(context, role);
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(`/properties/${api.propertyId}`);
    await page
      .getByRole("main")
      .getByRole("link", { name: "Расходы и прибыль", exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`property=${api.propertyId}`));
    await expect(page.getByLabel("Объект отчёта", { exact: true })).toHaveValue(api.propertyId);
    await expect(page.getByTestId("finance-result")).toHaveText(/40\s000,00/);
    await page.getByRole("button", { name: "Добавить расход" }).click();
    await page.getByLabel("Название расхода").fill("Ремонт крана");
    await page.getByLabel("Плановая сумма, ₽", { exact: true }).fill("5000");
    await page.getByRole("button", { name: "Сохранить расход" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const record = page.getByTestId("expense-record").filter({ hasText: "Ремонт крана" });
    await expect(record.getByText("Запланирован", { exact: true })).toBeVisible();
    await expect(page.getByTestId("finance-result")).toHaveText(/40\s000,00/);
    await record.getByRole("button", { name: "Отметить оплату" }).click();
    await expect(page.getByLabel("Плановая сумма, ₽", { exact: true })).toBeDisabled();
    await page.getByLabel("Оплачено, ₽", { exact: true }).fill("5500,25");
    await page.locator("#expense-receipt").setInputFiles({
      name: "receipt.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\nfixture"),
    });
    await page.getByRole("button", { name: "Сохранить расход" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("finance-result")).toHaveText(/34\s499,75/);
    expect(api.uploads.some((p) => p.includes(`${api.id}/${api.propertyId}/`))).toBe(true);
    await record.getByRole("button", { name: "Исправить расход" }).click();
    await page.getByLabel("Оплачено, ₽", { exact: true }).fill("5200,10");
    await page.getByLabel("Причина исправления").fill("Поставщик исправил сумму в чеке");
    await page.getByRole("button", { name: "Сохранить расход" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("finance-result")).toHaveText(/34\s799,90/);
    await record.getByText("История расхода", { exact: true }).click();
    await expect(record.getByText(/Поставщик исправил сумму/)).toBeVisible();
    await expect(record.getByText(/Оплачено 5\s500,25/)).toBeVisible();
    expect(api.events).toHaveLength(3);
    await page.getByRole("button", { name: "Добавить расход" }).click();
    await page.getByLabel("Название расхода").fill("Ненужная работа");
    await page.getByLabel("Плановая сумма, ₽", { exact: true }).fill("1000");
    await page.getByRole("button", { name: "Сохранить расход" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page
      .getByTestId("expense-record")
      .filter({ hasText: "Ненужная работа" })
      .getByRole("button", { name: "Отменить расход" })
      .click();
    await page.getByRole("button", { name: "Подтвердить отмену" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("finance-result")).toHaveText(/34\s799,90/);
    await page
      .getByLabel("Объект отчёта", { exact: true })
      .selectOption("92000000-0000-0000-0000-000000000002");
    await expect(page.getByTestId("finance-result")).toHaveText(/0,00/);
    await page.getByRole("button", { name: "Добавить расход" }).click();
    await page.getByLabel("Название расхода").fill("Уборка студии");
    await page.getByLabel("Плановая сумма, ₽", { exact: true }).fill("500");
    await page.getByLabel("Состояние", { exact: true }).selectOption("paid");
    await page.getByLabel("Оплачено, ₽", { exact: true }).fill("450");
    await page.getByRole("button", { name: "Сохранить расход" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("finance-result")).toHaveText(/-450,00/);
    await page.getByLabel("Объект отчёта", { exact: true }).selectOption("");
    await expect(page.getByTestId("finance-result")).toHaveText(/34\s349,90/);
    await page.getByLabel("Состояние расходов", { exact: true }).selectOption("paid");
    await expect(page.getByTestId("expense-record")).toHaveCount(2);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: "Экспорт отчёта", exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    let csv = "";
    for await (const chunk of stream!) csv += chunk.toString();
    expect(csv).toContain("34799.9");
    expect(csv).toContain("5200.1");
    expect(csv).not.toContain("41500");
    await expect(page.getByText("Расход сохранён", { exact: true })).toHaveCount(0, {
      timeout: 7000,
    });
    await page.screenshot({ path: `test-results/finances-${role}.png`, fullPage: true });
    await page.setViewportSize({ width: 375, height: 850 });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect
      .poll(() =>
        page.getByTestId("finance-chart").evaluate((node) => {
          const svg = node.querySelector("svg.recharts-surface");
          return Boolean(
            svg && svg.getBoundingClientRect().width <= node.getBoundingClientRect().width + 1,
          );
        }),
      )
      .toBe(true);
    await page.screenshot({ path: `test-results/finances-${role}-mobile.png`, fullPage: true });
    api.state.ledgerAvailable = false;
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(page.getByText(/Журнал платежей недоступен/)).toBeVisible();
    await expect(page.getByTestId("finance-result")).toHaveText("—");
    api.state.expensesAvailable = false;
    await page.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(page.getByText(/Учёт расходов пока недоступен/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Добавить расход" })).toBeDisabled();
    expect(errors).toEqual([]);
    await context.close();
  });
}
test("tenant cannot open internal property finances", async ({ browser }) => {
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
  const context = await browser.newContext();
  const api = await installFinanceApi(context, "tenant");
  const page = await context.newPage();
  await page.goto("/finances");
  await expect(page).toHaveURL(/\/cabinet/);
  expect(api.calls).not.toContain("property_expenses");
  await context.close();
});

test("financial report paginates beyond one thousand payments even with a lower API row cap", async ({
  browser,
}) => {
  test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
  const context = await browser.newContext();
  const api = await installFinanceApi(context, "owner");
  api.state.paged = true;
  const page = await context.newPage();
  await page.goto("/finances");
  await expect(page.getByTestId("finance-result")).toHaveText(/52\s000,00/);
  expect(api.calls.filter((resource) => resource === "rent_payments").length).toBeGreaterThan(10);
  await context.close();
});
