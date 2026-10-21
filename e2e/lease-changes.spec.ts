import { expect, test, type BrowserContext } from "@playwright/test";
import { formatDate } from "../src/lib/domain";
import { nextRentMonth, type LeaseAmendment, type AmendmentEvent } from "../src/lib/lease-changes";
async function installApi(
  context: BrowserContext,
  role: "owner" | "admin" | "tenant",
  state: ReturnType<typeof fixture>,
) {
  const id = role === "owner" ? state.ownerId : role === "tenant" ? state.tenantId : state.adminId;
  const user = {
    id,
    aud: "authenticated",
    role: "authenticated",
    email: `${role}@example.invalid`,
    user_metadata: { role, name: role === "tenant" ? "Иван Арендатор" : "Анна" },
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
  await context.route("**/rest/v1/**", async (route) => {
    const url = new URL(route.request().url()),
      resource = url.pathname.split("/").at(-1)!;
    if (!state.available && ["lease_amendments", "lease_amendment_events"].includes(resource))
      return route.fulfill({ status: 404, json: { code: "PGRST205", message: "Unavailable" } });
    const body = route.request().method() === "POST" ? route.request().postDataJSON() : {};
    if (resource === "save_lease_amendment") {
      let m = state.amendments.find((m) => m.id === body.p_id);
      if (!m) {
        m = {
          id: `change-${state.amendments.length + 1}`,
          agreement_id: state.agreement.id,
          status: "draft",
          revision: 0,
          previous_monthly_payment: 60000,
          previous_end_date: state.agreement.end_date,
          note: "",
          review_note: null,
          submitted_at: null,
          decided_at: null,
          created_at: state.now,
          updated_at: state.now,
          agreement_snapshot: {
            ...state.agreement,
            property_name: "Квартира на Садовой",
            property_address: "Садовая, 12",
            owner_name: "Анна Собственник",
            owner_email: "owner@example.invalid",
            tenant_name: "Иван Арендатор",
            tenant_email: "tenant@example.invalid",
          },
          ...body.p_values,
        };
        state.amendments.push(m!);
      }
      Object.assign(m!, body.p_values, { revision: m!.revision + 1 });
      state.events.push({
        id: `event-${state.events.length}`,
        amendment_id: m!.id,
        actor_id: id,
        event_type: "draft_saved",
        snapshot: structuredClone(m!) as unknown as AmendmentEvent["snapshot"],
        created_at: state.now,
      });
      return route.fulfill({ json: m!.id });
    }
    if (resource === "act_on_lease_amendment") {
      const m = state.amendments.find((m) => m.id === body.p_id)!,
        action = body.p_action as string;
      if (action === "accept" && state.blocked)
        return route.fulfill({
          status: 400,
          json: {
            code: "23514",
            message:
              "За затронутые месяцы уже есть оплата или сообщение о ней. Сначала проверьте платежи",
          },
        });
      const event =
        action === "submit"
          ? "submitted"
          : action === "accept"
            ? "accepted"
            : action === "reject"
              ? "rejected"
              : "cancelled";
      m.status = action === "submit" ? "pending" : (event as LeaseAmendment["status"]);
      m.revision++;
      if (action === "submit") m.submitted_at = state.now;
      if (action === "reject") {
        m.review_note = body.p_note;
        m.decided_at = state.now;
      }
      if (action === "accept") {
        m.decided_at = state.now;
        state.agreement.end_date = m.end_date;
        for (let date = state.period; date <= m.end_date; date = nextRentMonth(date)) {
          const accepted = state.amendments
            .filter((m) => m.status === "accepted" && m.effective_from <= date)
            .sort((a, b) => b.effective_from.localeCompare(a.effective_from));
          const rate = accepted[0]?.monthly_payment ?? 60000;
          const charge = state.charges.find((c) => c.period_start === date);
          if (charge) charge.amount = rate;
          else
            state.charges.push({
              id: `charge-${date}`,
              agreement_id: state.agreement.id,
              owner_id: state.ownerId,
              tenant_id: "tenant",
              period_start: date,
              due_date: date,
              amount: rate,
              adjustment_amount: 0,
              paid_amount: 0,
              paid_at: null,
              charge_type: "rent",
              created_at: state.now,
            });
        }
      }
      state.events.push({
        id: `event-${state.events.length}`,
        amendment_id: m.id,
        actor_id: id,
        event_type: event as AmendmentEvent["event_type"],
        snapshot: structuredClone(m) as unknown as AmendmentEvent["snapshot"],
        created_at: state.now,
      });
      state.notifications.unshift({
        id: `n-${state.notifications.length}`,
        user_id: role === "tenant" ? state.ownerId : state.tenantId,
        kind: "agreement_amendment",
        entity_type: "agreement",
        entity_id: state.agreement.id,
        title: "Условия обновлены",
        body: "",
        href: "/lease-changes",
        created_at: state.now,
        read_at: null,
        dedupe_key: null,
      });
      return route.fulfill({ json: m.id });
    }
    const visible = state.amendments.filter((m) => role !== "tenant" || m.submitted_at);
    const tables: Record<string, unknown> = {
      profiles: { id, name: user.user_metadata.name, email: user.email, phone: null },
      user_roles: { role },
      properties: [
        {
          id: "property",
          owner_id: state.ownerId,
          name: "Квартира на Садовой",
          address: "Садовая, 12",
          type: "apartment",
          status: "active",
          photos: [],
          created_at: state.now,
        },
      ],
      tenants: [
        {
          id: "tenant",
          owner_id: state.ownerId,
          user_id: state.tenantId,
          name: "Иван Арендатор",
          email: "tenant@example.invalid",
          phone: null,
          created_at: state.now,
        },
      ],
      lease_agreements: [state.agreement],
      lease_amendments: visible,
      lease_amendment_events: state.events.filter(
        (e) =>
          visible.some((m) => m.id === e.amendment_id) &&
          (role !== "tenant" || e.event_type !== "draft_saved"),
      ),
      rent_charges: state.charges,
      notifications: state.notifications.filter((n) => n["user_id"] === id),
    };
    await route.fulfill({ json: tables[resource] ?? [] });
  });
}
function fixture() {
  const now = new Date().toISOString(),
    period = now.slice(0, 7) + "-01";
  const ownerId = "a1000000-0000-0000-0000-000000000001",
    tenantId = "a1000000-0000-0000-0000-000000000002",
    adminId = "a1000000-0000-0000-0000-000000000004";
  const agreement = {
    id: "a4000000-0000-0000-0000-000000000001",
    owner_id: ownerId,
    property_id: "property",
    tenant_id: "tenant",
    unit_id: null,
    start_date: period,
    end_date: `${new Date().getFullYear() + 1}-03-31`,
    monthly_payment: 60000,
    payment_due_day: 15,
    status: "active",
    document_file: null,
    signed_document_file: "signed.pdf",
    signed_at: now,
    status_changed_at: now,
    created_at: now,
    contract_details: { depositAmount: 60000 },
  };
  return {
    now,
    period,
    ownerId,
    tenantId,
    adminId,
    agreement,
    amendments: [] as LeaseAmendment[],
    events: [] as AmendmentEvent[],
    notifications: [] as Record<string, unknown>[],
    available: true,
    blocked: false,
    charges: [
      {
        id: "current",
        agreement_id: agreement.id,
        owner_id: ownerId,
        tenant_id: "tenant",
        period_start: period,
        due_date: period,
        amount: 60000,
        adjustment_amount: 0,
        paid_amount: 0,
        paid_at: null,
        charge_type: "rent",
        created_at: now,
      },
    ],
  };
}
for (const role of ["owner", "admin"] as const) {
  test(`${role} proposes renewal and rent change, tenant rejects then approves revised terms`, async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    test.skip(!process.env["E2E_SUPABASE_URL"], "Use loopback intercepted API.");
    const state = fixture(),
      ownerContext = await browser.newContext(),
      tenantContext = await browser.newContext();
    await installApi(ownerContext, role, state);
    await installApi(tenantContext, "tenant", state);
    const owner = await ownerContext.newPage(),
      tenant = await tenantContext.newPage(),
      errors: string[] = [];
    for (const page of [owner, tenant]) page.on("pageerror", (e) => errors.push(e.message));
    await owner.goto("/agreements");
    await owner.getByRole("link", { name: "Продлить / изменить условия", exact: true }).click();
    await expect(owner).toHaveURL(new RegExp(`agreement=${state.agreement.id}`));
    await tenant.goto("/cabinet");
    await tenant
      .getByRole("main")
      .getByRole("link", { name: "Изменения условий", exact: true })
      .click();
    const create = async (rate: string) => {
      await owner.getByRole("button", { name: "Предложить новые условия" }).click();
      await owner.getByLabel("Арендная плата, ₽/мес.", { exact: true }).fill(rate);
      await owner
        .getByLabel("Новая дата окончания", { exact: true })
        .fill(`${new Date().getFullYear() + 1}-06-30`);
      await owner
        .getByLabel("Комментарий к изменению")
        .fill("Продление аренды и согласование новой ставки");
      await owner.getByRole("button", { name: "Сохранить предложение" }).click();
      await expect(owner.getByRole("dialog")).toHaveCount(0);
    };
    const newest = (page: typeof owner) => page.getByTestId("lease-amendment").first();
    const action = async (page: typeof owner, name: string, note?: string) => {
      await newest(page).getByRole("button", { name, exact: true }).click();
      if (note) await page.getByLabel("Причина отказа", { exact: true }).fill(note);
      await page.getByRole("dialog").getByRole("button", { name: "Подтвердить действие" }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
    };
    await create("65000,25");
    await expect(tenant.getByTestId("lease-amendment")).toHaveCount(0);
    await action(owner, "Отправить арендатору");
    await expect(
      newest(tenant).getByRole("button", { name: "Отклонить предложение", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    await action(tenant, "Отклонить предложение", "Предлагаю меньшую ставку");
    await expect(newest(owner).getByText("Отклонено", { exact: true })).toBeVisible({
      timeout: 12000,
    });
    expect(state.agreement.end_date).toMatch(/03-31$/);
    expect(state.charges[0]!.amount).toBe(60000);
    await create("64000,10");
    await action(owner, "Отправить арендатору");
    await expect(
      newest(tenant).getByRole("button", { name: "Подтвердить новые условия", exact: true }),
    ).toBeVisible({ timeout: 12000 });
    state.blocked = true;
    await newest(tenant).getByRole("button", { name: "Подтвердить новые условия" }).click();
    await tenant.getByRole("dialog").getByRole("button", { name: "Подтвердить действие" }).click();
    await expect(tenant.getByText(/За затронутые месяцы уже есть оплата/)).toBeVisible();
    expect(state.amendments[1]!.status).toBe("pending");
    state.blocked = false;
    await tenant.getByRole("dialog").getByRole("button", { name: "Подтвердить действие" }).click();
    await expect(tenant.getByRole("dialog")).toHaveCount(0);
    await expect(newest(owner).getByText("Согласовано", { exact: true })).toBeVisible({
      timeout: 12000,
    });
    await expect(owner.getByText(/Текущая ставка: 60\s000,00/)).toBeVisible();
    await expect(owner.getByText(/Текущая ставка:/)).toContainText(
      `До ${formatDate(state.agreement.end_date)}`,
      { timeout: 12000 },
    );
    expect(state.charges.find((c) => c.period_start === nextRentMonth(state.period))!.amount).toBe(
      64000.1,
    );
    expect(state.charges.find((c) => c.period_start === state.period)!.amount).toBe(60000);
    const popupPromise = owner.waitForEvent("popup");
    await newest(owner).getByRole("button", { name: "Соглашение / PDF", exact: true }).click();
    const print = await popupPromise;
    await expect(
      print.getByRole("heading", { name: "Дополнительное соглашение", exact: true }),
    ).toBeVisible();
    await expect(print.getByText(/64\s000,10/)).toBeVisible();
    await print.emulateMedia({ media: "print" });
    await print.setViewportSize({ width: 658, height: 930 });
    expect(await print.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await print.screenshot({ path: `test-results/lease-change-${role}-print.png`, fullPage: true });
    await print.close();
    await owner.screenshot({ path: `test-results/lease-change-${role}.png`, fullPage: true });
    await tenant.setViewportSize({ width: 375, height: 850 });
    await expect
      .poll(() => tenant.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await expect(tenant.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 10000 });
    await tenant.screenshot({
      path: `test-results/lease-change-${role}-tenant-mobile.png`,
      fullPage: true,
    });
    await owner.getByRole("link", { name: "Договоры", exact: true }).click();
    await expect(owner.getByRole("button", { name: "Изменить", exact: true })).toBeDisabled();
    const originalPromise = owner.waitForEvent("popup");
    await owner.getByRole("button", { name: "Предпросмотр и PDF", exact: true }).click();
    const original = await originalPromise;
    await expect(original.locator("body")).toContainText(
      `31 марта ${new Date().getFullYear() + 1}`,
    );
    await original.close();
    state.available = false;
    await owner.goto("/lease-changes");
    await expect(owner.getByText(/Согласование новых условий пока недоступно/)).toBeVisible();
    expect(errors).toEqual([]);
    await ownerContext.close();
    await tenantContext.close();
  });
}
