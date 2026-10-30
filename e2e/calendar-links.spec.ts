import { expect, test, type BrowserContext } from "@playwright/test";
import { calendarToday, type RentalCalendarEvent } from "../src/lib/rental-calendar";
import type { RentalApplication } from "../src/lib/recruitment";
import type { RepairJob } from "../src/lib/repairs";

test.use({ timezoneId: "Europe/Moscow" });
const uuid = (n: number) => `c1000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ownerId = uuid(1),
  propertyId = uuid(2),
  managerId = uuid(3);
const chargeId = uuid(10),
  applicationId = uuid(11),
  jobId = uuid(12),
  unavailableId = uuid(99);

function fixture() {
  const today = calendarToday("Europe/Moscow"),
    now = new Date().toISOString();
  const application: RentalApplication = {
    id: applicationId,
    public_id: uuid(13),
    listing_id: uuid(14),
    property_id: propertyId,
    name: "Выбранный кандидат из календаря",
    email: "selected@example.invalid",
    phone: "00000000000",
    message: "Нужен показ именно выбранного помещения",
    status: "showing",
    showing_at: `${today}T10:30:00Z`,
    public_note: "",
    operator_note: "",
    agreement_id: null,
    revision: 1,
    created_at: now,
    offer: {
      title: "Квартира для выбранного показа",
      location: "Тестовый адрес",
      description: "",
      monthly_rent: 1000,
      deposit: 0,
      area: 30,
      available_from: today,
      contact_name: "",
      photos: [],
    },
  };
  const job: RepairJob = {
    id: jobId,
    property_id: propertyId,
    owner_id: ownerId,
    request_id: null,
    request_title: null,
    contractor_id: uuid(15),
    contractor_snapshot: {
      name: "Тестовый исполнитель",
      specialty: "Сантехника",
      phone: "",
      email: "",
    },
    title: "Выбранный ремонт из календаря",
    description: "Проверить точный источник события",
    scheduled_date: today,
    due_date: today,
    estimate_items: [{ name: "Работа", quantity: 1, unit_price: 200, amount: 200 }],
    estimated_total: 200,
    status: "approved",
    actual_amount: null,
    result_note: "",
    result_photos: [],
    decision_note: "",
    expense_id: null,
    published_at: now,
    completed_at: null,
    revision: 1,
    created_at: now,
    updated_at: now,
    property_name: "Тестовая квартира",
    role: "manager",
  };
  const oldCharge = {
    id: chargeId,
    agreement_id: uuid(20),
    owner_id: ownerId,
    tenant_id: uuid(21),
    period_start: "2020-02-01",
    due_date: "2020-02-15",
    amount: 1234,
    paid_amount: 0,
    adjustment_amount: 0,
    adjustment_reason: null,
    adjusted_at: null,
    adjusted_by: null,
    paid_at: null,
    payment_note: "Выбранное старое начисление — только точечный запрос",
    charge_type: "rent",
    created_at: "2020-02-01T00:00:00Z",
  };
  const calendarEvents: RentalCalendarEvent[] = [
    {
      id: `showing:${applicationId}`,
      kind: "showing",
      date: today,
      starts_at: application.showing_at,
      property_id: propertyId,
      title: "Показ из календаря",
      status: "showing",
      responsible_id: managerId,
      responsible_name: "Управляющий",
      amount: null,
      paid_amount: null,
      source_id: applicationId,
      agreement_id: null,
      request_id: null,
      access: "team",
      estimated: false,
    },
    {
      id: `repair:${jobId}`,
      kind: "repair",
      date: today,
      starts_at: null,
      property_id: propertyId,
      title: "Срок выбранного ремонта",
      status: "approved",
      responsible_id: managerId,
      responsible_name: "Управляющий",
      amount: null,
      paid_amount: null,
      source_id: jobId,
      agreement_id: null,
      request_id: null,
      access: "team",
      estimated: false,
    },
  ];
  return {
    today,
    now,
    application,
    job,
    oldCharge,
    calendarEvents,
    chargeQueries: [] as string[],
    historyQueries: [] as { resource: string; charge: string | null }[],
    applicationQueries: [] as string[],
    repairQueries: [] as string[],
    normalRecruitmentReads: 0,
    normalRepairReads: 0,
    scheduled: [] as { id: string; action: string; showingAt: string }[],
  };
}
type State = ReturnType<typeof fixture>;

async function install(context: BrowserContext, state: State, identity: "owner" | "manager") {
  const apiUrl = process.env["E2E_SUPABASE_URL"];
  test.skip(!apiUrl, "Use loopback configuration for intercepted calendar action tests.");
  const id = identity === "owner" ? ownerId : managerId,
    role = identity === "owner" ? "owner" : "tenant";
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${identity}@example.invalid`,
    user_metadata: { role, name: identity },
    app_metadata: { provider: "email" },
    created_at: state.now,
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
      key: `sb-${new URL(apiUrl!).hostname.split(".")[0]}-auth-token`,
    },
  );
  await context.route("**/auth/v1/**", (route) =>
    route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
  );
  await context.route("**/rest/v1/**", (route) => {
    const url = new URL(route.request().url()),
      resource = url.pathname.split("/").at(-1)!;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    const property = {
      id: propertyId,
      owner_id: ownerId,
      name: "Тестовая квартира",
      address: "Тестовый адрес",
      type: "apartment",
      status: "active",
      description: "",
      photos: [],
      created_at: state.now,
      role: identity,
    };
    const repairOverview = (jobs: RepairJob[]) => ({
      properties: [property],
      contractors: [],
      requests: [],
      jobs,
      events: [],
      jobs_truncated: false,
      events_truncated: false,
    });
    if (resource === "rental_calendar")
      return route.fulfill({
        json: {
          from: body.p_from,
          to: body.p_to,
          timezone: body.p_timezone,
          properties: [
            {
              id: propertyId,
              name: property.name,
              responsible_id: managerId,
              responsible_name: "Управляющий",
            },
          ],
          events: state.calendarEvents.filter(
            (event) => event.date >= body.p_from && event.date < body.p_to,
          ),
          truncated: false,
        },
      });
    if (resource === "rent_charges") {
      const selected = url.searchParams.get("id");
      state.chargeQueries.push(selected ?? "all");
      return route.fulfill({
        json: selected
          ? selected === `eq.${chargeId}`
            ? [state.oldCharge]
            : []
          : [
              {
                ...state.oldCharge,
                id: uuid(50),
                period_start: `${state.today.slice(0, 7)}-01`,
                due_date: state.today,
                payment_note: "Другое начисление из общего списка",
              },
            ],
      });
    }
    if (resource === "rent_payments" || resource === "rent_charge_adjustment_events") {
      const selected = url.searchParams.get("charge_id");
      state.historyQueries.push({ resource, charge: selected });
      return route.fulfill({
        json:
          selected === `eq.${chargeId}`
            ? resource === "rent_payments"
              ? [
                  {
                    id: uuid(60),
                    charge_id: chargeId,
                    owner_id: ownerId,
                    tenant_id: uuid(21),
                    amount: 100,
                    paid_at: "2020-02-15T12:00:00Z",
                    payment_method: "cash",
                    note: "Историческая учтённая оплата выбранного начисления",
                    receipt_file: null,
                    created_by: ownerId,
                    created_at: "2020-02-15T12:00:00Z",
                  },
                ]
              : []
            : [],
      });
    }
    if (resource === "rental_calendar_application") {
      state.applicationQueries.push(body.p_id);
      return route.fulfill({
        json:
          body.p_id === applicationId
            ? { application: state.application, operator: true, owner: false }
            : null,
      });
    }
    if (resource === "recruitment_overview") {
      state.normalRecruitmentReads++;
      return route.fulfill({
        json: {
          properties: [],
          applications: [
            { ...state.application, id: uuid(51), name: "Другой кандидат общего списка" },
          ],
          properties_truncated: false,
          applications_truncated: false,
        },
      });
    }
    if (resource === "act_on_rental_application") {
      state.scheduled.push({
        id: body.p_id,
        action: body.p_action,
        showingAt: body.p_values.showing_at,
      });
      if (body.p_id !== applicationId || body.p_action !== "schedule")
        return route.fulfill({
          status: 400,
          json: { code: "23514", message: "Unexpected target" },
        });
      state.application = {
        ...state.application,
        showing_at: body.p_values.showing_at,
        revision: state.application.revision + 1,
      };
      return route.fulfill({ json: applicationId });
    }
    if (resource === "rental_calendar_repair") {
      state.repairQueries.push(body.p_id);
      return route.fulfill({ json: repairOverview(body.p_id === jobId ? [state.job] : []) });
    }
    if (resource === "repairs_overview") {
      state.normalRepairReads++;
      return route.fulfill({
        json: repairOverview([
          { ...state.job, id: uuid(52), title: "Другой ремонт общего списка" },
        ]),
      });
    }
    if (resource === "user_roles")
      return route.fulfill({
        json: route.request().headers()["accept"]?.includes("object")
          ? { user_id: id, role }
          : [{ user_id: id, role }],
      });
    if (resource === "profiles")
      return route.fulfill({ json: { id, name: identity, email: user.email, phone: null } });
    if (resource === "properties") return route.fulfill({ json: [property] });
    if (resource === "tenants")
      return route.fulfill({
        json: [
          {
            id: uuid(21),
            owner_id: ownerId,
            user_id: uuid(22),
            name: "Тестовый арендатор",
            email: "tenant@example.invalid",
            phone: null,
            created_at: state.now,
          },
        ],
      });
    if (resource === "lease_agreements")
      return route.fulfill({
        json: [
          {
            id: uuid(20),
            owner_id: ownerId,
            property_id: propertyId,
            tenant_id: uuid(21),
            unit_id: null,
            start_date: "2020-01-01",
            end_date: "2020-12-31",
            monthly_payment: 1234,
            payment_due_day: 15,
            status: "completed",
            contract_details: {},
            created_at: "2020-01-01T00:00:00Z",
            status_changed_at: state.now,
            document_file: null,
            signed_document_file: null,
            signed_at: null,
          },
        ],
      });
    return route.fulfill({ json: [] });
  });
}

