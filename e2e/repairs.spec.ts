import { test, expect, type BrowserContext } from "@playwright/test";
import {
  buildRepairEstimate,
  type RepairJob,
  type RepairEvent,
  type RepairContractor,
  type RepairRole,
} from "../src/lib/repairs";
import type { PropertyExpense, ExpenseEvent } from "../src/lib/property-finances";
const ownerId = "f1000000-0000-0000-0000-000000000001",
  propertyId = "f2000000-0000-0000-0000-000000000001",
  requestId = "f3000000-0000-0000-0000-000000000001";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=",
  "base64",
);
function fixture() {
  return {
    now: new Date().toISOString(),
    available: true,
    managerActive: true,
    stale: false,
    jobs: [] as RepairJob[],
    contractors: [] as RepairContractor[],
    events: [] as RepairEvent[],
    expenses: [] as PropertyExpense[],
    expenseEvents: [] as ExpenseEvent[],
    requestStatus: "new",
    uploads: [] as string[],
  };
}
type State = ReturnType<typeof fixture>;
async function install(
  context: BrowserContext,
  identity: "owner" | "admin" | "manager" | "tenant" | "viewer",
  state: State,
) {
  const role = identity === "owner" ? "owner" : identity === "admin" ? "admin" : "tenant";
  const id =
    identity === "owner"
      ? ownerId
      : `f1000000-0000-0000-0000-00000000000${identity === "admin" ? 2 : identity === "manager" ? 3 : identity === "tenant" ? 4 : 5}`;
  const user = {
    id,
    email: `${identity}@example.invalid`,
    aud: "authenticated",
    role: "authenticated",
    user_metadata: { role, name: identity === "manager" ? "Мария Управляющая" : "Анна" },
    app_metadata: { provider: "email" },
    created_at: state.now,
  };
  const token = Buffer.from(
    JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
  ).toString("base64url");
  const session = {
    access_token: `eyJhbGciOiJIUzI1NiJ9.${token}.fixture`,
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
  await context.route("**/storage/v1/**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET")
      return route.fulfill({ contentType: "image/png", body: png });
    if (url.pathname.includes("/object/sign/"))
      return route.fulfill({ json: { signedURL: "/object/sign/fixture.png?token=fixture" } });
    state.uploads.push(decodeURIComponent(url.pathname));
    return route.fulfill({ json: { Key: "photo", Id: "photo" } });
  });
  await context.route("**/rest/v1/**", async (route) => {
    const resource = new URL(route.request().url()).pathname.split("/").at(-1)!;
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    const workspaceRole: RepairRole =
      identity === "owner" || identity === "admin" ? "owner" : identity;
    const manager = workspaceRole === "owner" || workspaceRole === "manager";
    const visible = state.jobs.filter(
      (j) =>
        (identity !== "tenant" || j.published_at) &&
        (identity !== "manager" || state.managerActive),
    );
    const property = {
      id: propertyId,
      owner_id: ownerId,
      name: "Квартира на Садовой",
      address: "Садовая, 12",
      status: "active",
      type: "apartment",
      photos: [],
      created_at: state.now,
      role: workspaceRole,
    };
    const addEvent = (j: RepairJob, action: string) =>
      state.events.unshift({
        id: `event-${state.events.length}`,
        job_id: j.id,
        actor_name: identity === "manager" ? "Мария Управляющая" : "Анна Собственник",
        action,
        snapshot: structuredClone(j),
        created_at: state.now,
      });
    if (resource === "repairs_overview") {
      if (!state.available)
        return route.fulfill({ status: 404, json: { code: "PGRST202", message: "Unavailable" } });
      return route.fulfill({
        json: {
          properties: identity === "manager" && !state.managerActive ? [] : [property],
          contractors: workspaceRole === "owner" ? state.contractors : [],
          requests:
            manager && !state.jobs.some((j) => j.status !== "cancelled")
              ? [
                  {
                    id: requestId,
                    property_id: propertyId,
                    title: "Не работает отопление",
                    description: "Заменить клапан радиатора",
                  },
                ]
              : [],
          jobs: visible.map((j) => ({
            ...j,
            role: workspaceRole,
            ...(identity === "tenant"
              ? {
                  contractor_snapshot: null,
                  contractor_id: null,
                  estimate_items: [],
                  estimated_total: null,
                  actual_amount: null,
                  expense_id: null,
                  decision_note: "",
                }
              : {}),
          })),
          events:
            identity === "tenant"
              ? []
              : state.events.filter((e) => visible.some((j) => j.id === e.job_id)),
          jobs_truncated: false,
          events_truncated: false,
        },
      });
    }
    if (resource === "save_repair_contractor") {
      const c: RepairContractor = {
        id: "contractor-1",
        owner_id: ownerId,
        revision: 1,
        active: true,
        ...body.p_values,
      };
      state.contractors.push(c);
      return route.fulfill({ json: c.id });
    }
    if (resource === "save_repair_job") {
      const values = body.p_values;
      const calculated = buildRepairEstimate(
        values.estimate_items.map((i: { name: string; quantity: number; unit_price: number }) => ({
          name: i.name,
          quantity: String(i.quantity),
          unit_price: String(i.unit_price),
        })),
      );
      let j = state.jobs.find((j) => j.id === body.p_id);
      if (!j) {
        j = {
          id: "f4000000-0000-0000-0000-000000000001",
          property_id: propertyId,
          owner_id: ownerId,
          request_id: requestId,
          request_title: "Не работает отопление",
          title: "",
          description: "",
          scheduled_date: state.now.slice(0, 10),
          due_date: state.now.slice(0, 10),
          contractor_id: null,
          contractor_snapshot: null,
          estimate_items: [],
          estimated_total: 0,
          status: "draft",
          actual_amount: null,
          result_note: "",
          result_photos: [],
          decision_note: "",
          expense_id: null,
          published_at: null,
          completed_at: null,
          revision: 0,
          created_at: state.now,
          updated_at: state.now,
          property_name: property.name,
          role: "owner",
        };
        state.jobs.push(j);
      }
      const c = state.contractors.find((c) => c.id === values.contractor_id);
      Object.assign(j, values, {
        estimate_items: calculated.items,
        estimated_total: calculated.total,
        revision: j.revision + 1,
        contractor_snapshot: c
          ? { name: c.name, phone: c.phone, email: c.email, specialty: c.specialty }
          : null,
        decision_note: "",
      });
      addEvent(j, "draft_saved");
      return route.fulfill({ json: j.id });
    }
    if (resource === "act_on_repair_job") {
      if (state.stale)
        return route.fulfill({
          status: 400,
          json: { code: "40001", message: "Работа уже изменена. Обновите страницу" },
        });
      const j = state.jobs.find((j) => j.id === body.p_id)!,
        action = body.p_action,
        v = body.p_values;
      if (action === "submit") j.status = "pending";
      if (action === "reject") {
        j.status = "draft";
        j.decision_note = v.note;
      }
      if (action === "approve") {
        j.status = "approved";
        j.published_at = state.now;
      }
      if (action === "start") {
        j.status = "in_progress";
        state.requestStatus = "in_progress";
      }
      if (action === "report") {
        j.status = "review";
        j.actual_amount = v.actual_amount;
        j.result_note = v.note;
        j.result_photos = v.photos;
      }
      if (action === "return") {
        j.status = "in_progress";
        j.actual_amount = null;
        j.result_note = "";
        j.result_photos = [];
        j.decision_note = v.note;
      }
      if (action === "accept") {
        j.status = "completed";
        j.completed_at = state.now;
        j.decision_note = v.note;
        state.requestStatus = "closed";
      }
      if (action === "expense" && !j.expense_id) {
        j.expense_id = "expense-1";
        const expense: PropertyExpense = {
          id: j.expense_id,
          property_id: propertyId,
          title: `Ремонт: ${j.title}`,
          category: "repair",
          status: "planned",
          planned_date: state.now.slice(0, 10),
          planned_amount: j.actual_amount!,
          paid_amount: null,
          paid_date: null,
          receipt_file: null,
          note: j.result_note,
          revision: 1,
          created_at: state.now,
          updated_at: state.now,
        };
        state.expenses.push(expense);
        state.expenseEvents.push({
          id: "expense-event-1",
          expense_id: expense.id,
          actor_id: id,
          reason: null,
          snapshot: structuredClone(expense),
          created_at: state.now,
        });
      }
      j.revision++;
      addEvent(j, action);
      return route.fulfill({ json: action === "expense" ? j.expense_id : j.id });
    }
    const tables: Record<string, unknown> = {
      profiles: { id, name: user.user_metadata.name, email: user.email, phone: null },
      user_roles: { role },
      properties: [property],
      units: [],
      tenants: [
        {
          id: "tenant",
          owner_id: ownerId,
          user_id: "f1000000-0000-0000-0000-000000000004",
          name: "Иван Арендатор",
          email: "tenant@example.invalid",
          phone: null,
          created_at: state.now,
        },
      ],
      requests: [
        {
          id: requestId,
          property_id: propertyId,
          owner_id: ownerId,
          unit_id: null,
          tenant_id: "tenant",
          title: "Не работает отопление",
          description: "Заменить клапан радиатора",
          category: "repair",
          photo: null,
          status: state.requestStatus,
          created_at: state.now,
        },
      ],
      lease_agreements: [],
      lease_amendments: [],
      notifications: [],
      property_expenses: state.expenses,
      property_expense_events: state.expenseEvents,
      rent_charges: [],
      rent_payments: [],
    };
    return route.fulfill({ json: tables[resource] ?? [] });
  });
}

