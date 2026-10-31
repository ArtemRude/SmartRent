import { expect, test, type BrowserContext } from "@playwright/test";

const id = (n: number) => `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ownerId = id(1),
  propertyId = id(2),
  tenantId = id(3),
  agreementId = id(4),
  requestId = id(5);

async function install(context: BrowserContext, role: "owner" | "tenant") {
  context.on("page", (page) => {
    page.on("pageerror", (error) => console.error("search-link browser error:", error.message));
    page.on("console", (message) => {
      if (message.type() === "error") console.error("search-link console error:", message.text());
    });
  });
  const api = process.env["E2E_SUPABASE_URL"]!;
  const userId = role === "owner" ? ownerId : id(6);
  const now = new Date().toISOString();
  const user = {
    id: userId,
    email: `${role}@example.invalid`,
    role: "authenticated",
    aud: "authenticated",
    user_metadata: { role, name: "Поиск" },
    app_metadata: { provider: "email" },
    created_at: now,
  };
  const token = Buffer.from(
    JSON.stringify({
      sub: userId,
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
    }),
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
    ({ key, value, origin }) => {
      if (location.origin === origin) localStorage.setItem(key, JSON.stringify(value));
    },
    {
      key: `sb-${new URL(api).hostname.split(".")[0]}-auth-token`,
      value: session,
      origin: "http://127.0.0.1:4173",
    },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  const property = {
    id: propertyId,
    owner_id: ownerId,
    name: "Точный объект вне списка",
    address: "Тестовый адрес",
    status: "active",
    type: "apartment",
    description: null,
    photos: [],
    created_at: now,
  };
  const tenant = {
    id: tenantId,
    owner_id: ownerId,
    name: "Точный арендатор вне списка",
    email: "exact@example.invalid",
    phone: null,
    user_id: id(6),
    created_at: now,
  };
  const agreement = {
    id: agreementId,
    owner_id: ownerId,
    property_id: propertyId,
    unit_id: null,
    tenant_id: tenantId,
    start_date: "2026-01-01",
    end_date: "2027-01-01",
    monthly_payment: 60000,
    payment_due_day: 15,
    status: "active",
    document_file: null,
    signed_document_file: null,
    signed_at: null,
    status_changed_at: now,
    contract_details: {},
    created_at: now,
  };
  const request = {
    id: requestId,
    owner_id: ownerId,
    property_id: propertyId,
    unit_id: null,
    tenant_id: tenantId,
    title: "Точная старая заявка",
    description: "Содержание только выбранной заявки",
    status: "closed",
    category: "question",
    photo: null,
    created_at: now,
  };
  const state = {
    available: true,
    personalLease: false,
    teamMismatch: false,
    includeStaleListRow: false,
    reads: [] as { resource: string; id: string | null }[],
    teamReads: [] as string[],
  };
  await context.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      resource = url.pathname.split("/").at(-1)!;
    const exactId = url.searchParams.get("id");
    state.reads.push({ resource, id: exactId });
    if (resource === "user_roles") return route.fulfill({ json: { role } });
    if (resource === "profiles")
      return route.fulfill({ json: { id: userId, name: "Поиск", email: user.email } });
    if (resource === "workspace_search_team_request") {
      const body = route.request().postDataJSON();
      state.teamReads.push(body.p_id);
      return route.fulfill({
        json: state.available
          ? {
              property_id: state.teamMismatch ? id(99) : propertyId,
              request: { ...request, tenant_name: tenant.name, unit_name: null },
            }
          : null,
      });
    }
    if (resource === "team_overview")
      return route.fulfill({
        json: {
          properties: [],
          members: [],
          assignments: [],
          events: [],
          events_truncated: false,
          workspaces: [
            {
              ...property,
              owner_name: "Собственник",
              membership_id: id(7),
              role: "viewer",
              responsible_name: null,
              unit_count: 0,
              active_agreements: 1,
              open_requests: 0,
            },
          ],
        },
      });
    if (resource === "team_workspace")
      return route.fulfill({
        json: {
          property: {
            ...property,
            owner_name: "Собственник",
            role: "viewer",
            responsible_name: null,
          },
          units: [],
          agreements: [],
          requests: state.includeStaleListRow
            ? [{ ...request, tenant_name: tenant.name, unit_name: null }]
            : [],
          comments: [],
          notes: [],
          notes_truncated: false,
          requests_truncated: true,
          comments_truncated: false,
        },
      });
    const records: Record<string, { id: string }> = {
      properties: state.personalLease ? { ...property, owner_id: id(98) } : property,
      tenants: state.personalLease ? { ...tenant, owner_id: id(98) } : tenant,
      lease_agreements: state.personalLease
        ? {
            ...agreement,
            owner_id: id(98),
            document_file: "demo/original.pdf",
            signed_document_file: "demo/signed.pdf",
          }
        : agreement,
      requests: state.personalLease
        ? { ...request, owner_id: id(98), category: "repair" }
        : request,
    };
    const record = records[resource];
    if (record && exactId) {
      return route.fulfill({
        json: state.available && exactId === `eq.${record.id}` ? [record] : [],
      });
    }
    if (resource === "tenants" && url.searchParams.has("user_id"))
      return route.fulfill({ json: [tenant] });
    if (state.includeStaleListRow && record) return route.fulfill({ json: [record] });
    return route.fulfill({ json: [] });
  });
  return state;
}

test.beforeEach(() => test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API."));

test("owner exact tenant and agreement links load records absent from capped lists", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const state = await install(context, "owner");
  const page = await context.newPage();
  await page.goto(`/tenants?tenantId=${tenantId}`);
  await expect(page.getByTestId("tenant-card")).toHaveText(/Точный арендатор вне списка/);
  await expect(page.locator(`#tenant-${tenantId}`)).toHaveClass(/ring-2/);
  await page.goto(`/agreements?agreementId=${agreementId}`);
  await expect(page.locator(`#agreement-${agreementId}`)).toContainText("Точный объект вне списка");
  await expect(page.locator(`#agreement-${agreementId}`)).toHaveClass(/ring-2/);
  await page.getByRole("combobox").click();
  await page.getByRole("option", { name: "Завершён", exact: true }).click();
  await expect(page.locator(`#agreement-${agreementId}`)).toBeVisible();
  expect(state.reads).toContainEqual({ resource: "tenants", id: `eq.${tenantId}` });
  expect(state.reads).toContainEqual({ resource: "lease_agreements", id: `eq.${agreementId}` });
  await context.close();
});