test("calendar charge link reads its exact old id and never substitutes a different charge", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state, "owner");
  await page.goto(`/payments?charge=${chargeId}`);
  await expect(page.getByText("Начисление, выбранное в календаре.", { exact: true })).toBeVisible();
  await expect(page.getByText(state.oldCharge.payment_note, { exact: true })).toBeVisible();
  await expect(page.getByText("Другое начисление из общего списка", { exact: true })).toHaveCount(
    0,
  );
  expect(state.chargeQueries).toContain(`eq.${chargeId}`);
  expect(state.chargeQueries).not.toContain("all");
  await page.getByText("История платежей (1)", { exact: true }).click();
  await expect(
    page.getByText("Историческая учтённая оплата выбранного начисления", { exact: true }),
  ).toBeVisible();
  for (const resource of ["rent_payments", "rent_charge_adjustment_events"])
    expect(state.historyQueries).toContainEqual({ resource, charge: `eq.${chargeId}` });
  expect(state.historyQueries.every((query) => query.charge !== null)).toBe(true);
  await page.goto(`/payments?charge=${unavailableId}`);
  await expect(page.getByRole("alert")).toContainText("Начисление из ссылки недоступно");
  await expect(page.getByText(state.oldCharge.payment_note, { exact: true })).toHaveCount(0);
  await expect(page.getByText("Другое начисление из общего списка", { exact: true })).toHaveCount(
    0,
  );
  expect(state.chargeQueries).toContain(`eq.${unavailableId}`);
  expect(state.chargeQueries).not.toContain("all");
});