for (const role of ["owner", "admin"] as const) {
  test(`${role} turns request into agreed repair, accepts photos and creates one unpaid expense`, async ({
    browser,
  }) => {
    test.skip(!process.env["E2E_SUPABASE_URL"], "Use intercepted loopback API");
    test.setTimeout(120000);
    const state = fixture(),
      ownerContext = await browser.newContext(),
      managerContext = await browser.newContext(),
      tenantContext = await browser.newContext();
    await install(ownerContext, role, state);
    await install(managerContext, "manager", state);
    await install(tenantContext, "tenant", state);
    const owner = await ownerContext.newPage(),
      manager = await managerContext.newPage(),
      tenant = await tenantContext.newPage(),
      errors: string[] = [];
    for (const page of [owner, manager, tenant])
      page.on("pageerror", (e) => errors.push(e.message));
    await owner.goto("/requests");
    await owner.getByRole("button", { name: /Не работает отопление/ }).click();
    await owner.getByRole("link", { name: "Оформить / открыть ремонт" }).click();
    await expect(owner).toHaveURL(new RegExp(`request=${requestId}`));
    await owner.getByRole("button", { name: "Исполнители", exact: true }).click();
    await owner.getByRole("button", { name: "Добавить исполнителя", exact: true }).click();
    await owner.getByLabel("Имя или организация").fill("Мастер Сервис");
    await owner.getByLabel("Телефон исполнителя").fill("+7 900 123-45-67");
    await owner.getByLabel("Специализация").fill("Отопление");
    await owner.getByRole("button", { name: "Сохранить исполнителя", exact: true }).click();
    const directory = owner.getByRole("dialog", { name: "Исполнители", exact: true });
    await expect(directory.getByText("Мастер Сервис", { exact: true })).toBeVisible();
    await directory.getByRole("button", { name: "Close", exact: true }).click();
    await owner.getByRole("button", { name: "Создать работу по заявке", exact: true }).click();
    await owner.getByLabel("Исполнитель", { exact: true }).selectOption("contractor-1");
    await owner.getByLabel("Строка 1: работа или материал").fill("Замена клапана");
    await owner.getByLabel("Количество 1", { exact: true }).fill("1,5");
    await owner.getByLabel("Цена 1, ₽", { exact: true }).fill("100,11");
    await owner.getByRole("button", { name: "Сохранить смету", exact: true }).click();
    const job = owner.getByTestId("repair-job");
    await expect(job.getByText(/150,17/).first()).toBeVisible();
    const act = async (page: typeof owner, name: string, note?: string) => {
      await page.getByTestId("repair-job").getByRole("button", { name, exact: true }).click();
      const dialog = page.getByRole("dialog");
      if (note) await dialog.getByLabel(/Комментарий к действию|Обоснование превышения/).fill(note);
      await dialog.getByRole("button", { name, exact: true }).click();
      await expect(dialog).toHaveCount(0);
    };
    await tenant.goto("/repairs");
    await expect(tenant.getByTestId("repair-job")).toHaveCount(0);
    await act(owner, "Отправить смету");
    await act(owner, "Вернуть смету", "Уточнить объём работ");
    await expect(job).toContainText("Уточнить объём работ");
    await job.getByRole("button", { name: "Изменить смету", exact: true }).click();
    await owner.getByRole("button", { name: "Сохранить смету", exact: true }).click();
    await act(owner, "Отправить смету");
    state.stale = true;
    await job.getByRole("button", { name: "Согласовать смету", exact: true }).click();
    await owner
      .getByRole("dialog")
      .getByRole("button", { name: "Согласовать смету", exact: true })
      .click();
    await expect(owner.getByRole("dialog").getByRole("alert")).toContainText("Работа уже изменена");
    expect(state.jobs[0]!.status).toBe("pending");
    state.stale = false;
    await owner.getByRole("dialog").getByRole("button", { name: "Отмена", exact: true }).click();
    await act(owner, "Согласовать смету");
    await expect(tenant.getByTestId("repair-job")).toBeVisible({ timeout: 12000 });
    await expect(tenant.getByText("+7 900 123-45-67", { exact: false })).toHaveCount(0);
    await expect(tenant.getByTestId("repair-job")).not.toContainText("150,17");
    await manager.goto(`/repairs?property=${propertyId}`);
    await expect(manager.getByRole("button", { name: "Исполнители", exact: true })).toHaveCount(0);
    await act(manager, "Начать работу");
    await manager
      .getByTestId("repair-job")
      .getByRole("button", { name: "Передать на приёмку", exact: true })
      .click();
    await manager.getByLabel("Стоимость по отчёту, ₽").fill("200,10");
    await manager
      .getByLabel("Описание результата", { exact: false })
      .fill("Клапан заменён, отопление проверено");
    await manager
      .getByLabel("Фото результата", { exact: true })
      .setInputFiles({ name: "result.png", mimeType: "image/png", buffer: png });
    await manager
      .getByRole("dialog")
      .getByRole("button", { name: "Передать на приёмку", exact: true })
      .click();
    await expect(manager.getByRole("dialog")).toHaveCount(0);
    await expect(job.getByRole("status")).toHaveText("На приёмке", { timeout: 12000 });
    await job.getByRole("button", { name: "Принять работу", exact: true }).click();
    await expect(owner.getByRole("dialog")).toContainText("Стоимость превышает смету");
    await owner
      .getByLabel("Обоснование превышения сметы", { exact: false })
      .fill("Согласованы дополнительные материалы");
    await owner
      .getByRole("dialog")
      .getByRole("button", { name: "Принять работу", exact: true })
      .click();
    await expect(owner.getByRole("dialog")).toHaveCount(0);
    await expect(job.getByRole("status")).toHaveText("Принято");
    await expect(tenant.getByTestId("repair-job").getByRole("status")).toHaveText("Принято", {
      timeout: 12000,
    });
    await expect(tenant.getByTestId("repair-job")).toContainText("Клапан заменён");
    await expect(tenant.getByTestId("repair-job")).not.toContainText("200,10");
    await expect(
      tenant.getByRole("img", { name: "Фото результата ремонта", exact: true }),
    ).toBeVisible();
    await owner.locator("[data-sonner-toast]").waitFor({ state: "detached", timeout: 10000 });
    await owner.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await owner.screenshot({ path: `test-results/repairs-${role}.png`, fullPage: true });
    await tenant.setViewportSize({ width: 375, height: 850 });
    await tenant.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
    await expect
      .poll(() => tenant.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await tenant.screenshot({
      path: `test-results/repairs-${role}-tenant-mobile.png`,
      fullPage: true,
    });
    await act(owner, "Создать расход");
    expect(state.expenses).toHaveLength(1);
    expect(state.expenses[0]!.status).toBe("planned");
    expect(state.expenses[0]!.planned_amount).toBe(200.1);
    expect(state.requestStatus).toBe("closed");
    expect(state.uploads[0]).toContain(`/${state.jobs[0]!.id}/`);
    await job.getByRole("link", { name: "Открыть созданный расход", exact: true }).click();
    await expect(
      owner.getByRole("heading", { name: "Ремонт: Не работает отопление", exact: true }),
    ).toBeVisible();
    state.managerActive = false;
    await expect(manager.getByTestId("repair-job")).toHaveCount(0, { timeout: 12000 });
    state.available = false;
    await tenant.getByRole("button", { name: "Обновить", exact: true }).click();
    await expect(tenant.getByText(/Раздел ремонтов пока недоступен/)).toBeVisible();
    expect(errors).toEqual([]);
    for (const context of [ownerContext, managerContext, tenantContext]) await context.close();
  });
}