test("request link opens the exact detail, clears URL on close and hides revoked content", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const state = await install(context, "owner");
  const page = await context.newPage();
  await page.goto(`/requests?requestId=${requestId}`);
  await expect(page.getByRole("dialog")).toContainText("Содержание только выбранной заявки");
  await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page).not.toHaveURL(/requestId/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  state.includeStaleListRow = true;
  state.available = false;
  await page.goto(`/requests?requestId=${requestId}`);
  await expect(page.getByRole("dialog")).toContainText("Выбранная заявка недоступна");
  await expect(page.getByText("Содержание только выбранной заявки", { exact: true })).toHaveCount(
    0,
  );
  await context.close();
});

test("tenant cabinet highlights an exact agreement outside its normal list", async ({
  browser,
}) => {
  const context = await browser.newContext();
  await install(context, "tenant");
  const page = await context.newPage();
  await page.goto(`/cabinet?agreementId=${agreementId}`);
  await expect(page.getByTestId("cabinet-agreement")).toContainText("Точный объект вне списка");
  await expect(page.locator(`#agreement-${agreementId}`)).toHaveClass(/ring-2/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await context.close();
});

test("team exact request ignores workspace cap and rejects a different property response", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const state = await install(context, "tenant");
  const page = await context.newPage();
  await page.goto(`/team?property=${propertyId}&request=${requestId}`);
  await expect(page.getByTestId("team-request")).toContainText(
    "Содержание только выбранной заявки",
  );
  await expect(page.getByTestId("team-request")).toHaveClass(/ring-2/);
  await expect(page.getByLabel("Статус заявки", { exact: true })).toHaveCount(0);
  expect(state.teamReads).toContain(requestId);
  state.teamMismatch = true;
  state.includeStaleListRow = true;
  await page.reload();
  await expect(page.getByText(/Выбранная заявка недоступна на этом объекте/)).toBeVisible();
  await expect(page.getByText("Содержание только выбранной заявки", { exact: true })).toHaveCount(
    0,
  );
  await context.close();
});

test("invalid record IDs show unavailable without an exact API query", async ({ browser }) => {
  const context = await browser.newContext();
  const state = await install(context, "owner");
  const page = await context.newPage();
  await page.goto("/tenants?tenantId=invalid-id");
  await expect(page.getByText(/Выбранный арендатор недоступен/)).toBeVisible();
  expect(state.reads.some((read) => read.resource === "tenants" && read.id != null)).toBe(false);
  await context.close();
});

test("owner account's personal rental agreement is read-only and keeps original documents", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const state = await install(context, "owner");
  state.personalLease = true;
  const page = await context.newPage();
  await page.goto(`/agreements?agreementId=${agreementId}`);
  const card = page.locator(`#agreement-${agreementId}`);
  await expect(card).toContainText("Это ваша аренда. Договор доступен для просмотра");
  await expect(card.getByRole("button", { name: "Исходный PDF", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Подписанный PDF", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Предпросмотр и PDF", exact: true })).toHaveCount(
    0,
  );
  await expect(card.getByRole("button", { name: "Изменить", exact: true })).toHaveCount(0);
  await expect(card.getByRole("link", { name: /Оформить|Продлить|Новый договор/ })).toHaveCount(0);
  await expect(card.locator("summary").filter({ hasText: "История статусов" })).toBeVisible();
  await page.goto(`/requests?requestId=${requestId}`);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Содержание только выбранной заявки");
  await expect(dialog.getByText("Статус заявки", { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("combobox")).toHaveCount(0);
  await expect(
    dialog.getByRole("link", { name: "Ход ремонта по заявке", exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: "Оформить / открыть ремонт", exact: true }),
  ).toHaveCount(0);
  await context.close();
});
