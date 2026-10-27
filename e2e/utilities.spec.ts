import { expect, test, type BrowserContext } from "@playwright/test";
import { readFile } from "node:fs/promises";

// UI contract tests use intercepted Auth/REST/Storage responses. They never
// register users or modify any Supabase project; SQL behavior is tested separately.
test("utility readings and confirmed payments reach both accounts without reloading", async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const apiUrl = process.env["E2E_SUPABASE_URL"];
  test.skip(!apiUrl, "Use the local Supabase configuration for intercepted UI tests.");
  const storageKey = `sb-${new URL(apiUrl!).hostname.split(".")[0]}-auth-token`;
  const ownerId = "91000000-0000-0000-0000-000000000001";
  const tenantId = "91000000-0000-0000-0000-000000000002";
  const agreementId = "94000000-0000-0000-0000-000000000001";
  const today = new Date();
  const dateKey = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const period = `${dateKey(today).slice(0, 7)}-01`;
  const now = today.toISOString();
  const agreement = {
    id: agreementId,
    owner_id: ownerId,
    tenant_id: "tenant-record",
    property_id: "property",
    unit_id: null,
    start_date: period,
    end_date: `${today.getFullYear() + 1}-12-31`,
    monthly_payment: 30000,
    status: "active",
    payment_due_day: 15,
    created_at: now,
    status_changed_at: now,
    document_file: null,
    signed_document_file: "test/lease.pdf",
    signed_at: now,
    contract_details: {},
  };
  const services: Record<string, unknown>[] = [];
  const bills: Record<string, unknown>[] = [];
  const items: Record<string, unknown>[] = [];
  const charges: Record<string, unknown>[] = [
    {
      id: "rent-charge",
      agreement_id: agreementId,
      owner_id: ownerId,
      tenant_id: "tenant-record",
      period_start: period,
      due_date: dateKey(today),
      amount: 30000,
      adjustment_amount: 0,
      adjustment_reason: null,
      paid_amount: 0,
      paid_at: null,
      charge_type: "rent",
      created_at: now,
    },
  ];
  const submissions: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const reports: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const notify = (user_id: string, kind: string, entity_id: string) => {
    notifications.unshift({
      id: `notification-${notifications.length + 1}`,
      user_id,
      kind,
      entity_id,
      entity_type: kind.startsWith("utility_") ? "agreement" : "rent_charge",
      title: "Новое событие аренды",
      body: "",
      href: "/utilities",
      dedupe_key: null,
      read_at: null,
      created_at: new Date().toISOString(),
    });
  };

  const installApi = async (context: BrowserContext, role: "owner" | "tenant") => {
    const id = role === "owner" ? ownerId : tenantId;
    const user = {
      id,
      aud: "authenticated",
      role: "authenticated",
      email: `${role}@example.invalid`,
      app_metadata: { provider: "email" },
      user_metadata: { role, name: role === "owner" ? "Анна Собственник" : "Иван Арендатор" },
      created_at: now,
    };
    const tokenPart = Buffer.from(
      JSON.stringify({ sub: id, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString("base64url");
    const session = {
      access_token: `eyJhbGciOiJIUzI1NiJ9.${tokenPart}.fixture`,
      refresh_token: "fixture",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user,
    };
    await context.addInitScript(
      ({ session, storageKey }) => {
        localStorage.setItem(storageKey, JSON.stringify(session));
      },
      { session, storageKey },
    );
    await context.route("**/auth/v1/**", (route) =>
      route.fulfill({ json: route.request().url().includes("/token") ? session : user }),
    );
    await context.route("**/storage/v1/**", (route) =>
      route.fulfill({
        json: {
          Key: new URL(route.request().url()).pathname.replace("/storage/v1/object/", ""),
          Id: "photo",
        },
      }),
    );
    await context.route("**/rest/v1/**", async (route) => {
      const url = new URL(route.request().url());
      const resource = url.pathname.split("/").at(-1)!;
      const body =
        route.request().method() === "POST"
          ? (route.request().postDataJSON() as Record<string, unknown>)
          : {};
      let response: unknown = [];
      if (url.pathname.includes("/rpc/")) {
        if (resource === "save_utility_service") {
          const input = body["p_service"] as Record<string, unknown>;
          const service = {
            ...input,
            id: `service-${services.length + 1}`,
            agreement_id: agreementId,
            active: true,
            created_at: now,
          };
          services.push(service);
          response = service.id;
        } else if (resource === "submit_utility_readings") {
          submissions.push(body);
          const reading = (body["p_readings"] as Record<string, unknown>[])[0]!;
          const bill = {
            id: `bill-${bills.length + 1}`,
            agreement_id: agreementId,
            period_start: period,
            status: "pending",
            amount: 636.8,
            submitted_by: id,
            reviewed_by: null,
            reviewed_at: null,
            review_note: null,
            charge_id: null,
            created_at: now,
          };
          bills.push(bill);
          items.push(
            {
              id: `water-${bill.id}`,
              bill_id: bill.id,
              service_id: services[0]!["id"],
              name: "Холодная вода",
              kind: "meter",
              unit: "м³",
              previous_reading: 100,
              reading: 103.2,
              rate: 42.75,
              amount: 136.8,
              photo_path: reading["photo_path"],
            },
            {
              id: `internet-${bill.id}`,
              bill_id: bill.id,
              service_id: services[1]!["id"],
              name: "Интернет",
              kind: "fixed",
              unit: "мес.",
              previous_reading: null,
              reading: null,
              rate: 500,
              amount: 500,
              photo_path: null,
            },
          );
          response = bill.id;
          notify(ownerId, "utility_submitted", agreementId);
        } else if (resource === "review_utility_bill") {
          const bill = bills.find((bill) => bill["id"] === body["p_bill_id"])!;
          const approve = body["p_approve"] === true;
          Object.assign(bill, {
            status: approve ? "approved" : "rejected",
            reviewed_by: ownerId,
            reviewed_at: now,
            review_note: body["p_note"],
            charge_id: approve ? "utility-charge" : null,
          });
          if (approve)
            charges.push({
              ...charges[0],
              id: "utility-charge",
              charge_type: "utilities",
              amount: 636.8,
              due_date: body["p_due_date"],
            });
          response = bill["status"];
          notify(tenantId, "utility_reviewed", agreementId);
        } else if (resource === "review_payment_report") {
          const report = reports.find((report) => report["id"] === body["p_report_id"])!;
          const approve = body["p_approve"] === true;
          Object.assign(report, {
            status: approve ? "approved" : "rejected",
            reviewed_by: ownerId,
            reviewed_at: now,
            payment_id: approve ? "utility-payment" : null,
          });
          if (approve) {
            const charge = charges.find((charge) => charge["id"] === report["charge_id"])!;
            Object.assign(charge, { paid_amount: report["amount"], paid_at: report["paid_at"] });
            payments.push({
              id: "utility-payment",
              charge_id: charge["id"],
              owner_id: ownerId,
              tenant_id: "tenant-record",
              amount: report["amount"],
              paid_at: report["paid_at"],
              payment_method: report["payment_method"],
              note: null,
              receipt_file: null,
              created_by: ownerId,
              created_at: now,
            });
          }
          notify(tenantId, "payment_report_status", String(report["charge_id"]));
          response = report["status"];
        }
      } else if (resource === "payment_reports" && route.request().method() === "POST") {
        reports.push({
          ...body,
          id: "payment-report",
          reported_by: tenantId,
          status: "pending",
          reviewed_by: null,
          reviewed_at: null,
          cancelled_at: null,
          review_note: null,
          payment_id: null,
          created_at: now,
        });
        notify(ownerId, "payment_reported", String(body["charge_id"]));
      } else {
        const tables: Record<string, unknown> = {
          profiles: { id, name: user.user_metadata.name, email: user.email, phone: null },
          user_roles: { role },
          properties: [
            {
              id: "property",
              owner_id: ownerId,
              name: "Квартира на Садовой",
              address: "Садовая, 12",
              photos: [],
              type: "apartment",
              status: "active",
              created_at: now,
            },
          ],
          tenants: [
            {
              id: "tenant-record",
              owner_id: ownerId,
              user_id: tenantId,
              name: "Иван Арендатор",
              email: "tenant@example.invalid",
              phone: null,
              created_at: now,
            },
          ],
          units: [],
          lease_agreements: [agreement],
          utility_services: services,
          utility_bills: [...bills].reverse(),
          utility_bill_items: items,
          rent_charges: charges,
          rent_payments: payments,
          rent_charge_adjustment_events: [],
          payment_reports: reports,
          agreement_acceptances: [],
          agreement_status_events: [],
          notifications: notifications.filter((item) => item["user_id"] === id),
          requests: [],
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

  // A stale or forbidden deep link must not silently switch to another lease.
  for (const account of [owner, tenant]) {
    await account.goto("/utilities?agreement=94000000-0000-0000-0000-000000009999");
    await expect(account.getByText("Договор из ссылки недоступен", { exact: true })).toBeVisible();
    await expect(account.getByRole("tab", { name: "Показания и расчёты" })).toHaveCount(0);
    await account.getByRole("button", { name: "Выбрать другой договор", exact: true }).click();
    await expect(account.getByRole("tab", { name: "Показания и расчёты" })).toBeVisible();
  }

  await owner.goto("/utilities");
  await expect(
    owner.getByRole("heading", { name: "Коммунальные услуги", exact: true }),
  ).toBeVisible();
  await owner.getByRole("tab", { name: "Счётчики и услуги" }).click();
  await owner.getByRole("button", { name: "Добавить услугу", exact: true }).click();
  await owner.getByLabel("Название", { exact: true }).fill("Холодная вода");
  await owner.getByLabel("Начальные показания", { exact: true }).fill("100");
  await owner.getByLabel("Тариф, ₽ за м³").fill("42,75");
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить услугу", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText("Холодная вода", { exact: true })).toBeVisible();
  await owner.getByRole("button", { name: "Добавить услугу", exact: true }).click();
  await owner.getByRole("combobox", { name: "Тип услуги" }).click();
  await owner.getByRole("option", { name: "Фиксированный платёж" }).click();
  await owner.getByLabel("Название", { exact: true }).fill("Интернет");
  await owner.getByLabel("Платёж, ₽ в месяц").fill("500");
  await owner
    .getByRole("dialog")
    .getByRole("button", { name: "Добавить услугу", exact: true })
    .click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);

  await owner.getByRole("tab", { name: "Показания и расчёты" }).click();

  await tenant.goto("/utilities");
  await expect(tenant.getByRole("button", { name: "Добавить услугу", exact: true })).toHaveCount(0);
  await tenant.getByLabel("Расчётный месяц").fill("");
  await expect(
    tenant.getByRole("heading", { name: "Коммунальные услуги", exact: true }),
  ).toBeVisible();
  await expect(
    tenant.getByText("Выберите прошедший или текущий месяц в пределах договора."),
  ).toBeVisible();
  await tenant.getByLabel("Расчётный месяц").fill(period.slice(0, 7));
  const readingInput = tenant.getByLabel("Текущие показания, м³");
  await readingInput.fill("99");
  await expect(tenant.getByText("Показания не должны уменьшаться", { exact: false })).toBeVisible();
  await expect(tenant.getByRole("button", { name: "Отправить на проверку" })).toBeDisabled();
  await readingInput.fill("103,2");
  await expect(tenant.getByText("636,80", { exact: false }).first()).toBeVisible();
  await expect(tenant.getByTestId("utility-monthly-summary").getByText(/30\s636,80/)).toBeVisible();
  await tenant.locator('input[type="file"]').setInputFiles({
    name: "meter.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aQp0AAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await tenant.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(tenant.getByText("На проверке", { exact: true })).toBeVisible();
  expect((submissions[0]!["p_readings"] as Record<string, unknown>[])[0]!["photo_path"]).toContain(
    `${tenantId}/${agreementId}/`,
  );

  await expect(owner.getByRole("button", { name: "Вернуть на исправление" })).toBeVisible({
    timeout: 12_000,
  });
  await owner.getByRole("button", { name: "Вернуть на исправление" }).click();
  await owner.getByLabel("Причина возврата").fill("Проверьте фотографию счётчика");
  await owner.getByRole("button", { name: "Отправить на исправление" }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(tenant.getByText("Причина возврата: Проверьте фотографию счётчика")).toBeVisible({
    timeout: 12_000,
  });
  await tenant.getByLabel("Текущие показания, м³").fill("103,2");
  await tenant.getByRole("button", { name: "Отправить на проверку" }).click();
  await expect(tenant.getByText("На проверке", { exact: true })).toBeVisible();

  await expect(owner.getByRole("button", { name: "Утвердить расчёт" })).toBeVisible({
    timeout: 12_000,
  });
  await owner.getByRole("button", { name: "Утвердить расчёт" }).click();
  await owner.getByRole("button", { name: "Утвердить", exact: true }).click();
  await expect(owner.getByRole("dialog")).toHaveCount(0);
  await expect(owner.getByText("Утверждено", { exact: true })).toBeVisible();
  await expect(tenant.getByText("Утверждено", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(tenant.getByRole("link", { name: "Открыть оплату" })).toBeVisible();
  await expect(
    tenant.getByTestId("utility-monthly-summary").getByText("Начислено", { exact: true }),
  ).toBeVisible();
  await owner.getByRole("combobox", { name: "Статус истории расчётов" }).click();
  await owner.getByRole("option", { name: "Утверждённые", exact: true }).click();
  await expect(owner.getByTestId("utility-bill-bill-1")).toHaveCount(0);
  const downloadPromise = owner.waitForEvent("download");
  await owner.getByRole("button", { name: "Скачать CSV", exact: true }).click();
  const download = await downloadPromise;
  const csv = await readFile((await download.path())!, "utf8");
  expect(csv).toContain("Утверждено");
  expect(csv).toContain("136,80");
  expect(csv).not.toContain("Нужно исправить");
  const popupPromise = owner.waitForEvent("popup");
  await owner
    .getByTestId("utility-bill-bill-2")
    .getByRole("button", { name: "Расчёт / PDF" })
    .click();
  const report = await popupPromise;
  await expect(report.getByRole("heading", { name: "Расчёт коммунальных услуг" })).toBeVisible();
  await expect(report.getByText("636,80", { exact: false }).first()).toBeVisible();
  await expect(report.getByRole("button", { name: "Печать / Сохранить PDF" })).toBeVisible();
  await report.emulateMedia({ media: "print" });
  await report.setViewportSize({ width: 658, height: 930 });
  expect(
    await report.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await report.screenshot({ path: "test-results/utility-print-report.png", fullPage: true });
  await report.close();
  await owner.getByRole("combobox", { name: "Статус истории расчётов" }).click();
  await owner.getByRole("option", { name: "Все результаты", exact: true }).click();
  await owner.screenshot({ path: "test-results/utilities-owner.png", fullPage: true });
  await tenant.setViewportSize({ width: 390, height: 844 });
  await expect(
    tenant.getByRole("heading", { name: "Коммунальные услуги", exact: true }),
  ).toBeVisible();
  expect(
    await tenant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await tenant.screenshot({ path: "test-results/utilities-tenant-mobile.png", fullPage: true });
  await tenant.setViewportSize({ width: 320, height: 800 });
  expect(
    await tenant.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await owner.goto("/payments");
  await expect(owner.getByText("Коммунальные услуги", { exact: true }).last()).toBeVisible();
  await expect(owner.getByRole("link", { name: "Посмотреть показания и расчёт" })).toBeVisible();
  await tenant.goto("/cabinet");
  await expect(tenant.getByText("Коммунальные услуги ·", { exact: false })).toBeVisible();
  await expect(tenant.getByRole("button", { name: "Сообщить об оплате", exact: true })).toHaveCount(
    2,
  );
  await tenant.getByRole("button", { name: "Сообщить об оплате", exact: true }).last().click();
  await expect(tenant.getByLabel("Сумма", { exact: true })).toHaveValue("636.8");
  await tenant.getByRole("checkbox", { name: /Оплата передана наличными/ }).check();
  await tenant.getByRole("button", { name: "Отправить собственнику" }).click();
  await expect(tenant.getByRole("dialog")).toHaveCount(0);
  await expect(
    tenant.getByText("Оплата отправлена собственнику и ожидает подтверждения"),
  ).toBeVisible();
  // The owner is already on /payments: the new report must arrive via the shared feed.
  await expect(owner.getByRole("button", { name: "Подтвердить", exact: true })).toBeVisible({
    timeout: 12_000,
  });
  await owner.getByRole("button", { name: "Подтвердить", exact: true }).click();
  await owner
    .getByRole("alertdialog")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await expect(tenant.getByText("Подтверждено", { exact: true })).toBeVisible({ timeout: 12_000 });
  await expect(tenant.getByRole("button", { name: "Сообщить об оплате", exact: true })).toHaveCount(
    1,
  );
  expect(payments).toHaveLength(1);
  expect(charges.find((charge) => charge["id"] === "utility-charge")!["paid_amount"]).toBe(636.8);
  await tenant.goto("/utilities");
  const summary = tenant.getByTestId("utility-monthly-summary");
  await expect(summary.getByText(/30\s000,00/).last()).toBeVisible();
  await expect(summary.getByText(/636,80/).last()).toBeVisible();
  expect(errors).toEqual([]);
  await ownerContext.close();
  await tenantContext.close();
});
