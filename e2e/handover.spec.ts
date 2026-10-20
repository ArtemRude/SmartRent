import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import type { HandoverEvent, LeaseHandover } from "../src/lib/handovers";

test("owner and tenant agree a photographed checkout, preserve revisions and acknowledge the deposit return", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const apiUrl = process.env["E2E_SUPABASE_URL"];
  test.skip(!apiUrl, "Use loopback configuration for intercepted UI tests.");
  const ownerId = "81000000-0000-0000-0000-000000000001";
  const tenantId = "81000000-0000-0000-0000-000000000002";
  const agreementId = "84000000-0000-0000-0000-000000000001";
  const now = new Date().toISOString();
  const period = `${now.slice(0, 7)}-01`;
  const agreement = {
    id: agreementId,
    owner_id: ownerId,
    property_id: "property",
    tenant_id: "tenant",
    unit_id: null,
    start_date: period,
    end_date: `${new Date().getFullYear() + 1}-12-31`,
    monthly_payment: 30000,
    payment_due_day: 15,
    status: "active",
    status_changed_at: now,
    signed_document_file: "signed.pdf",
    document_file: null,
    signed_at: now,
    created_at: now,
    contract_details: {
      depositAmount: 30000,
      inventoryItems: [{ name: "Диван", quantity: "1", condition: "Исправен" }],
    },
  };
  const baseline: LeaseHandover = {
    id: "move-in",
    agreement_id: agreementId,
    kind: "move_in",
    status: "confirmed",
    revision: 3,
    inspection_date: period,
    keys_count: 2,
    checklist: { condition: true, inventory: true, meters: true, keys: true },
    inventory_snapshot: agreement.contract_details.inventoryItems,
    condition_note: "Мебель без повреждений",
    meter_readings: "Вода 100",
    photos: [],
    deposit_received: 30000,
    deductions: [],
    deductions_total: 0,
    refund_due: 0,
    review_note: null,
    submitted_at: now,
    reviewed_at: now,
    refund_marked_at: null,
    refund_confirmed_at: null,
    completed_at: null,
    created_at: now,
    updated_at: now,
  };
  const reports: LeaseHandover[] = [baseline];
  const events: HandoverEvent[] = [];
  const notifications: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQp0AAAAASUVORK5CYII=",
    "base64",
  );
  const installApi = async (context: BrowserContext, role: "owner" | "tenant") => {
    const id = role === "owner" ? ownerId : tenantId;
    const user = {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: `${role}@example.invalid`,
      user_metadata: { role, name: role === "owner" ? "Анна Собственник" : "Иван Арендатор" },
      app_metadata: { provider: "email" },
      created_at: now,
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
      { session, key: `sb-${new URL(apiUrl!).hostname.split(".")[0]}-auth-token` },
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
      uploads.push(decodeURIComponent(url.pathname));
      return route.fulfill({ json: { Key: "photo", Id: "photo" } });
    });
    await context.route("**/rest/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const resource = url.pathname.split("/").at(-1)!;
      const body =
        route.request().method() === "POST"
          ? (route.request().postDataJSON() as Record<string, unknown>)
          : {};
      let response: unknown = [];
      if (resource === "save_lease_handover") {
        const payload = body["p_report"] as Record<string, unknown>;
        let report = reports.find((item) => item.kind === body["p_kind"]);
        if (!report) {
          report = { ...baseline, id: "move-out", kind: "move_out", revision: 0 };
          reports.push(report);
        }
        Object.assign(report, payload, {
          status: "draft",
          review_note: null,
          submitted_at: null,
          reviewed_at: null,
          revision: report.revision + 1,
        });
        report.deductions_total =
          Math.round(report.deductions.reduce((sum, item) => sum + Number(item.amount), 0) * 100) /
          100;
        report.refund_due =
          Math.round((report.deposit_received - report.deductions_total) * 100) / 100;
        events.unshift({
          id: `event-${events.length}`,
          handover_id: report.id,
          actor_id: id,
          event_type: "draft_saved",
          note: null,
          snapshot: structuredClone(report),
          created_at: now,
        });
        response = report.id;
      } else if (resource === "act_on_lease_handover") {
        const report = reports.find((item) => item.id === body["p_handover_id"])!;
        const action = String(body["p_action"]);
        let eventType = action;
        if (action === "submit") {
          report.status = "pending";
          report.submitted_at = now;
          eventType = "submitted";
        }
        if (action === "dispute") {
          report.status = "disputed";
          report.review_note = String(body["p_note"]);
          report.reviewed_at = now;
          eventType = "disputed";
        }
        if (action === "confirm") {
          report.status = "confirmed";
          report.reviewed_at = now;
          eventType = "confirmed";
        }
        if (action === "complete") {
          report.completed_at = now;
          agreement.status = "completed";
          agreement.end_date = report.inspection_date;
          eventType = "completed";
        }
        if (action === "mark_refunded") {
          report.refund_marked_at = now;
          eventType = "refund_marked";
        }
        if (action === "confirm_refund") {
          report.refund_confirmed_at = now;
          eventType = "refund_confirmed";
        }
        report.revision += 1;
        events.unshift({
          id: `event-${events.length}`,
          handover_id: report.id,
          actor_id: id,
          event_type: eventType,
          note: body["p_note"] as string | null,
          snapshot: structuredClone(report),
          created_at: now,
        });
        notifications.unshift({
          id: `notification-${notifications.length}`,
          user_id: role === "owner" ? tenantId : ownerId,
          kind: "handover_status",
          entity_id: agreementId,
          entity_type: "agreement",
          title: "Акт обновлён",
          body: "",
          href: "/handover",
          read_at: null,
          dedupe_key: null,
          created_at: now,
        });
        response = report.id;
      } else {
        const visible = reports.filter((item) => role === "owner" || item.status !== "draft");
        const tables: Record<string, unknown> = {
          profiles: { id, name: user.user_metadata.name, email: user.email, phone: null },
          user_roles: { role },
          properties: [
            {
              id: "property",
              owner_id: ownerId,
              name: "Квартира на Садовой",
              address: "Садовая, 12",
              type: "apartment",
              status: "active",
              photos: [],
              created_at: now,
            },
          ],
          tenants: [
            {
              id: "tenant",
              owner_id: ownerId,
              user_id: tenantId,
              name: "Иван Арендатор",
              email: "tenant@example.invalid",
              phone: null,
              created_at: now,
            },
          ],
          lease_agreements: [agreement],
          units: [],
          agreement_acceptances: [],
          lease_handovers: visible,
          lease_handover_events: events.filter(
            (event) =>
              visible.some((item) => item.id === event.handover_id) &&
              (role === "owner" || event.event_type !== "draft_saved"),
          ),
          notifications: notifications.filter((item) => item["user_id"] === id),
        };
        response = tables[resource] ?? [];
      }
      await route.fulfill({ json: response });
    });
  };
  const ownerContext = await browser.newContext();
  const tenantContext = await browser.newContext();
  await installApi(ownerContext, "owner");
  await installApi(tenantContext, "tenant");
  const owner = await ownerContext.newPage();
  const tenant = await tenantContext.newPage();
  const errors: string[] = [];
  for (const page of [owner, tenant]) page.on("pageerror", (error) => errors.push(error.message));
  const path = `/handover?agreement=${agreementId}&kind=move_out`;
  await owner.goto(path);
  await tenant.goto(path);
  const current = (page: Page) => page.getByTestId("handover-current");
  const doAction = async (page: Page, name: string, note?: string) => {
    await current(page).getByRole("button", { name, exact: true }).click();
    if (note) await page.getByLabel("Замечания к акту").fill(note);
    await page.getByRole("dialog").getByRole("button", { name: "Подтвердить действие" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  };
  await owner.getByText("Сравнить с состоянием при заселении").click();
  await expect(owner.getByText("Мебель без повреждений", { exact: true })).toBeVisible();
  await current(owner).getByRole("button", { name: "Заполнить акт" }).click();
  for (const name of [
    "Состояние помещения осмотрено",
    "Имущество сверено с описью",
    "Показания счётчиков зафиксированы",
    "Ключи пересчитаны",
  ])
    await owner.getByRole("checkbox", { name, exact: true }).check();
  await owner.getByLabel("Количество ключей").fill("2");
  await owner
    .getByLabel("Состояние помещения и имущества")
    .fill("Царапина на столе, остальное исправно");
  await owner
    .getByLabel("Показания счётчиков", { exact: true })
    .fill("Вода 103,2; электричество 1250");
  await expect(owner.getByLabel("Фактически полученный депозит, ₽")).toHaveValue("30000");
  await owner.getByRole("button", { name: "Добавить удержание" }).click();
  await owner.getByLabel("Причина удержания 1").fill("Царапина на столе");
  await owner.getByLabel("Сумма удержания 1").fill("30001");
  await owner.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(
    owner.getByText("Удержания не могут превышать полученный депозит", { exact: true }),
  ).toBeVisible();
  await owner.getByLabel("Сумма удержания 1").fill("2500,25");
  await owner
    .locator("#handover-photos")
    .setInputFiles({ name: "room.png", mimeType: "image/png", buffer: png });
  await owner.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(current(owner).getByText(/27\s499,75/)).toBeVisible();
  await current(owner).getByRole("button", { name: "Открыть фото осмотра 1", exact: true }).click();
  await expect(
    owner.getByRole("dialog").getByRole("heading", { name: "Фото осмотра 1" }),
  ).toBeVisible();
  await owner.getByRole("button", { name: "Закрыть фотографию" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  expect(uploads.some((url) => url.includes(`${ownerId}/${agreementId}/move_out/`))).toBe(true);
  await expect(
    current(tenant).getByText("Собственник ещё не отправил акт на проверку."),
  ).toBeVisible();
  await doAction(owner, "Отправить арендатору");
  await expect(
    current(tenant).getByRole("button", { name: "Подтвердить акт", exact: true }),
  ).toBeVisible({ timeout: 12_000 });
  await doAction(
    tenant,
    "Оставить замечания",
    "Царапина была до заселения. Согласен оплатить уборку.",
  );
  await expect(current(owner).getByText("Есть замечания", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await current(owner).getByRole("button", { name: "Исправить акт" }).click();
  await owner.getByLabel("Причина удержания 1").fill("Уборка");
  await owner.getByLabel("Сумма удержания 1").fill("1000,10");
  await owner.getByRole("button", { name: "Сохранить черновик" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await doAction(owner, "Отправить арендатору");
  await expect(
    current(tenant).getByRole("button", { name: "Подтвердить акт", exact: true }),
  ).toBeVisible({ timeout: 12_000 });
  await expect(current(tenant).getByText(/28\s999,90/)).toBeVisible();
  await doAction(tenant, "Подтвердить акт");
  await expect(current(owner).getByText("Акт подтверждён", { exact: true })).toBeVisible({
    timeout: 12_000,
  });
  const popupPromise = owner.waitForEvent("popup");
  await current(owner).getByRole("button", { name: "Акт / PDF" }).click();
  const print = await popupPromise;
  await expect(print.getByRole("heading", { name: "Акт выезда", exact: true })).toBeVisible();
  await expect(print.getByText(/28\s999,90/)).toBeVisible();
  await print.emulateMedia({ media: "print" });
  await print.setViewportSize({ width: 658, height: 930 });
  expect(await print.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await print.screenshot({ path: "test-results/handover-print.png", fullPage: true });
  await print.close();
  await doAction(owner, "Завершить аренду");
  await expect(
    current(owner).getByText("Аренда завершена. История и расчёт депозита сохранены."),
  ).toBeVisible();
  await doAction(owner, "Отметить возврат депозита");
  await expect(
    current(tenant).getByRole("button", { name: "Подтвердить получение депозита" }),
  ).toBeVisible({ timeout: 12_000 });
  await tenant.setViewportSize({ width: 320, height: 800 });
  expect(await tenant.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await doAction(tenant, "Подтвердить получение депозита");
  await expect(
    current(owner).getByText("Получение подтверждено арендатором", { exact: false }),
  ).toBeVisible({ timeout: 12_000 });
  expect(
    events.some(
      (event) =>
        event.event_type === "submitted" && event.snapshot.deductions[0]?.amount === 2500.25,
    ),
  ).toBe(true);
  expect(events.filter((event) => event.event_type === "refund_marked")).toHaveLength(1);
  await tenant.screenshot({ path: "test-results/handover-tenant-mobile.png", fullPage: true });
  await owner.screenshot({ path: "test-results/handover-owner.png", fullPage: true });
  expect(errors).toEqual([]);
  await ownerContext.close();
  await tenantContext.close();
});
