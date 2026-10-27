import { expect, test, type Page } from "@playwright/test";

// Intercepted UI contracts only: this fixture never writes to a Supabase project.
async function installScenario(page: Page) {
  const apiUrl = process.env["E2E_SUPABASE_URL"];
  test.skip(!apiUrl, "Use loopback configuration for intercepted UI tests.");
  const ownerId = "91000000-0000-0000-0000-000000000001";
  const now = new Date().toISOString();
  const period = `${now.slice(0, 7)}-01`;
  const user = {
    id: ownerId,
    aud: "authenticated",
    role: "authenticated",
    email: "owner@example.invalid",
    app_metadata: { provider: "email" },
    user_metadata: { role: "owner", name: "Анна Собственник" },
    created_at: now,
  };
  const token = Buffer.from(
    JSON.stringify({
      sub: ownerId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.fixture`,
    refresh_token: "fixture",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user,
  };
  const state = {
    acceptanceError: false,
    errorResources: new Set<string>(),
    missingPayments: false,
    agreement: {
      id: "lease",
      owner_id: ownerId,
      property_id: "property",
      tenant_id: "tenant",
      unit_id: null,
      start_date: period,
      end_date: `${new Date().getFullYear() + 1}-12-31`,
      monthly_payment: 30000,
      payment_due_day: 15,
      status: "draft",
      document_file: null,
      signed_document_file: null,
      signed_at: null,
      status_changed_at: now,
      contract_details: {},
      created_at: now,
    } as Record<string, unknown>,
    tenant: {
      id: "tenant",
      owner_id: ownerId,
      user_id: null,
      name: "Иван Арендатор",
      email: "tenant@example.invalid",
      phone: null,
      created_at: now,
    } as Record<string, unknown>,
    acceptances: [
      {
        id: "old-acceptance",
        agreement_id: "lease",
        agreement_version: "2020-01-01T12:00:00Z",
        accepted_by: "tenant-user",
        accepted_at: now,
        photos: [],
      },
    ],
    notifications: [] as Record<string, unknown>[],
    charges: [] as Record<string, unknown>[],
  };
  await page.addInitScript(
    ({ session, storageKey }) => localStorage.setItem(storageKey, JSON.stringify(session)),
    {
      session,
      storageKey: `sb-${new URL(apiUrl!).hostname.split(".")[0]}-auth-token`,
    },
  );
  await page.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await page.route("**/storage/v1/**", (route) =>
    route.fulfill({ json: { Key: "signed.pdf", Id: "document" } }),
  );
  await page.route("**/rest/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (resource === "rent_payments" && state.missingPayments) {
      await route.fulfill({
        status: 404,
        json: { code: "PGRST205", message: "Fixture: missing payment history" },
      });
      return;
    }
    if (
      state.errorResources.has(resource) ||
      (resource === "agreement_acceptances" && state.acceptanceError)
    ) {
      await route.fulfill({ status: 500, json: { message: "Fixture: unavailable" } });
      return;
    }
    if (resource === "lease_agreements" && route.request().method() === "PATCH") {
      const values = route.request().postDataJSON() as Record<string, unknown>;
      const changingStatus = values["status"] && values["status"] !== state.agreement["status"];
      Object.assign(state.agreement, values);
      if (changingStatus) state.agreement["status_changed_at"] = new Date().toISOString();
      if (values["status"] === "active")
        state.charges.push({
          id: "charge",
          agreement_id: "lease",
          tenant_id: "tenant",
          owner_id: ownerId,
          period_start: period,
          due_date: now.slice(0, 10),
          amount: 30000,
          adjustment_amount: 0,
          adjustment_reason: null,
          paid_amount: 0,
          paid_at: null,
          charge_type: "rent",
          created_at: now,
        });
      await route.fulfill({ json: [] });
      return;
    }
    const tables: Record<string, unknown> = {
      profiles: { id: ownerId, name: user.user_metadata.name, email: user.email, phone: null },
      user_roles: { role: "owner" },
      properties: [
        {
          id: "property",
          owner_id: ownerId,
          name: "Квартира на Садовой",
          address: "Садовая, 12",
          type: "apartment",
          status: "active",
          photos: [],
          description: null,
          created_at: now,
        },
      ],
      tenants: [state.tenant],
      lease_agreements: [state.agreement],
      units: [],
      agreement_acceptances: state.acceptances,
      agreement_status_events: [],
      rent_charges: state.charges,
      rent_payments: [],
      requests: [],
      notifications: state.notifications,
    };
    await route.fulfill({ json: tables[resource] ?? [] });
  });
  return state;
}

test("first lease setup guides the owner through signing, activation and rent billing", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const state = await installScenario(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/dashboard");
  const onboarding = page.getByTestId("rental-onboarding");
  await expect(onboarding.getByText("3 из 6")).toBeVisible();
  await onboarding.getByRole("link", { name: "Подготовьте подписание" }).click();
  await expect(page).toHaveURL(/\/agreements\?agreementId=lease/);
  const preparation = page.getByTestId("agreement-preparation-lease");
  await expect(preparation.getByText("Готово 0 из 4")).toBeVisible();
  await preparation.getByRole("link", { name: "Пригласить арендатора" }).click();
  await expect(page.getByRole("heading", { name: "Арендаторы", exact: true })).toBeVisible();
  // Registration happens in the tenant account; the owner's next visit reads that link.
  state.tenant["user_id"] = "tenant-user";
  await page.getByRole("link", { name: "Договоры", exact: true }).click();
  await expect(preparation.getByText("Готово 1 из 4")).toBeVisible();
  await preparation.getByRole("button", { name: "Отправить на подписание" }).click();
  await expect(preparation.getByText("Готово 2 из 4")).toBeVisible();
  await expect(page.getByRole("button", { name: "Активировать", exact: true })).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: "test-results/agreement-preparation-mobile-actions.png",
    fullPage: true,
  });
  await preparation.getByRole("button", { name: "Загрузить подписанный PDF" }).click();
  await expect(page.locator("#signed-document-section")).toBeFocused();
  await page.locator("#lease-signed-file").setInputFiles({
    name: "signed.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\nfixture\n%%EOF"),
  });
  await page.getByRole("dialog").getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(preparation.getByText("Готово 3 из 4")).toBeVisible();
  // A signed file and an old acceptance must still leave activation blocked.
  await expect(page.getByRole("button", { name: "Активировать", exact: true })).toBeDisabled();
  state.acceptances.unshift({
    ...state.acceptances[0]!,
    id: "current-acceptance",
    agreement_version: String(state.agreement["status_changed_at"]),
  });
  state.notifications.push({
    id: "acceptance-event",
    user_id: state.agreement["owner_id"],
    kind: "agreement_accepted",
    title: "Арендатор подтвердил условия",
    body: "",
    href: "/agreements",
    entity_type: "agreement",
    entity_id: "lease",
    dedupe_key: null,
    read_at: null,
    created_at: new Date().toISOString(),
  });
  await expect(preparation.getByText("Готово 4 из 4")).toBeVisible({ timeout: 12_000 });
  await expect(page.getByRole("button", { name: "Активировать", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Меню", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Навигация" })
    .getByRole("link", { name: "Мой кабинет", exact: true })
    .click();
  await expect(page.getByRole("dialog", { name: "Навигация" })).toHaveCount(0);
  await expect(onboarding.getByText("4 из 6")).toBeVisible();
  await page.screenshot({ path: "test-results/onboarding-mobile.png", fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await onboarding.getByRole("link", { name: "Активируйте договор" }).click();
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(preparation).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({ path: "test-results/agreement-preparation-mobile.png", fullPage: true });
  await page.getByRole("button", { name: "Активировать", exact: true }).click();
  await expect(preparation).toHaveCount(0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Мой кабинет", exact: true })).toBeVisible();
  await expect(page.getByText("Загружаем сводку…")).toHaveCount(0);
  await expect(onboarding).toHaveCount(0);
  expect(state.charges).toHaveLength(1);
  await page.getByRole("link", { name: "Платежи", exact: true }).click();
  await expect(page.getByText("Квартира на Садовой", { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test("missing acceptance data does not present setup as complete or unlock activation", async ({
  page,
}) => {
  test.setTimeout(30_000);
  const state = await installScenario(page);
  state.acceptanceError = true;
  state.agreement["status"] = "pending_signature";
  state.agreement["signed_document_file"] = "owner/signed.pdf";
  state.tenant["user_id"] = "tenant-user";
  await page.goto("/dashboard");
  await expect(page.getByText("Часть данных не загрузилась.", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("rental-onboarding")).toHaveCount(0);
  await page.getByRole("link", { name: "Договоры", exact: true }).click();
  await expect(page.getByText("Не удалось загрузить данные договоров.")).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "Активировать", exact: true })).toBeDisabled();
  await expect(page.getByTestId("agreement-preparation-lease")).toHaveCount(0);
});

test("dashboard errors never look like zero debt, zero income or an all-clear", async ({
  page,
}) => {
  const state = await installScenario(page);
  for (const resource of ["lease_agreements", "rent_charges", "requests"])
    state.errorResources.add(resource);
  await page.goto("/dashboard");
  await expect(page.getByText("Часть данных не загрузилась.", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText("Всё в порядке", { exact: true })).toHaveCount(0);
  await expect(page.getByText("На сегодня срочных задач нет", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Задолженность/ })).toContainText("Недоступно");
  await expect(page.getByRole("link", { name: /Открытые заявки/ })).toContainText("Недоступно");
  const income = page
    .getByText("Ожидаемый доход в месяц", { exact: true })
    .locator("..")
    .locator("..");
  await expect(income).toContainText("Недоступно");
  await expect(page.getByText("Заявок пока нет.", { exact: true })).toHaveCount(0);
});

test("dashboard does not replace failed payment history with charge totals", async ({ page }) => {
  const state = await installScenario(page);
  state.errorResources.add("rent_payments");
  state.charges.push({
    id: "paid",
    agreement_id: "lease",
    tenant_id: "tenant",
    amount: 12345,
    adjustment_amount: 0,
    paid_amount: 12345,
    paid_at: new Date().toISOString(),
    charge_type: "rent",
  });
  await page.goto("/dashboard");
  await expect(page.getByText("Часть данных не загрузилась.", { exact: false })).toBeVisible({
    timeout: 15_000,
  });
  const received = page
    .getByText("Получено в этом месяце", { exact: true })
    .locator("..")
    .locator("..");
  await expect(received).toContainText("Недоступно");
  await expect(received).not.toContainText("12 345");
});

test("dashboard keeps debt unknown while charges load and preserves the missing-history compatibility fallback", async ({
  page,
}) => {
  const state = await installScenario(page);
  state.missingPayments = true;
  state.charges.push({
    id: "paid",
    agreement_id: "lease",
    tenant_id: "tenant",
    amount: 12345,
    adjustment_amount: 0,
    paid_amount: 12345,
    paid_at: new Date().toISOString(),
    charge_type: "rent",
  });
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/rest\/v1\/rent_charges(?:\?|$)/, async (route) => {
    await gate;
    await route.fulfill({ json: state.charges });
  });
  try {
    await page.goto("/dashboard");
    await expect(page.getByText("Загружаем сводку…")).toBeVisible();
    await expect(page.getByRole("link", { name: /Задолженность/ })).toContainText("Загрузка");
    await expect(page.getByText("Всё в порядке", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
  await expect(page.getByText("Загружаем сводку…")).toHaveCount(0);
  const received = page
    .getByText("Получено в этом месяце", { exact: true })
    .locator("..")
    .locator("..");
  await expect(received).toContainText(/12\s345/);
  await expect(received).not.toContainText("Недоступно");
});