test("calendar showing opens the exact operator card beyond overview and schedules that candidate", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state, "manager");
  await page.goto("/calendar");
  await page.getByRole("link", { name: "Открыть отклик", exact: true }).click();
  await expect(page).toHaveURL(
    new URL(`/recruitment?application=${applicationId}`, page.url()).href,
  );
  await expect(
    page.getByRole("heading", { name: state.application.name, exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Другой кандидат общего списка", { exact: true })).toHaveCount(0);
  expect(state.applicationQueries).toContain(applicationId);
  expect(state.normalRecruitmentReads).toBe(0);
  await page.getByRole("button", { name: "Назначить показ", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Назначить показ", exact: true });
  await dialog
    .getByLabel("Дата и время показа (ваш часовой пояс)")
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await dialog.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.scheduled).toHaveLength(1);
  expect(state.scheduled[0]?.id).toBe(applicationId);
  expect(state.scheduled[0]?.action).toBe("schedule");
  expect(Number.isFinite(Date.parse(state.scheduled[0]!.showingAt))).toBe(true);
});

test("calendar repair opens its exact scoped job beyond the general overview", async ({
  page,
  context,
}) => {
  const state = fixture();
  await install(context, state, "manager");
  await page.goto("/calendar");
  await page.getByRole("link", { name: "Открыть ремонт", exact: true }).click();
  await expect(page).toHaveURL(
    new URL(`/repairs?property=${propertyId}&job=${jobId}`, page.url()).href,
  );
  const job = page.getByTestId("repair-job");
  await expect(job).toHaveCount(1);
  await expect(job).toContainText(state.job.title);
  await expect(job.getByRole("button", { name: "Начать работу", exact: true })).toBeVisible();
  await expect(page.getByText("Другой ремонт общего списка", { exact: true })).toHaveCount(0);
  expect(state.repairQueries).toContain(jobId);
  expect(state.normalRepairReads).toBe(0);
  await page.goto(`/repairs?property=${propertyId}&job=${unavailableId}`);
  await expect(page.getByRole("alert")).toContainText("Работа из ссылки недоступна");
  await expect(page.getByTestId("repair-job")).toHaveCount(0);
  expect(state.repairQueries).toContain(unavailableId);
  expect(state.normalRepairReads).toBe(0);
});
